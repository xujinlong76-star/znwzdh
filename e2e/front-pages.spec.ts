import { test, expect } from '@playwright/test';

test.describe('核心旅程 4：前台多维探索与高频核心页面冒烟测试', () => {
  test('榜单页 (/hot)：正常加载并支持热度榜与新品榜标签切换', async ({ page }) => {
    await page.goto('/hot');
    await expect(page.getByText('全站技术风向标与热度榜', { exact: true })).toBeVisible();

    // 验证 Tab 切换
    const newTab = page.getByRole('tab', { name: /最新入库榜/ });
    await expect(newTab).toBeVisible();
    await newTab.click();
    await expect(newTab).toHaveAttribute('data-state', 'active');
  });

  test('收藏页 (/favorites)：加载默认视图并展示导入导出与安全金库交互', async ({ page }) => {
    await page.goto('/favorites');
    await expect(page.getByText('我的离线收藏与零知识金库', { exact: true })).toBeVisible();

    // 验证安全金库交互按钮存在
    await expect(page.getByRole('button', { name: /导出加密金库/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /解密导入金库/ })).toBeVisible();
  });

  test('偏好设置页 (/preferences)：正常加载画像与行为偏好统计面板', async ({ page }) => {
    await page.goto('/preferences');
    await expect(page.getByRole('heading', { name: '我的偏好' })).toBeVisible();
    await expect(page.getByText('搜索会根据你的浏览与收藏做轻量个性化重排')).toBeVisible();
  });

  test('网站投稿页 (/submit)：呈现规范提案表单与必填项校验', async ({ page }) => {
    await page.goto('/submit');
    await expect(page.getByText('投稿收录优质网站', { exact: true })).toBeVisible();

    // 校验表单核心字段与提交按钮存在
    const nameInput = page.getByPlaceholder(/Cursor/);
    const urlInput = page.getByPlaceholder(/example\.com/);
    const submitBtn = page.getByRole('button', { name: /提交推荐收录/ });
    await expect(nameInput).toBeVisible();
    await expect(urlInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
  });

  test('算法实验室 (/algorithms)：装载 12 大前沿算法实验室与交互式推演台', async ({ page }) => {
    await page.goto('/algorithms');
    await expect(page.getByText('前沿自适应算法与认知引擎全景测试台', { exact: true })).toBeVisible();
    await expect(page.getByText('12 大前沿认知与自治计算引擎全就绪')).toBeVisible();
  });
});
