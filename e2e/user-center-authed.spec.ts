import { expect, test, type Page } from '@playwright/test';

/**
 * 用户中心登录态旅程（T12）：补上此前只有匿名态的盲区。
 *
 * 登录复用 admin-token.spec 验证过的路径：先到 /admin/tokens 走开发快捷通道
 * （服务端渲染的管理页可见 = 会话 cookie 确凿生效），再导航到目标页——
 * 直接在 /me 的回调变体上点旁路按钮在本环境不可靠（2026-10-24 实测）。
 */
async function loginViaAdmin(page: Page): Promise<void> {
  await page.goto('/admin/tokens', { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/auth/signin')) {
    const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进入/ });
    await expect(bypassBtn).toBeVisible({ timeout: 10_000 });
    await bypassBtn.click();
    await expect(page.locator('main#main-content h1').filter({ hasText: 'API Token 访问凭据管理' })).toBeVisible({ timeout: 45_000 });
  }
}

test.describe('用户中心：登录态', () => {
  test('登录后 /me 概览进入 ready 态（统计卡与入口组可见）', async ({ page }) => {
    await loginViaAdmin(page);
    await page.goto('/me', { waitUntil: 'domcontentloaded' });
    // ready 态的标志：账号卡出现「管理账号」入口；匿名态只有「登录 / 创建账号」
    await expect(page.getByRole('link', { name: /管理账号/ }).first()).toBeVisible({ timeout: 45_000 });
    // 统计区（aria-label 是 StatsGrid 的语义锚点）
    await expect(page.locator('section[aria-label="用户数据概览"]')).toBeVisible({ timeout: 30_000 });
  });

  test('账号页挂载设备管理面板与令牌面板（T8/T20）', async ({ page }) => {
    await loginViaAdmin(page);
    await page.goto('/me/account', { waitUntil: 'domcontentloaded' });
    // 设备面板（T8）：标题可见；列表可能为空（旧会话无行），但区块必须在
    await expect(page.getByRole('heading', { name: '登录设备' })).toBeVisible({ timeout: 45_000 });
    // 令牌面板（T20）：创建入口可见
    await expect(page.getByRole('heading', { name: '个人 API 令牌' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /创建令牌/ })).toBeVisible();
  });

  test('个人令牌创建：明文一次性展示并可继续吊销（T20）', async ({ page }) => {
    await loginViaAdmin(page);
    await page.goto('/me/account', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /创建令牌/ })).toBeVisible({ timeout: 45_000 });
    const tokenName = `pw-${Date.now().toString(36)}`;
    await page.getByLabel('令牌名称').fill(tokenName);
    await page.getByRole('button', { name: /创建令牌/ }).click();
    // 明文一次性展示（role=status 的提示区；避免与 toast 文案的双匹配）
    await expect(page.getByText('已创建——明文只显示这一次')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: '复制' })).toBeVisible();
    // 「我已保存」收起明文
    await page.getByRole('button', { name: '我已保存' }).click();
    await expect(page.getByText('已创建——明文只显示这一次')).not.toBeVisible();
    // 列表里出现该令牌，走吊销两步确认
    const row = page.locator('li', { hasText: tokenName });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: '吊销' }).click();
    await row.getByRole('button', { name: '确认吊销' }).click();
    await expect(row).not.toBeVisible({ timeout: 20_000 });
  });

  test('通知页渲染（T13）：区块四态至少其一可见', async ({ page }) => {
    await loginViaAdmin(page);
    await page.goto('/me/notifications', { waitUntil: 'domcontentloaded' });
    // loading/error/empty/ready 四态任一：用「加载中或空态或列表」宽松断言
    await expect(
      page.getByText('正在加载通知')
        .or(page.getByText('还没有通知'))
        .or(page.getByText('通知暂时取不到'))
        .or(page.locator('ul.divide-y').first())
    ).toBeVisible({ timeout: 45_000 });
  });
});
