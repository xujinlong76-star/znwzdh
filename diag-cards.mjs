import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'commit', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
await p.waitForTimeout(6000)
const r = await p.evaluate(() => {
  const vh = window.innerHeight
  const all = [...document.querySelectorAll('main a[href]')]
  const cards = all.map(a => { const rc = a.getBoundingClientRect(); return {w: Math.round(rc.width), h: Math.round(rc.height), top: Math.round(rc.top), left: Math.round(rc.left), href: (a.getAttribute('href')||'').slice(0,40), text: (a.textContent||'').trim().slice(0,20)} })
  const filt = cards.filter(c => c.w >= 200 && c.h >= 80 && c.w <= 400)
  const rows = {}
  for (const c of filt) { const k = c.top; rows[k] = (rows[k]||0)+1 }
  return { totalLinks: all.length, filtCount: filt.length, rows, sample: filt.slice(0,8), vh, scrollY: window.scrollY, docH: document.documentElement.scrollHeight }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
