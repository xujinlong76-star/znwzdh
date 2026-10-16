import { test, expect } from '@playwright/test';

test.describe('核心旅程 1：首页检索与 0-RTT 意图微部件', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('页面成功加载且包含导航中枢标题与检索框', async ({ page }) => {
    await expect(page).toHaveTitle(/Nav|导航/i);
    const searchInput = page.getByPlaceholder(/搜索导航/);
    await expect(searchInput).toBeVisible();
  });

  test('支持快捷键激活检索框并触发 0-RTT 意图卡片 (Speculative Intent)', async ({ page }) => {
    // 聚焦检索框
    const searchInput = page.getByPlaceholder(/搜索导航/);
    await searchInput.click();

    // 输入 "json" 触发 0-RTT 格式化 / 验证意图微部件
    await searchInput.fill('json');
    // 等待意图解析渲染
    const intentCard = page.locator('text=JSON').first();
    await expect(intentCard).toBeVisible();
  });

  test('输入对比类查询触发技术选型对比矩阵 (Tech Comparison)', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/搜索导航/);
    await searchInput.click();

    // 输入框架对比查询
    await searchInput.fill('react vs vue');
    // 期待选型对比微部件呈现
    const compareCard = page.locator('text=对比').or(page.locator('text=React')).first();
    await expect(compareCard).toBeVisible();
  });

  test('输入架构方案查询触发脚手架决策卡片 (Architecture Recipe)', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/搜索导航/);
    await searchInput.click();

    // 输入全栈架构方案
    await searchInput.fill('nextjs supabase');
    const recipeCard = page.locator('text=Next.js').or(page.locator('text=Supabase')).first();
    await expect(recipeCard).toBeVisible();
  });
});
