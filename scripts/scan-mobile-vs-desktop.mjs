
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  for (const vp of [{ w: 390, h: 844, m: true }, { w: 1440, h: 900, m: false }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m })
    const page = await ctx.newPage()
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    const info = await page.evaluate(() => ({
      cards: document.querySelectorAll('[data-navhub-site-id]').length,
      domNodes: document.getElementsByTagName('*').length,
      scrollH: document.body.scrollHeight,
      expandButtons: Array.from(document.querySelectorAll('button')).filter(b => (b.textContent||'').includes('展开全部')).length
    }))
    console.log(vp.w + 'px:', JSON.stringify(info))
    await ctx.close()
  }
  await browser.close()
})()
