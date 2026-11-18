import { test, expect } from '@playwright/test'

/**
 * U-92 + U-62a：EntryGroups 徽章 E2E（/me 匿名态）。
 *
 *  - U-92：fetchPlugins({ limit: 1 }) 在浏览器里实际打
 *    /api/hub/plugins?limit=1（hubUrl 剥掉 /api 前缀再拼 BASE），故桩该路径；
 *    total=42 →「42 款生态」；500 → 中性「插件生态」。
 *  - U-62a：localStorage 预置 2 条清单 →「2 部在追」，点击卡片落 /me/watchlist。
 *    键名与 src/lib/watchlist.ts 的 WATCHLIST_STORAGE_KEY 一致；条目只含
 *    sanitizeWatchEntry 认的三字段（title/platformSiteId/playUrl）。
 */
test.describe('EntryGroups 徽章：U-92 插件计数 + U-62a 追剧清单', () => {
  // 只拦「取目录总数」那一次请求（limit=1）：其它 limit 的插件请求放行，
  // 避免把 /me 上别的插件取数一起桩死。
  const catalogTotalRoute = (url: URL) =>
    url.pathname === '/api/hub/plugins' && url.searchParams.get('limit') === '1'

  test('U-92：目录 total=42 时插件徽章显示「42 款生态」', async ({ page }) => {
    await page.route(catalogTotalRoute, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 42, limit: 1, offset: 0 }),
      }),
    )
    await page.goto('/me')
    await expect(page.locator('[data-telemetry="plugins"]').first()).toHaveText('42 款生态')
  })

  test('U-92：取数 500 时插件徽章落中性「插件生态」', async ({ page }) => {
    await page.route(catalogTotalRoute, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )
    await page.goto('/me')
    await expect(page.locator('[data-telemetry="plugins"]').first()).toHaveText('插件生态')
  })

  test('U-62a：本地 2 条追剧清单显示「2 部在追」，点击落 /me/watchlist', async ({ page }) => {
    const entries = [
      { title: '剧A', platformSiteId: 'nav-hongguo', playUrl: 'https://www.hongguo.com' },
      { title: '剧B', platformSiteId: 'nav-hongguo', playUrl: 'https://www.hongguo.com' },
    ]
    await page.addInitScript(
      (value) => window.localStorage.setItem('navhub.watchlist.v1', value),
      JSON.stringify(entries),
    )
    await page.goto('/me')
    await expect(page.locator('[data-telemetry="watchlist"]').first()).toHaveText('2 部在追')
    await page.getByRole('link', { name: /追剧清单/ }).first().click()
    await expect(page).toHaveURL(/\/me\/watchlist$/)
  })
})
