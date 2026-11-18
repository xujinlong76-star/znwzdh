import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { loginViaAdmin } from './helpers';

/**
 * import / mine / 作者页与详情 tab 切换端到端（P3-5，范围按 W4 审计收窄）。
 *
 * 真缺口（W4 核实）：
 *   1. /marketplace/import：粘贴清单 JSON 导入上架并自动安装；非法 JSON 报错；
 *      匿名导入 401 →「请先登录 + 去登录」入口；同名 409 拒绝；勾选
 *      「导入后立即安装」的 theme 激活（导入即换肤）。
 *      注意：E2E 里 POST /api/hub/plugins/import 只是管理员导入端点、作测试
 *      数据准备，与页面调的 POST /api/plugins/import 不是同一端点。
 *   2. /marketplace/mine（作者中心，别与有 E2E 的 /me/plugins 混淆）：
 *      投稿待审插件可见；行内「预览 / AI 工坊升级 / 手动发版本」；
 *      取数失败态 + 点重试恢复。
 *   3. /marketplace/author/[key]：列表卡片作者链接（plugin-card.tsx:539，
 *      从未被点）进作者页 → 作品与统计可见 → 点作品卡片回详情页；
 *      未认证作者不显示认证徽章；作品 >100 时「加载更多」翻页。
 *   4. 详情页 tab：diff / impact / raw 三个真缺口（reviews、history、
 *      回滚点击、默认 preview tab 均已有 E2E，不重复覆盖）。
 *
 * 未做（有明确原因，不编造）：
 *   - /mine「加载更多」翻到 101+：投稿接口 POST /api/plugins 限流
 *     30 次/小时/IP（p3-versions-and-reviews.ts），同一作者 101 次投稿
 *     在单轮 E2E 里会被 429 堵死；XFF 伪造多 IP 绕限流是绕产品 guardrail，
 *     不做。需批量造数通道或 E2E 限流豁免才能补。
 *   - 作者页认证徽章「已认证时显示」：authorVerified 全仓只有读引用，
 *     无任何 API 写入口（中枢/人工认证流程写入），E2E 无法把作者置为
 *     已认证；只测反面——未认证作者不显示徽章。
 *
 * 只做行为断言（点按、可见文本、地址栏、按钮态），不用源码文本断言。
 * 每轮 E2E 从空库开始：全部数据由本文件自造（站内 API + anon- 前缀身份），
 * 不依赖种子、不依赖其他 spec 的数据。
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

function themeManifest(name: string, stamp: string) {
  return {
    manifestVersion: 1,
    kind: 'theme',
    name,
    description: 'Playwright 端到端测试自动生成的主题（可安全清理）',
    version: '1.0.0',
    tags: ['e2e'],
    payload: {
      accent: 'violet',
      tokens: {
        '--primary': '262 83% 58%',
        '--ring': '262 83% 58%',
        '--radius': '0.85rem',
      },
    },
  };
}

/**
 * 点击「立即安装」并等待成功 toast。
 *
 * 冷启动水合竞态：弹窗按钮已可见但事件处理器尚未绑定，首击会静默丢失。
 * 未出现 toast 且弹窗仍在时补击一次（与 plugin-market.spec.ts 同款）。
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

/** 详情页走 UI 安装指定插件，直至出现「已安装」态（与卸载 spec 同款）。 */
async function installSitePackViaUI(page: Page, name: string, slug: string) {
  await page.goto(`/marketplace/${slug}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
  await page.getByRole('button', { name: '立即安装该插件' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`确认安装「${name}」`)).toBeVisible({ timeout: 15_000 });
  await clickInstallAndAwaitToast(page, dialog, name);
  await expect(page.getByRole('button', { name: /已安装/ })).toBeVisible();
}

/** 导入页：展开 <details>、粘贴 JSON、填 slug、点「导入并上架」。 */
async function importViaUI(page: Page, manifest: unknown, slug: string) {
  await page.goto('/marketplace/import');
  await expect(page.getByRole('heading', { name: '导入插件文件' })).toBeVisible({ timeout: 30_000 });
  // 清单 textarea 藏在 <details> 里：先点 summary 展开，否则填不进去
  await page.getByText('或者直接粘贴 JSON 内容').click();
  await page.getByLabel('插件清单 JSON').fill(JSON.stringify(manifest, null, 2));
  await page.getByPlaceholder('my-site-pack').fill(slug);
  // 「导入后立即安装」默认勾选：提交前确认默认态（导入即装的链路前提）
  await expect(page.getByLabel('导入后立即安装')).toBeChecked();
  await page.getByRole('button', { name: '导入并上架' }).click();
}

/** 按插件名定位它在列表里的卡片（与星标 spec 同款 div.rounded-2xl 圈定）。 */
function pluginCard(page: Page, name: string) {
  return page.locator('div.rounded-2xl').filter({ hasText: name }).first();
}

test.describe('插件市场 P3-5：import / mine / 作者页 / 详情 tab 切换', () => {
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

  test('导入页：粘贴非法 JSON → 报错并不上架', async ({ page }) => {
    await page.goto('/marketplace/import');
    await expect(page.getByRole('heading', { name: '导入插件文件' })).toBeVisible({ timeout: 30_000 });

    await page.getByText('或者直接粘贴 JSON 内容').click();
    await page.getByLabel('插件清单 JSON').fill('{不是合法 JSON');
    await page.getByRole('button', { name: '导入并上架' }).click();
    await expect(page.getByRole('alert')).toContainText('JSON 无法解析');
    // 报错后无成功态、不跳详情：仍在导入页
    await expect(page).toHaveURL(/\/marketplace\/import$/);
    await expect(page.getByText('已导入并上架')).not.toBeVisible();
  });

  test('导入页：匿名导入 → 401 请先登录 +「去登录」进登录页', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 匿名导入包 ${stamp}`;
    const slug = `e2e-import-anon-${stamp}`;

    // 匿名调导入接口会被网关 401（scope=admin）：页面应给「请先登录」+ 去登录入口，
    // 而不是把 Unauthorized 技术串甩给用户
    await importViaUI(page, sitePackManifest(name, stamp), slug);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('请先登录', { timeout: 30_000 });
    await expect(alert.getByRole('link', { name: '去登录' })).toBeVisible();
    await alert.getByRole('link', { name: '去登录' }).click();
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('导入页：粘贴清单 JSON → 导入上架并自动安装 → 查看详情进详情页', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 导入包 ${stamp}`;
    const slug = `e2e-import-${stamp}`;

    // 导入接口 scope=admin：成功链路先以管理员登录——与页面自身的登录门控一致
    await loginViaAdmin(page);
    await importViaUI(page, sitePackManifest(name, stamp), slug);

    // 成功态：结果面板出现（导入 + 自动安装均完成），可点「查看详情」
    await expect(
      page.getByText(`「${name}」已导入并上架，且已完成安装。`),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('link', { name: '查看详情' }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}$`));
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
    // 自动安装已落账：详情页即「已安装」态
    await expect(page.getByRole('button', { name: /已安装/ })).toBeVisible();

    // 导入即上架：市场列表能搜到它（公开可见的 ground truth）
    await page.goto(`/marketplace?q=${encodeURIComponent(name)}`);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('导入页：同名插件再次导入 → 409 拒绝、不覆盖', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 同名包 ${stamp}`;
    const manifest = sitePackManifest(name, stamp);

    // 先用管理员导入通道落库一个同名插件（直接上架）
    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest, slug: `e2e-import-dup-first-${stamp}` },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 再从导入页导入同名清单（换一个 slug）：应 409 拒绝，绝不静默覆盖
    await loginViaAdmin(page);
    await importViaUI(page, manifest, `e2e-import-dup-second-${stamp}`);
    await expect(page.getByRole('alert')).toContainText('同名插件已存在', { timeout: 30_000 });
    await expect(page.getByText('已导入并上架')).not.toBeVisible();
    await expect(page).toHaveURL(/\/marketplace\/import$/);
  });

  test('导入页：勾选「导入后立即安装」导入主题 → 主题立即激活', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 导入主题 ${stamp}`;
    const slug = `e2e-import-theme-${stamp}`;

    await loginViaAdmin(page);
    await importViaUI(page, themeManifest(name, stamp), slug);
    await expect(
      page.getByText(`「${name}」已导入并上架，且已完成安装。`),
    ).toBeVisible({ timeout: 30_000 });
    // 导入页导入主题后立即调 setActiveTheme：html 挂上该主题强调色
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  });

  test('作者中心 /mine：待审行内操作（手动发版本 / AI 工坊升级 / 预览）', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 我的插件包 ${stamp}`;
    const slug = `e2e-mine-${stamp}`;
    // 浏览器身份与投稿身份必须是同一个 anonId，否则 /mine 看不到这条投稿：
    // 先把 anonId 写进 localStorage（每次导航都注入，保证投稿前后一致），
    // 再用同一个 anonId 走 API 投稿。
    const anonId = `anon-e2e-mine-${stamp}`;
    await page.addInitScript((id: string) => {
      window.localStorage.setItem('navhub.anonId', id);
    }, anonId);

    // 投稿：进 pending 待审队列（与 plugin-market.spec.ts 的投稿用例同一通道）
    const published = await page.request.post(`/api/hub/plugins?anonId=${anonId}`, {
      data: { manifest: sitePackManifest(name, stamp) },
    });
    expect(published.ok(), `投稿失败 ${published.status()}: ${await published.text()}`).toBeTruthy();

    // 作者中心：待审徽章计数 1、插件行可见且标「待审核」
    await page.goto('/marketplace/mine');
    await expect(page.getByRole('heading', { name: '我的插件' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('待审核 1')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('共 1 个')).toBeVisible();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('待审核', { exact: true }).first()).toBeVisible();

    // 1) 手动发版本：进投稿页 ?from=<slug>，插件名已按原清单预填
    await page.getByRole('link', { name: '手动发版本' }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace/publish\\?from=${slug}$`));
    await expect(page.getByRole('heading', { name: '投稿发布新插件' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('插件名称')).toHaveValue(name, { timeout: 30_000 });

    // 2) AI 工坊升级：行内打开工坊弹窗，再 Esc 关闭回列表
    await page.goto('/marketplace/mine');
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'AI 工坊升级' }).click();
    const studioDialog = page.getByRole('dialog');
    await expect(studioDialog.getByText('AI 智能插件工坊')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(studioDialog).not.toBeVisible({ timeout: 15_000 });

    // 3) 预览：待审记录走预览通道（/marketplace/<slug>/preview），详情可读
    await page.getByRole('link', { name: '预览', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}/preview$`));
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
  });

  test('作者中心 /mine：取数失败 → 失败态、点重试恢复', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 我的重试包 ${stamp}`;
    const anonId = `anon-e2e-mine-retry-${stamp}`;
    await page.addInitScript((id: string) => {
      window.localStorage.setItem('navhub.anonId', id);
    }, anonId);

    const published = await page.request.post(`/api/hub/plugins?anonId=${anonId}`, {
      data: { manifest: sitePackManifest(name, stamp) },
    });
    expect(published.ok(), `投稿失败 ${published.status()}: ${await published.text()}`).toBeTruthy();

    // 掐断作者中心取数：首屏只显失败态、不渲染「你还没有提交过插件」空态断言
    await page.route('**/api/hub/plugins/mine*', (route) => route.abort());
    await page.goto('/marketplace/mine');
    await expect(page.getByTestId('marketplace-load-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('我的插件加载失败')).toBeVisible();
    await expect(page.getByText('你还没有提交过插件')).not.toBeVisible();

    // 恢复网络后点重试：列表恢复，投稿重新可见
    await page.unroute('**/api/hub/plugins/mine*');
    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('待审核 1')).toBeVisible();
  });

  test('作者页：列表卡片作者链接 → 作者页作品与统计 → 点作品卡片回详情页', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 作者页包 ${stamp}`;
    const slug = `e2e-author-${stamp}`;
    const author = `E2E 作者 ${stamp}`;

    // 直接上架通道导入（带 author，卡片才渲染作者链接）
    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: {
        manifest: { ...sitePackManifest(name, stamp), author },
        slug,
      },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 市场列表卡片上的作者链接（plugin-card.tsx:539，从未被点过）进作者页
    await page.goto(`/marketplace?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    const card = pluginCard(page, name);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('link', { name: author, exact: true }).click();
    await expect(page).toHaveURL(/\/marketplace\/author\//);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(author);
    // 作者页作品与聚合统计真实渲染
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/个已上架插件/)).toBeVisible();
    // 未认证作者不显示认证徽章（反面断言；已认证置位无 API 写入口，见文件头）
    await expect(page.getByTestId('author-verified-badge')).toHaveCount(0);

    // 点作者页里的作品卡片 → 回到该插件详情页
    await page.getByRole('link', { name: new RegExp(name) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}$`));
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
  });

  test('作者页：作品 >100 时「加载更多」翻页', async ({ page }) => {
    // 101 次管理导入建数（导入接口不限流），放宽单用例预算
    test.setTimeout(300_000);
    const stamp = Date.now().toString(36);
    const firstName = `E2E 作者翻页包 0 ${stamp}`;
    const firstSlug = `e2e-author-page-${stamp}-0`;

    for (let i = 0; i < 101; i++) {
      const imported = await adminRequest.post('/api/hub/plugins/import', {
        data: {
          manifest: sitePackManifest(`E2E 作者翻页包 ${i} ${stamp}`, `${stamp}-${i}`),
          slug: `e2e-author-page-${stamp}-${i}`,
        },
      });
      expect(imported.ok(), `第 ${i} 个导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();
    }

    // 管理导入的归属都是管理员身份：从详情取该作者的 ownerKey
    const detail = await adminRequest.get(`/api/hub/plugins/${firstSlug}`);
    expect(detail.ok(), `详情读取失败 ${detail.status()}`).toBeTruthy();
    const ownerKey = (await detail.json()).plugin?.ownerKey as string | undefined;
    expect(ownerKey, '详情未返回 ownerKey，作者页 URL 无从构造').toBeTruthy();

    // 作者页首屏只取 100 条：翻页按钮标明（100/总数），总数含本轮其他用例
    // 的管理导入、不硬编码 101
    await page.goto(`/marketplace/author/${ownerKey}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 60_000 });
    const loadMore = page.getByRole('button', { name: /加载更多（100\/\d+）/ });
    await expect(loadMore).toBeVisible({ timeout: 60_000 });

    // 点加载更多：追加页到达后按钮消失（已全部加载），首个导入的作品出现
    await loadMore.click();
    await expect(page.getByRole('button', { name: /加载更多/ })).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByText(firstName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('详情页 tab 切换：diff / impact / raw 全点', async ({ page, context }) => {
    // 导入、安装、发版、审核步数多，放宽单用例预算
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

    const stamp = Date.now().toString(36);
    const name = `E2E Tab 包 ${stamp}`;
    const slug = `e2e-tabs-${stamp}`;
    const v2SiteTitle = `E2E Tab v2 站 ${stamp}`;
    const v2SiteUrl = `https://e2e-tab2-${stamp}.example.com`;

    // v1：1 个站点；v2：保留 v1 站点、新增 1 个 v2 独有站点
    const v1 = sitePackManifest(name, stamp);
    const v2 = {
      ...sitePackManifest(name, stamp, { url: v2SiteUrl, title: v2SiteTitle }),
      version: '2.0.0',
    };

    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest: v1, slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();
    await installSitePackViaUI(page, name, slug);

    // 作者提交 v2 → 管理员审核上架 v2（与卸载 spec 的回滚用例同一通道）
    const submitted = await adminRequest.post(`/api/hub/plugins/${slug}/versions`, {
      data: { manifest: v2, changelog: 'E2E Tab 测试 v2：新增一个站点' },
    });
    expect(submitted.ok(), `提交 v2 失败 ${submitted.status()}: ${await submitted.text()}`).toBeTruthy();
    const approved = await adminRequest.post(`/api/hub/plugins/${slug}/review`, {
      data: { action: 'approve' },
    });
    expect(approved.ok(), `审核 v2 失败 ${approved.status()}: ${await approved.text()}`).toBeTruthy();

    // 回到详情页：已装 v1、市场最新 v2，升级入口出现
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByRole('button', { name: '平滑升级到 v2.0.0' })).toBeVisible({ timeout: 30_000 });

    // 1) diff tab：已装 v1 → 市场 v2 的真实差异（新增站点 + v2 独有站点名）
    await page.getByRole('tab', { name: '版本差异对比' }).click();
    await expect(page).toHaveURL(/[?&]tab=diff/);
    const diffPanel = page.locator('#plugin-tabpanel-diff');
    await expect(diffPanel.getByText('新增站点')).toBeVisible({ timeout: 15_000 });
    await expect(diffPanel.getByText(v2SiteTitle)).toBeVisible();

    // 2) impact tab：影响评估面板（标题 + v2 新增站点域名在列）
    await page.getByRole('tab', { name: '影响评估与指标' }).click();
    await expect(page).toHaveURL(/[?&]tab=impact/);
    const impactPanel = page.locator('#plugin-tabpanel-impact');
    await expect(impactPanel.getByText('安装影响评估')).toBeVisible({ timeout: 15_000 });
    await expect(impactPanel.getByText('新增站点')).toBeVisible();
    await expect(impactPanel.getByText(v2SiteUrl)).toBeVisible();

    // 3) raw tab：清单源码（v2 清单 JSON + 复制按钮点按变「已复制」）
    await page.getByRole('tab', { name: '清单源码 (JSON)' }).click();
    await expect(page).toHaveURL(/[?&]tab=raw/);
    const rawPanel = page.locator('#plugin-tabpanel-raw');
    await expect(rawPanel.getByText(`${slug}.navhub-plugin.json`)).toBeVisible({ timeout: 15_000 });
    await expect(rawPanel.getByText('"version": "2.0.0"')).toBeVisible();
    await rawPanel.getByRole('button', { name: '复制插件 JSON' }).click();
    await expect(rawPanel.getByRole('button', { name: '插件 JSON 已复制' })).toBeVisible({ timeout: 10_000 });
    // 按钮「已复制」态 2.5s 后回落：剪贴板读回才是复制链路的持久 ground truth
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
      .toContain(name);
  });
});
