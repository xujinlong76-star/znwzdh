import { expect, test } from '@playwright/test'

// 回归：豆包本地图标缺失导致首页 404。
// 根因：LOCAL_LOGO_MAP 里 doubao.com / www.doubao.com 指向
// /assets/images/logos/doubao.png，但 apps/web/public/assets/images/logos/ 并无此文件
//（且覆盖层该目录被镜像排除，补文件也同步不过来）。
// 修复：豆包官方 CDN 的 64x64 PNG 放入覆盖层 public/brand-icons/doubao.png，
// 映射改指 /brand-icons/doubao.png（与 npm/pnpm/vite/vue 同例）。

test.use({ viewport: { width: 1920, height: 1080 } })

test('品牌图标：豆包本地图标加载成功且无本地图标 404', async ({ page }) => {
  test.setTimeout(180_000)
  const failedLocalAssets: string[] = []
  const doubaoRequests: string[] = []
  page.on('response', (r) => {
    const url = r.url()
    if ((url.includes('/assets/images/logos/') || url.includes('/brand-icons/')) && r.status() >= 400) {
      failedLocalAssets.push(`${r.status()} ${url}`)
    }
    if (url.includes('doubao')) doubaoRequests.push(`${r.status()} ${url}`)
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)

  const doubao = await page.evaluate(() => {
    const img = document.querySelector('img[alt="豆包 图标"]') as HTMLImageElement | null
    return img
      ? { src: img.getAttribute('src'), currentSrc: img.currentSrc, naturalWidth: img.naturalWidth, complete: img.complete }
      : null
  })
  expect(doubao, '应渲染豆包卡片图标').not.toBeNull()
  expect(doubao!.src).toBe('/brand-icons/doubao.png')
  expect(doubao!.complete).toBe(true)
  expect(doubao!.naturalWidth).toBeGreaterThan(0)
  expect(doubaoRequests.some((u) => u.includes('/assets/images/logos/doubao.png'))).toBe(false)
  expect(doubaoRequests.some((u) => u.startsWith('200') && u.includes('/brand-icons/doubao.png'))).toBe(true)
  expect(failedLocalAssets).toEqual([])
})
