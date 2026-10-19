import { test, expect } from '@playwright/test';

test.describe('管理端控制台与运营洞察看板 E2E 测试', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    if (page.url().includes('/auth/signin')) {
      const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进入/ });
      await expect(bypassBtn).toBeVisible({ timeout: 10_000 });
      await bypassBtn.click();
    }
    // 等待已成功进入控制台且主标题呈现
    // 收窄到可见主内容区：Next 16 流式水合会在 body 级暂存容器（#S:*）里短暂保留同一份内容，
    // 裸 h1 选择器会撞上 Playwright 严格模式的双元素竞态（2026-10-19 E2E 复跑定位）。
    await expect(page.locator('main#main-content h1').filter({ hasText: '运营与监控中枢' })).toBeVisible({ timeout: 45_000 });
  });

  test('控制台首页展示 6 大核心 KPI、系统轻量态势与 SSE 状态', async ({ page }) => {
    // 验证 SSE 状态徽章存在并等待客户端 React 水合就绪
    await expect(page.locator('text=SSE 遥测就绪')).toBeVisible({ timeout: 20_000 });

    // 验证 6 大核心卡片标题
    await expect(page.locator('text=站点资产规模')).toBeVisible();
    await expect(page.locator('text=24h 站点健康度')).toBeVisible();
    await expect(page.locator('text=API 性能吞吐')).toBeVisible();
    await expect(page.locator('text=自愈与后台任务')).toBeVisible();
    await expect(page.locator('text=安全防护与审计')).toBeVisible();
    await expect(page.locator('text=检索强化学习 (LinUCB)')).toBeVisible();

    // 验证深入分析卡片
    await expect(page.locator('text=HTTP 状态码分布与性能瓶颈')).toBeVisible();
    await expect(page.locator('text=LinUCB 多通道自适应权重')).toBeVisible();
    await expect(page.locator('text=顶级分类收录分布')).toBeVisible();
    await expect(page.locator('text=存储引擎与数据表容量')).toBeVisible();

    // 验证数据库在线维护按钮与自检反馈（水合完成后触发点击）
    const integrityBtn = page.getByRole('button', { name: '完整性自检' });
    await expect(integrityBtn).toBeVisible();
    await integrityBtn.click();
    await expect(page.getByText(/数据库自检.*健康/)).toBeVisible({ timeout: 15_000 });

    // 验证快捷管理导航卡片
    await expect(page.locator('text=导航架构管理')).toBeVisible();
    await expect(page.locator('text=站点列表与录入')).toBeVisible();
    await expect(page.locator('text=自动化任务调度')).toBeVisible();
  });

  test('运营洞察看板页面支持时间窗口切换与趋势折线渲染', async ({ page }) => {
    await page.goto('/admin/stats');
    await page.waitForLoadState('domcontentloaded');
    if (page.url().includes('/auth/signin')) {
      const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进入/ });
      await expect(bypassBtn).toBeVisible({ timeout: 10_000 });
      await bypassBtn.click();
    }

    // 收窄到可见主内容区：Next 16 流式水合会在 body 级暂存容器（#S:*）里短暂保留同一份内容，
    // 裸 h1 选择器会撞上 Playwright 严格模式的双元素竞态（2026-10-19 E2E 复跑定位）。
    await expect(page.locator('main#main-content h1').filter({ hasText: '运营与搜索洞察看板' })).toBeVisible({ timeout: 30_000 });

    // 验证时间跨度选择器存在
    await expect(page.getByRole('button', { name: '近 7 天' })).toBeVisible();
    await expect(page.getByRole('button', { name: '近 14 天' })).toBeVisible();
    await expect(page.getByRole('button', { name: '近 30 天' })).toBeVisible();
    await expect(page.getByRole('button', { name: '近 90 天' })).toBeVisible();

    // 点击切换近 7 天
    await page.getByRole('button', { name: '近 7 天' }).click();
    await expect(page.locator('text=近 7 天系统巡检可用率')).toBeVisible();

    // 验证热门搜索与零结果卡片
    await expect(page.locator('text=热门搜索词 Top 20')).toBeVisible();
    await expect(page.locator('text=零结果搜索（补录线索）')).toBeVisible();
    await expect(page.locator('text=站点综合热度榜 Top 20')).toBeVisible();
  });
});
