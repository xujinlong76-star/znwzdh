
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const t0 = Date.now()
  await page.goto('http://localhost:3000', { waitUntil: 'commit' })
  let appeared = null
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { visible: r.width > 0 && r.height > 0, bottom: Math.round(window.innerHeight - r.bottom), right: Math.round(window.innerWidth - r.right) }
    })
    if (ok) { appeared = { ms: Date.now() - t0, ...ok }; break }
    await page.waitForTimeout(500)
  }
  console.log('DIY button appeared on mobile:', JSON.stringify(appeared))

  // 若出现，检查是否被底部导航遮挡（元素中心点的 topmost 元素）
  const occlusion = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
    if (!b) return null
    const r = b.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { topmost: el ? (el.tagName + '.' + (el.className || '').toString().slice(0, 60)) : null, isSelf: el === b || b.contains(el) }
  })
  console.log('occlusion:', JSON.stringify(occlusion))
  await browser.close()
})()
