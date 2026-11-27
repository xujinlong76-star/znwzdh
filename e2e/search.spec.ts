import { test, expect, type Page } from '@playwright/test';

async function openSearch(page: Page) {
  const trigger = page.getByRole('button', { name: /搜索站点、标签或拼音/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const input = page.locator('[data-search-input]');
  await expect(input).toBeVisible();
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-search-input]');
    return !!el && Object.keys(el).some((key) => key.startsWith('__reactFiber$'));
  });
  return input;
}

test.describe('核心旅程 1：首页检索与 0-RTT 意图微部件', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('页面成功加载且包含导航中枢标题与检索框', async ({ page }) => {
    await expect(page).toHaveTitle(/Nav|导航/i);
    const searchInput = await openSearch(page);
    await expect(searchInput).toBeVisible();
  });

  test('支持快捷键激活检索框并触发 0-RTT 意图卡片 (Speculative Intent)', async ({ page }) => {
    // 聚焦检索框
    const searchInput = await openSearch(page);

    // 输入 JSON 串触发 0-RTT 格式化 / 验证意图微部件
    await searchInput.fill('{"name":"navhub"}');
    // 等待 0-RTT 意图卡片渲染
    await expect(page.locator('text=0-RTT 推测执行').first()).toBeVisible();
  });

  test('输入对比类查询触发技术选型对比矩阵 (Tech Comparison)', async ({ page }) => {
    const searchInput = await openSearch(page);

    // 输入框架对比查询
    await searchInput.fill('react vs vue');
    // 期待选型对比微部件呈现
    const compareCard = page.locator('text=对比').or(page.locator('text=React')).first();
    await expect(compareCard).toBeVisible();
  });

  test('输入架构方案查询触发脚手架决策卡片 (Architecture Recipe)', async ({ page }) => {
    const searchInput = await openSearch(page);

    // 输入全栈架构方案
    await searchInput.fill('nextjs supabase');
    const recipeCard = page.locator('text=Next.js').or(page.locator('text=Supabase')).first();
    await expect(recipeCard).toBeVisible();
  });
});

test.describe('冷启动搜索快捷键：首访第一次 ⌘K 不应静默失灵', () => {
  test('冷启动直接按 ⌘/Ctrl+K，懒挂载的顶栏搜索框应出现并获得焦点', async ({ page }) => {
    // 刚 goto 完不做任何点击：测的是首访第一次按键，不点搜索框。
    await page.goto('/');
    // 等水合完成：网格列数已写入 data-grid-cols = 客户端 effects 已跑，
    // 全局网守的 keydown 监听已挂上。注意：这里不能等「搜索占位 button」——
    // 顶栏的 ssr:false loading 占位是 div 不是 button，全仓没有 name 匹配
    // /搜索站点、标签或拼音/ 的 button（2026-11-26 实测：旧等待在此超时，
    // 用例在按键前就死了，网守兜底路径根本没被测到）。
    // 也不等 [data-search-input]：面板 chunk 可能还在加载，input 未必已挂载——
    // 测的正是这条兜底路径（chunk 已加载时走网守直接聚焦，未加载时走
    // focusSearchInputWhenReady 等 input 出现再聚焦；两种时序都应以输入框获焦告终）。
    await page.waitForFunction(
      () => document.querySelectorAll('[data-grid-cols]').length > 0,
      undefined,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(800);
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.locator('[data-search-input]');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await expect(input).toBeFocused();
  });
});
