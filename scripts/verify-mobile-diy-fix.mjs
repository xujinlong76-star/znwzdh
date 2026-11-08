
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
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
      if (!b) return null
      const r = b.getBoundingClientRect()
      if (r.width === 0) return null
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        bottom: Math.round(window.innerHeight - r.bottom),
        right: Math.round(window.innerWidth - r.right),
        left: Math.round(r.left),
        clickable: el === b || b.contains(el),
        topmost: el ? el.tagName : null
      }
    })
    if (ok && ok.clickable) { appeared = { ms: Date.now() - t0, ...ok }; break }
    if (ok && !appeared) appeared = { ms: Date.now() - t0, ...ok, note: 'visible but not clickable yet' }
    await page.waitForTimeout(500)
  }
  console.log('mobile DIY:', JSON.stringify(appeared, null, 2))

  // 真点击一次，验证能进入编辑态
  const entered = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
    if (!b) return false
    b.click()
    return true
  })
  await page.waitForTimeout(900)
  const hud = await page.evaluate(() => {
    const h = document.querySelector('[data-diy-hud="true"]')
    if (!h) return null
    const r = h.getBoundingClientRect()
    const el = document.elementFromPoint(Math.min(r.right - 8, r.left + 40), r.top + r.height / 2)
    return { bottom: Math.round(window.innerHeight - r.bottom), h: Math.round(r.height), topmost: el ? el.tagName : null }
  })
  console.log('entered:', entered, 'HUD on mobile:', JSON.stringify(hud))
  await page.screenshot({ path: 'C:/Users/88/Desktop/web/mobile-diy-fixed.png' })
  await browser.close()
})()
