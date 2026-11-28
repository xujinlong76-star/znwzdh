import { test, expect } from '@playwright/test';

/**
 * SPEC-首访信任-2026-11-27（v2）· AC-3.1b 降级条位置 e2e（W26 新增，只加测试）。
 *
 * 只验一件事：降级条出现在**分类流上方**，且**不在 Bento 网格内**
 * （`[data-bento-canvas]` / `[data-bento-block-id]` 作用域内不含降级条）。
 *
 * 造数说明（与 SPEC §6.5② 的差异，如实记录）：
 *  - SPEC 建议「拦截 /api/hub/* 导航分片返回坏数据」，但首页导航分片是**服务端**
 *    `loadNavigationCatalog()` 直读存储适配器（`lib/github.ts` → API `/api/storage`），
 *    不经浏览器 `/api/hub/*`，`page.route` 根本拦不到（它只能拦浏览器发出的请求）。
 *  - 本仓库 E2E 的数据库每轮由 `scripts/e2e-web-server.mjs` 清空重建且**不播种**
 *    （见 e2e/global-setup.ts 头注释与 playwright.config 的 webServer 段）。空库下
 *    分片索引缺失 → `loadNavigationCatalog()` 走 `fallback()` → `degraded: true`，
 *    首页渲染的正是「分片缺失回落整包读」的真实降级态，不需要伪造接口。
 *  - 因此本用例直接利用这条真实链路；若未来 E2E 改为播种导航数据，本用例会**红**，
 *    那时应改用受控存储桩，而不是把断言放宽。
 */

test.describe('AC-3.1b · 降级条位置：分类流上方、Bento 之外', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * 复签隔离修复（不放宽任何断言）：本用例依赖「分片索引不可用 → 回落整包 → degraded=true」
   * 的真实降级态。同簇 first-visit-settings-and-empty.spec.ts 的 beforeAll 会往共享 E2E 库
   * 种一份**合法**的单分类导航索引（非降级），Playwright 按 project 重跑时第二个 project 起
   * 就读到被污染的库 → 降级条不渲染 → 本用例假红（实测：合跑 2 red / 单跑 3/3 绿）。
   *
   * 按本文件头注释的指引「改用受控存储桩，而不是把断言放宽」：这里显式写一个 kind 非法的
   * 索引桩，强制 parseIndex 判失败 → fallback → 降级态，与本轮之前有没有种子无关。
   * 空库 publicDoc 为空，ensureNavigationShardsFresh 不会自愈覆盖本桩（直接 return false）。
   */
  test.beforeAll(async ({ playwright }) => {
    const req = await playwright.request.newContext();
    try {
      const apiPort = Number(process.env.NAVHUB_API_PORT || 8787);
      const res = await req.put(`http://127.0.0.1:${apiPort}/api/storage`, {
        data: {
          path: 'src/navsphere/content/navigation-index.json',
          content: JSON.stringify({
            kind: 'navhub-navigation-index-degraded-test-stub',
            sourceVersion: 424242,
            totalItems: 0,
            categories: [],
            replacementHistory: [],
          }),
        },
      });
      expect(res.status(), `降级索引桩写入失败: ${await res.text()}`).toBe(200);
    } finally {
      await req.dispose();
    }
  });

  test('降级条可见、带重试，且不在 [data-bento-canvas] / [data-bento-block-id] 内', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '打开今日中心小窗', exact: true })).toBeVisible({
      timeout: 60_000,
    });

    const banner = page
      .getByRole('status')
      .filter({ hasText: '导航数据暂时取不到，下面是兜底内容。' });
    await expect(banner).toBeVisible({ timeout: 30_000 });

    // 明确是「降级」而不是「空库/用户隐藏」：重试入口必须在
    await expect(banner.getByRole('button', { name: '重试' })).toBeVisible();

    // 位置层：任何 Bento 作用域里都不许出现该降级条
    expect(
      await page.locator('[data-bento-canvas] [role="status"]').filter({ hasText: '导航数据暂时取不到' }).count(),
      '降级条不得出现在 [data-bento-canvas] 内',
    ).toBe(0);
    expect(
      await page.locator('[data-bento-block-id] [role="status"]').filter({ hasText: '导航数据暂时取不到' }).count(),
      '降级条不得作为 Bento 网格块渲染',
    ).toBe(0);

    // 上方关系：降级条的纵坐标必须小于分类网格顶边（若网格已渲染）
    const bento = page.locator('[data-bento-canvas]').first();
    if (await bento.count()) {
      const bannerBox = await banner.boundingBox();
      const bentoBox = await bento.boundingBox();
      expect(bannerBox, '降级条应有布局盒').not.toBeNull();
      expect(bentoBox, '分类网格应有布局盒').not.toBeNull();
      expect(bannerBox!.y).toBeLessThan(bentoBox!.y);
    }

    // 降级 + 空分类时不得把「隐藏/没有」当唯一解释（§4 口径）
    await expect(page.getByText('当前所有分类已被隐藏', { exact: true })).toHaveCount(0);
  });
});
