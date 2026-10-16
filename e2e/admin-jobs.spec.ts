import { test, expect } from '@playwright/test';

test.describe('核心旅程 5：管理端任务调度与 SSE 实时推流', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/jobs');
    await page.waitForLoadState('domcontentloaded');
    if (page.url().includes('/auth/signin')) {
      const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进入/ });
      await expect(bypassBtn).toBeVisible({ timeout: 10_000 });
      await bypassBtn.click();
    }
    // 等待已成功进入管理页且主标题呈现
    await expect(page.locator('h1').filter({ hasText: '任务调度与自动化中心' })).toBeVisible({ timeout: 45_000 });
    // 等待数据加载完成
    await expect(page.locator('text=正在装载任务队列…')).not.toBeVisible({ timeout: 25_000 });
  });

  test('管理端任务页面正常装载且展示 SSE 状态徽章与统计卡片', async ({ page }) => {
    await expect(page.locator('text=任务调度与自动化中心')).toBeVisible();
    // 验证 SSE 状态徽章存在（实时推流或轮询检测）
    await expect(page.locator('text=推流已就绪').or(page.locator('text=轮询监测中'))).toBeVisible();
    // 验证统计卡片
    await expect(page.locator('text=总任务数')).toBeVisible();
    await expect(page.locator('text=执行中')).toBeVisible();
    await expect(page.locator('text=排队等待')).toBeVisible();
  });

  test('快捷入队：支持一键触发热度重算任务并即时在队列中呈现', async ({ page }) => {
    // 触发热度重算任务
    const recomputeBtn = page.getByRole('button', { name: /热度重算/ });
    await expect(recomputeBtn).toBeVisible();
    await recomputeBtn.click();

    // 验证列表中出现热度重算记录
    await expect(page.locator('tr').filter({ hasText: '热度重算' }).first()).toBeVisible({ timeout: 10_000 });

    // 验证清理历史按钮与操作列表头
    await expect(page.getByRole('button', { name: /清理 7d 历史/ })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: '操作' })).toBeVisible();
  });
});
