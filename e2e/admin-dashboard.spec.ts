import { test, expect } from '@playwright/test';
import { gotoAdminPage } from './helpers';

test.describe('管理端控制台与运营洞察看板 E2E 测试', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminPage(page, '/admin', '运营与监控中枢');
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

    // 验证深入分析卡片（第一张在 723d640 换成了慢请求排障榜，标题随之改变）
    await expect(page.locator('text=耗时最高路由排障')).toBeVisible();
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
    await gotoAdminPage(page, '/admin/stats', '运营与搜索洞察看板');

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
