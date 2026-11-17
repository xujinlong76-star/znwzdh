import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { loginViaAdmin } from './helpers';

/**
 * 卸载 / 停用 / 回滚端到端（P1-7）。
 *
 * 补齐此前三个插件 E2E spec 全文无一次「卸载」点击的缺口：卸载弹窗
 * （removeSites 勾选、分类同步删除回执）、已安装页停用/重新启用、
 * 卸载后计数回落，此前只到 API 层与源码文本断言。本文件只做行为断言
 * （点按、可见文本、计数），不用源码文本断言。
 *
 * 三条链路（每条用例自带唯一插件，互不干扰）：
 *   1. 详情页卸载弹窗：removeSites 勾选 → 确认卸载 → 分类同步删除回执
 *      → 详情页恢复可安装态 → 已安装页计数回落。
 *   2. 已安装页卸载：原生 confirm 确认 → 横幅回执 → 计数回落到 0。
 *   3. 已安装页停用 → 重新启用。
 *   4. 版本演进：装 v1 → 提交并上架 v2 → 升级到 v2 → 回滚到 v1。
 *
 * 关键教训（U-38 根因）：凡是涉及原生 confirm 的步骤（已安装页卸载、
 * 版本回滚确认），必须先 page.once('dialog', dialog => dialog.accept())
 * 再点——Playwright 默认自动拒绝 confirm，点了等于没点。
 *
 * 注意：本机无 Chrome，E2E 本机未实跑，以 CI E2E 为准。
 */

function sitePackManifest(name: string, stamp: string, extraSite?: { url: string; title: string }) {
  return {
    manifestVersion: 1,
    kind: 'site-pack',
    name,
    description: 'Playwright 端到端测试自动生成的网址包（可安全清理）',
    version: '1.0.0',
    tags: ['e2e'],
    payload: {
      categories: [{ title: `E2E 分类 ${stamp}` }],
      sites: [
        {
          url: `https://e2e-${stamp}.example.com`,
          title: `E2E 示例站 ${stamp}`,
          category: `E2E 分类 ${stamp}`,
          tags: ['e2e'],
        },
        ...(extraSite
          ? [{ url: extraSite.url, title: extraSite.title, category: `E2E 分类 ${stamp}`, tags: ['e2e'] }]
          : []),
      ],
    },
  };
}

/**
 * 点击「立即安装」并等待成功 toast。
 *
 * 冷启动（CI 首次 dev 编译）存在 React 水合竞态：弹窗按钮已可见但事件处理器
 * 尚未绑定，首击会静默丢失（点击本身不报错）。这里在未出现 toast 且弹窗仍在时
 * 补击一次，消除这类环境性抖动。（与 plugin-market.spec.ts 同款）
 */
async function clickInstallAndAwaitToast(page: Page, dialog: any, name: string) {
  const toast = page.getByText(`成功安装「${name}」！`);
  await dialog.getByRole('button', { name: '立即安装' }).click();
  try {
    await expect(toast).toBeVisible({ timeout: 10_000 });
  } catch {
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: '立即安装' }).click().catch(() => {});
    }
    await expect(toast).toBeVisible({ timeout: 15_000 });
  }
}

