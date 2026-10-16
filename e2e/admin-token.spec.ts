import { test, expect } from '@playwright/test';

test.describe('核心旅程 3：管理端 API Token 签发与生命周期管理', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/tokens');
    await page.waitForLoadState('domcontentloaded');
    if (page.url().includes('/auth/signin')) {
      const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进入/ });
      await expect(bypassBtn).toBeVisible({ timeout: 10_000 });
      await bypassBtn.click();
    }
    // 等待已成功进入管理页且页面主标题呈现（留足 Next.js 首次编译路由裕量）
    await expect(page.locator('h1').filter({ hasText: 'API Token 访问凭据管理' })).toBeVisible({ timeout: 45_000 });
    // 等待 React 水合就绪且 Token 列表加载完成
    await expect(page.locator('text=正在加载 Token 列表…')).not.toBeVisible({ timeout: 25_000 });
  });

  test('管理端凭据页面正常加载并展示标题与新建按钮', async ({ page }) => {
    await expect(page.locator('text=API Token 访问凭据管理')).toBeVisible();
    const createBtn = page.getByRole('button', { name: /创建新 Token/ });
    await expect(createBtn).toBeVisible();
  });

  test('完整创建流程：表单输入校验、Token 签发、明文弹窗呈现与同名拦截', async ({ page }) => {
    const testTokenName = `pw-token-${Date.now().toString(36)}`;

    // 1. 打开创建弹窗
    await page.getByRole('button', { name: /创建新 Token/ }).click();
    await expect(page.locator('text=生成新的 API 访问凭据')).toBeVisible();

    // 2. 填写 Token 名称并回车提交签发（权限默认即为读写）
    const nameInput = page.getByPlaceholder(/例如: claude-desktop-agent/);
    await nameInput.fill(testTokenName);
    await nameInput.press('Enter');

    // 4. 验证安全明文弹窗出现
    await expect(page.locator('text=Token 明文（仅此一次）')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /复制 Token 明文/ })).toBeVisible();

    // 关闭明文弹窗
    await page.keyboard.press('Escape');

    // 5. 验证列表中存在新创建的 Token
    await expect(page.locator(`text=${testTokenName}`)).toBeVisible();

    // 6. 同名冲突拦截：再次尝试创建完全同名的 Token 应被前端与后端安全拦截
    await page.getByRole('button', { name: /创建新 Token/ }).click();
    await nameInput.fill(testTokenName);
    await nameInput.press('Enter');

    // 验证出现同名冲突提示
    await expect(page.getByText('名称已存在', { exact: true })).toBeVisible();
  });
});
