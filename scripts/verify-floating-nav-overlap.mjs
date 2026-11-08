
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  for (const [label, vp] of [['desktop 1440', { width: 1440, height: 900, isMobile: false }], ['mobile 390', { width: 390, height: 844, isMobile: true }]]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.isMobile })
    const page = await ctx.newPage()
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    // 滚动以唤醒浮动快捷导航
    await page.evaluate(() => window.scrollTo(0, 1200))
    await page.waitForTimeout(1500)

    const info = await page.evaluate(() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
      const hit = (el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)) }
      const aside = document.getElementById('navhub-floating-quick-nav')
      const diy = Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('title') || '').includes('DIY'))
      const out = { aside: null, diy: null, overlap: false }
      if (aside && getComputedStyle(aside).opacity !== '0') {
        out.aside = { ...rect(aside), clickable: hit(aside) }
      }
      if (diy) out.diy = { ...rect(diy), clickable: hit(diy) }
      if (out.aside && out.diy) {
        out.overlap = !(out.aside.x + out.aside.w <= out.diy.x || out.diy.x + out.diy.w <= out.aside.x || out.aside.y + out.aside.h <= out.diy.y || out.diy.y + out.diy.h <= out.aside.y)
      }
      out.docWidth = { scroll: document.documentElement.scrollWidth, win: window.innerWidth }
      return out
    })
    console.log(label + ': ' + JSON.stringify(info))
    await ctx.close()
  }
  await browser.close()
})()
