
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const small = await page.evaluate(() => {
    const isTabbable = (el) => {
      if (el.disabled) return false
      const ti = el.getAttribute('tabindex')
      if (ti !== null) { const n = parseInt(ti, 10); return !isNaN(n) && n >= 0 }
      return ['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(el.tagName)
    }
    const all = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(isTabbable)
    const small = all.map(el => {
      const r = el.getBoundingClientRect()
      return { tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().slice(0, 30) }
    }).filter(x => x.w > 0 && x.h > 0 && (x.w < 24 || x.h < 24))
    const hist = {}
    for (const s of small) { const k = s.w + 'x' + s.h; hist[k] = (hist[k] || 0) + 1 }
    const labels = {}
    for (const s of small) { const k = s.label.replace(/[「」]/g, '').slice(0, 16); labels[k] = (labels[k] || 0) + 1 }
    return { count: small.length, hist: Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,8), topLabels: Object.entries(labels).sort((a,b)=>b[1]-a[1]).slice(0,8) }
  })
  console.log(JSON.stringify(small, null, 2))
  await browser.close()
})()
