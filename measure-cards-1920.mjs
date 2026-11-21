import { chromium } from '@playwright/test'
const BASE = process.argv[2] || 'http://127.0.0.1:3120'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
const browser = await chromium.launch({ headless: true, executablePath: SHELL, args: ['--no-sandbox','--no-proxy-server','--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
await page.waitForTimeout(6000)
const r = await page.evaluate(() => {
  const vw = window.innerWidth, vh = window.innerHeight
  const cards = [...document.querySelectorAll('main a[href]')]
    .map((a) => { const rc = a.getBoundingClientRect(); return { top: Math.round(rc.top), left: Math.round(rc.left), w: Math.round(rc.width), h: Math.round(rc.height), href: (a.getAttribute('href')||'').slice(0,40) } })
    .filter((c) => c.w >= 200 && c.h >= 80 && c.w <= 400)
  // group by top (row)
  const rows = {}
  for (const c of cards) { const k = c.top; (rows[k] = rows[k] || []).push(c) }
  const rowList = Object.entries(rows).map(([top, cs]) => ({ top: +top, n: cs.length, h: cs[0].h, w: cs[0].w, bottom: +top + cs[0].h }))
  rowList.sort((a,b) => a.top - b.top)
  // exposure if chrome cut by X: simulate by shifting all card tops up by X
  const exposureAt = (cut) => {
    let area = 0, full = 0
    for (const c of cards) {
      const t = c.top - cut, b = t + c.h
      if (t < vh && b > 0) {
        area += c.w * (Math.min(vh, b) - Math.max(0, t))
        if (t >= 0 && b <= vh) full++
      }
    }
    return { cut, full, exposure: +((area / (vw*vh))*100).toFixed(1) }
  }
  return { rowList: rowList.slice(0, 10), sim: [0,40,70,85,120,160,200,250].map(exposureAt) }
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
console.log('DONE')
