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

test.describe('插件市场：浏览、安装与审核链路', () => {
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

    // 一键安装：确认弹窗 → 立即安装
    await page.getByRole('button', { name: '立即安装该插件' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认安装「${name}」`)).toBeVisible();
    await dialog.getByRole('button', { name: '立即安装' }).click();
    await expect(page.getByText(`成功安装「${name}」！`)).toBeVisible();

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

    // 3. 管理员审核上架（开放模式无需登录）
    await page.goto('/admin/plugins');
    await expect(page.getByRole('heading', { name: '插件市场审核管理' })).toBeVisible();
    const card = page.locator('div.rounded-2xl').filter({ hasText: name }).first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '通过并上架' }).click();
    await expect(page.getByText(`已通过审核并上架「${name}」！`)).toBeVisible();

    // 4. 上架后：市场公开可见
    await page.goto('/marketplace');
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
    await expect(page.getByRole('heading', { name: '投稿发布新插件' })).toBeVisible();

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
    await expect(page.getByRole('heading', { name: '投稿发布成功！' })).toBeVisible();

    // 2. 进入管理后台审核上架
    await page.goto('/admin/plugins');
    await expect(page.getByRole('heading', { name: '插件市场审核管理' })).toBeVisible();
    const pendingCard = page.locator('div.rounded-2xl').filter({ hasText: themeName }).first();
    await expect(pendingCard).toBeVisible();
    await pendingCard.getByRole('button', { name: '通过并上架' }).click();
    await expect(page.getByText(`已通过审核并上架「${themeName}」！`)).toBeVisible();

    // 3. 市场浏览与卡片渲染
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    // 切换到「配色主题」分类 Tab
    await page.getByRole('button', { name: /配色主题/ }).click();
    // 检索该插件
    await page.getByLabel('搜索插件').fill(themeName);
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.getByText(themeName, { exact: true }).first()).toBeVisible();

    // 4. 进入详情页并一键安装
    await page.getByRole('link', { name: new RegExp(themeName) }).first().click();
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(themeName);

    // 点击安装
    await page.getByRole('button', { name: '立即安装该插件' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认安装「${themeName}」`)).toBeVisible();
    await dialog.getByRole('button', { name: '立即安装' }).click();
    await expect(page.getByText(`成功安装「${themeName}」！`)).toBeVisible();

    // 5. 验证主题动态注入激活
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
    const primaryColor = await page.evaluate(() => document.documentElement.style.getPropertyValue('--primary'));
    expect(primaryColor.trim()).toBe('262 83% 58%');
  });
});
