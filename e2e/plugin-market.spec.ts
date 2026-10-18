import { test, expect } from '@playwright/test';

/**
 * 核心旅程：插件市场（声明式插件的浏览、安装与审核链路）。
 *
 * 覆盖设计文档（docs/PLUGIN-MARKET-DESIGN-2026-10-19.md §九）验收口径中的两条端到端：
 *   1. 市场浏览 → 详情预览 → 一键安装网址包（含确认弹窗与安装后状态）
 *   2. 发布入库（pending）→ 管理员审核上架 → 市场公开可见
 *
 * 说明：
 *   - 发布走 API 通道（import / publish）落库，聚焦审核状态机与市场可见性主干，
 *     同时避免发布限流（5/hour）在 CI 重试时被耗尽；
 *   - 每次运行使用时间戳生成唯一名称 / URL / slug，不与既有数据冲突。
 */

function sitePackManifest(name: string, stamp: string) {
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
      ],
    },
  };
}

async function gotoAdmin(page: any, path: string) {
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
  // 管理页受保护时会重定向到登录页：走开放模式「一键进入」并在点击后等待回跳完成
  if (page.url().includes('/auth/signin') || page.url().includes('/login')) {
    const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进入/ });
    await expect(bypassBtn).toBeVisible({ timeout: 15_000 });
    await bypassBtn.click();
    await page.waitForURL(
      (url: URL) =>
        !url.pathname.startsWith('/auth/signin') && !url.pathname.startsWith('/login'),
      { timeout: 30_000 },
    );
  }
}

/**
 * 点击「立即安装」并等待成功 toast。
 *
 * 冷启动（CI 首次 dev 编译）存在 React 水合竞态：弹窗按钮已可见但事件处理器
 * 尚未绑定，首击会静默丢失（点击本身不报错）。这里在未出现 toast 且弹窗仍在时
 * 补击一次，消除这类环境性抖动。
 */
async function clickInstallAndAwaitToast(page: any, dialog: any, name: string) {
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

test.describe('插件市场：浏览、安装与审核链路', () => {
  // 本套件含发布动作（中枢限流 5 次/小时）：CI 重试上限收紧为 1，
  // 全套件连重试的最坏发布量 ≤4 < 5，避免 429 被重试打满后污染结果。
  test.describe.configure({ retries: 1 });

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

  test('浏览 → 详情 → 一键安装网址包', async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 网址包 ${stamp}`;
    const slug = `e2e-pack-${stamp}`;

    // 通过导入通道落库（直接上架、无发布限流）
    const imported = await request.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(name, stamp), slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 列表页：搜索定位到刚导入的插件
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    await page.getByLabel('搜索插件').fill(name);
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

    // 详情页：标题与影响摘要
    await page.getByRole('link', { name: new RegExp(name) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}`));
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);

    // 一键安装：确认弹窗 → 立即安装（含冷启动水合补击）
    await page.getByRole('button', { name: '立即安装该插件' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认安装「${name}」`)).toBeVisible();
    await clickInstallAndAwaitToast(page, dialog, name);

    // 刷新后仍显示「已安装」：安装结果对该浏览器身份真实落账
    await page.reload();
    await expect(page.getByRole('button', { name: /已安装/ })).toBeVisible();
  });

  test('发布入库（待审）→ 管理员审核上架 → 市场公开可见', async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 待审包 ${stamp}`;

    // 1. 发布：进入 pending 待审队列
    const published = await request.post('/api/hub/plugins', {
      data: { manifest: sitePackManifest(name, stamp) },
    });
    expect(published.ok(), `发布失败 ${published.status()}: ${await published.text()}`).toBeTruthy();

    // 2. 待审阶段：市场检索不到
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    await page.getByLabel('搜索插件').fill(name);
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.getByText('没有匹配的插件，换个筛选条件试试')).toBeVisible();

    // 3. 管理员审核上架（开放模式下自动通过一键进入）
    await gotoAdmin(page, '/admin/plugins');
    await expect(page.getByRole('heading', { name: '插件市场审核管理' })).toBeVisible({ timeout: 45_000 });
    const card = page.locator('div.rounded-2xl').filter({ hasText: name }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: '通过并上架' }).click();
    await expect(page.getByText(`已通过审核并上架「${name}」！`)).toBeVisible();

    // 4. 上架后：市场公开可见
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    await page.getByLabel('搜索插件').fill(name);
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test('全链路 UI 驱动：投稿向导填报 -> 校验 -> 管理后台上架审核 -> 市场卡片渲染 -> 一键安装并动态激活主题', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const themeName = `E2E 霓虹主题 ${stamp}`;
    const themeDesc = `Playwright 自动化测试专用主题，用于验证完整的投稿、审核与动态激活链路。`;
    const themePayload = JSON.stringify({
      accent: 'violet',
      tokens: {
        '--primary': '262 83% 58%',
        '--ring': '262 83% 58%',
        '--radius': '0.85rem',
      },
    });

    // 1. 进入投稿发布页
    await page.goto('/marketplace/publish');
    await expect(page.getByRole('heading', { name: '投稿发布新插件' })).toBeVisible({ timeout: 30_000 });

    // 步骤 1：选择插件类型（配色主题）
    await page.getByRole('button', { name: /配色主题/ }).click();

    // 步骤 2：填写基础元数据
    await page.getByLabel('插件名称').fill(themeName);
    await page.getByLabel('版本号').fill('1.0.0');
    await page.getByLabel('详细描述').fill(themeDesc);
    await page.getByLabel('作者称谓').fill('E2E 测试助手');

    // 步骤 3：定义内容载荷
    await page.getByLabel('内容载荷 JSON').fill(themePayload);

    // 预检校验
    await page.getByRole('button', { name: '预检校验' }).click();
    await expect(page.getByText('预检校验通过！该清单完全符合 NavHub 规范')).toBeVisible();

    // 提交发布
    await page.getByRole('button', { name: '立即提交审核' }).click();
    await expect(page.getByRole('heading', { name: '投稿发布成功！' })).toBeVisible({ timeout: 30_000 });

    // 2. 进入管理后台审核上架
    await gotoAdmin(page, '/admin/plugins');
    await expect(page.getByRole('heading', { name: '插件市场审核管理' })).toBeVisible({ timeout: 45_000 });
    const pendingCard = page.locator('div.rounded-2xl').filter({ hasText: themeName }).first();
    await expect(pendingCard).toBeVisible({ timeout: 30_000 });
    await pendingCard.getByRole('button', { name: '通过并上架' }).click();
    await expect(page.getByText(`已通过审核并上架「${themeName}」！`)).toBeVisible();

    // 3. 市场浏览与卡片渲染
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    // 切换到「主题」分类筛选
    await page.getByLabel('按类型筛选').selectOption('theme');
    // 检索该插件
    await page.getByLabel('搜索插件').fill(themeName);
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.getByText(themeName, { exact: true }).first()).toBeVisible();

    // 4. 进入详情页并一键安装
    await page.getByRole('link', { name: new RegExp(themeName) }).first().click();
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(themeName);

    // 点击安装（含冷启动水合补击）
    await page.getByRole('button', { name: '立即安装该插件' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认安装「${themeName}」`)).toBeVisible();
    await clickInstallAndAwaitToast(page, dialog, themeName);

    // 5. 验证主题动态注入激活
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
    const primaryColor = await page.evaluate(() => document.documentElement.style.getPropertyValue('--primary'));
    expect(primaryColor.trim()).toBe('262 83% 58%');
  });
});