/** 详情页走 UI 安装指定插件，直至出现「已安装」态。 */
async function installSitePackViaUI(page: Page, name: string, slug: string) {
  await page.goto(`/marketplace/${slug}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
  await page.getByRole('button', { name: '立即安装该插件' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`确认安装「${name}」`)).toBeVisible({ timeout: 15_000 });
  await clickInstallAndAwaitToast(page, dialog, name);
  await expect(page.getByRole('button', { name: /已安装/ })).toBeVisible();
}

/** 读已安装页「全部 (N)」标签里的计数。调用前需已在 /marketplace/installed。 */
async function readInstalledCount(page: Page): Promise<number> {
  // 首载是异步取数：分类栏在 loading 时就带着初始 items=[] 渲染，
  // 「全部 (0)」是假零（installed/page.tsx:111 注释自认）——必须等
  // 「正在加载…」消失（取数落定）后再读数，否则读到首载假零
  // （run 44125548782 用例 1 首试与重试两次都读到 0；同文件用例 2/3
  // 先等插件名出现再读数，都过了）。
  await expect(page.getByText('正在加载已安装插件清单…')).toHaveCount(0, { timeout: 30_000 });
  const allTab = page.getByRole('button', { name: /全部 \(\d+\)/ });
  await expect(allTab).toBeVisible({ timeout: 30_000 });
  const text = (await allTab.textContent()) ?? '';
  const m = text.match(/全部 \((\d+)\)/);
  expect(m, `无法从「全部」标签解析计数：${text}`).not.toBeNull();
  return Number(m![1]);
}

test.describe('插件市场：卸载 / 停用 / 回滚端到端', () => {
  test.describe.configure({ retries: 1 });

  let adminRequest: APIRequestContext;
  let adminContext: BrowserContext | undefined;
  test.beforeAll(async ({ browser }, testInfo) => {
    adminContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    await loginViaAdmin(await adminContext.newPage());
    adminRequest = adminContext.request;
  });
  test.afterAll(async () => {
    await adminContext?.close().catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    // 诊断通道：CI 失败时把浏览器报错与失败 API 落进任务日志，便于远程排查
    page.on('console', msg => console.log(`[BROWSER ${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.log(`[PAGE ERROR]`, err));
    page.on('response', async res => {
      if (!res.ok() && res.url().includes('/api/')) {
        let body = '';
        try { body = await res.text(); } catch {}
        console.log(`[API ERROR ${res.status()}] ${res.url()} => ${body.slice(0, 200)}`);
      }
    });
  });

  test('详情页卸载弹窗：removeSites 勾选 → 确认卸载 → 分类同步删除回执 → 已安装页计数回落', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 卸载包 ${stamp}`;
    const slug = `e2e-uninstall-${stamp}`;

    // 导入并安装：1 个分类 + 1 个站点，卸载回执里的数字据此确定
    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(name, stamp), slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();
    await installSitePackViaUI(page, name, slug);

    // 安装落账：已安装页计数为 1
    await page.goto('/marketplace/installed');
    await expect(page.getByRole('heading', { name: '已安装插件管家' })).toBeVisible({ timeout: 30_000 });
    // 先等插件名出现（数据到达的信号，与同文件用例 2/3 同款），
    // 再读计数：只等标题会读到首载假零（见 readInstalledCount 注释）。
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(await readInstalledCount(page)).toBe(1);

    // 详情页点「已安装 (点击管理/卸载)」打开卸载弹窗
    await page.goto(`/marketplace/${slug}`);
    await page.getByRole('button', { name: '已安装 (点击管理/卸载)' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认卸载「${name}」`)).toBeVisible({ timeout: 15_000 });

    // removeSites 勾选框：默认勾选；取消再勾回，确认开关本身可交互
    const removeSitesBox = dialog.getByLabel('同时清理该插件带来的站点与分类');
    await expect(removeSitesBox).toBeChecked();
    await removeSitesBox.uncheck();
    await expect(removeSitesBox).not.toBeChecked();
    await removeSitesBox.check();
    await expect(removeSitesBox).toBeChecked();

    // 确认卸载 → 回执 toast：站点进回收站 + 分类同步删除
    await dialog.getByRole('button', { name: '确认卸载' }).click();
    await expect(page.getByText(`已卸载「${name}」`)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('已清理关联站点（1 个站点已移至回收站），并同步删除 1 个网址分类'),
    ).toBeVisible({ timeout: 15_000 });

    // 详情页恢复可安装态
    await expect(page.getByRole('button', { name: '立即安装该插件' })).toBeVisible({ timeout: 15_000 });

    // 已安装页计数回落到 0，插件离队、空态出现
    await page.goto('/marketplace/installed');
    await expect(page.getByRole('heading', { name: '已安装插件管家' })).toBeVisible({ timeout: 30_000 });
    expect(await readInstalledCount(page)).toBe(0);
    await expect(page.getByText(name, { exact: true })).not.toBeVisible();
    await expect(page.getByText('你尚未安装任何插件，前往市场一键开启')).toBeVisible();
  });

  test('已安装页卸载：原生 confirm 确认 → 横幅回执 → 计数回落到 0', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 管家卸载包 ${stamp}`;
    const slug = `e2e-installed-uninstall-${stamp}`;

    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(name, stamp), slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();
    await installSitePackViaUI(page, name, slug);

    await page.goto('/marketplace/installed');
    await expect(page.getByRole('heading', { name: '已安装插件管家' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(await readInstalledCount(page)).toBe(1);

    // 已安装页卸载走原生 confirm（U-38 教训）：先接管再点，否则
    // Playwright 默认自动拒绝、点了等于没点；横幅出现即证明 confirm 被接受、
    // 卸载真实发生（拒绝时不会有横幅）。
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: `卸载插件 ${name}` }).click();
    await expect(
      page.getByText(`已成功卸载插件「${name}」，关联站点与分类已同步清理`),
    ).toBeVisible({ timeout: 15_000 });

    // 计数回落到 0，插件离队、空态出现
    expect(await readInstalledCount(page)).toBe(0);
    await expect(page.getByText(name, { exact: true })).not.toBeVisible();
    await expect(page.getByText('你尚未安装任何插件，前往市场一键开启')).toBeVisible();
  });

  test('已安装页停用 → 重新启用', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 停用包 ${stamp}`;
    const slug = `e2e-disable-${stamp}`;

    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(name, stamp), slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();
    await installSitePackViaUI(page, name, slug);

    await page.goto('/marketplace/installed');
    await expect(page.getByRole('heading', { name: '已安装插件管家' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(await readInstalledCount(page)).toBe(1);

    // 停用：toast 回执 + 「已停用」态（数据与版本保留，按钮变重新启用）
    await page.getByRole('button', { name: `停用插件 ${name}` }).click();
    await expect(page.getByText(`已停用「${name}」`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('运行效果已停止，数据与版本保留')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: `重新启用插件 ${name}` })).toBeVisible();

    // 重新启用：横幅回执 + 恢复可用态（停用标记消失，按钮变回停用）
    await page.getByRole('button', { name: `重新启用插件 ${name}` }).click();
    await expect(page.getByText(`已重新启用「${name}」`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('运行效果已停止，数据与版本保留')).not.toBeVisible();
    await expect(page.getByRole('button', { name: `停用插件 ${name}` })).toBeVisible();
    // 停用不删数据：计数仍为 1，插件仍在列表里
    expect(await readInstalledCount(page)).toBe(1);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test('版本演进：升级到 v2 后回滚到 v1', async ({ page }) => {
    // 全链路步数多（导入、安装、发版、审核、升级、回滚），放宽单用例预算
    test.setTimeout(180_000);
    const stamp = Date.now().toString(36);
    const name = `E2E 回滚包 ${stamp}`;
    const slug = `e2e-rollback-${stamp}`;

    // v1：1 个站点；v2：保留 v1 站点、新增 1 个 v2 独有站点
    const v1 = sitePackManifest(name, stamp);
    const v2 = {
      ...sitePackManifest(name, stamp, {
        url: `https://e2e-rb2-${stamp}.example.com`,
        title: `E2E 回滚 v2 站 ${stamp}`,
      }),
      version: '2.0.0',
    };

    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest: v1, slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();
    await installSitePackViaUI(page, name, slug);

    // 作者提交 v2 → 管理员审核上架 v2
    const submitted = await adminRequest.post(`/api/hub/plugins/${slug}/versions`, {
      data: { manifest: v2, changelog: 'E2E 回滚测试 v2：新增一个站点' },
    });
    expect(submitted.ok(), `提交 v2 失败 ${submitted.status()}: ${await submitted.text()}`).toBeTruthy();
    const approved = await adminRequest.post(`/api/hub/plugins/${slug}/review`, {
      data: { action: 'approve' },
    });
    expect(approved.ok(), `审核 v2 失败 ${approved.status()}: ${await approved.text()}`).toBeTruthy();

    // 详情页平滑升级到 v2.0.0
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByRole('button', { name: '平滑升级到 v2.0.0' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '平滑升级到 v2.0.0' }).click();
    const upgradeDialog = page.getByRole('dialog');
    await expect(upgradeDialog.getByText(`确认更新「${name}」`)).toBeVisible({ timeout: 15_000 });
    const upgradeToast = page.getByText('已更新到 v2.0.0！');
    await upgradeDialog.getByRole('button', { name: '立即平滑升级' }).click();
    try {
      await expect(upgradeToast).toBeVisible({ timeout: 10_000 });
    } catch {
      if (await upgradeDialog.isVisible().catch(() => false)) {
        await upgradeDialog.getByRole('button', { name: '立即平滑升级' }).click().catch(() => {});
      }
      await expect(upgradeToast).toBeVisible({ timeout: 15_000 });
    }
    await expect(page.getByRole('button', { name: /已安装/ })).toBeVisible();

    // 版本演进时间轴：v1 与 v2 都在列，v1 行可回滚
    await page.getByRole('tab', { name: '版本演进' }).click();
    await expect(page.getByText('v2.0.0', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('v1.0.0', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '回滚到此版本' })).toBeVisible();

    // 回滚确认走原生 confirm（U-38 教训）：先接管再点，否则点了等于没点；
    // 回滚成功 toast 即证明 confirm 被接受、回滚真实发生。
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '回滚到此版本' }).click();
    await expect(page.getByText(/已回滚到 v1\.0\.0/)).toBeVisible({ timeout: 15_000 });

    // 回滚后版本归属翻转：v1 行变「重装此版本」（已安装），v2 行变「安装此版本」，
    // 「回滚到此版本」不再出现（已装已是最低版本，无更低目标可滚）
    await expect(page.getByRole('button', { name: '重装此版本' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '安装此版本' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '回滚到此版本' })).not.toBeVisible();

    // 已安装页印证：该插件已装版本回到 v1.0.0，市场最新仍为 v2.0.0
    await page.goto('/marketplace/installed');
    await expect(page.getByRole('heading', { name: '已安装插件管家' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/已安装 v1\.0\.0/).first()).toBeVisible();
  });
});
