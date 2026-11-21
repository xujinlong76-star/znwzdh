import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('visited', '1'); localStorage.setItem('subtitle-hint-dismissed', '1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3120', { waitUntil: 'commit', timeout: 60000 })
await p.waitForSelector('main a[href]', { timeout: 60000 })
await p.waitForTimeout(5000)
const r = await p.evaluate(() => {
  const seen = new Set()
  const rows = []
  for (const el of document.querySelectorAll('body *')) {
    const rc = el.getBoundingClientRect()
    if (rc.top < 0 || rc.top > 345 || rc.height < 8) continue
    if (rc.width < 100) continue
    const key = `${el.tagName}|${Math.round(rc.top)}|${Math.round(rc.height)}|${Math.round(rc.left)}`
    if (seen.has(key)) continue
    seen.add(key)
    const cls = (el.className && el.className.baseVal === undefined ? el.className + '' : '').slice(0, 55)
    const txt = (el.childElementCount === 0 ? (el.textContent || '').trim().slice(0, 28) : '')
    rows.push({ top: Math.round(rc.top), h: Math.round(rc.height), left: Math.round(rc.left), w: Math.round(rc.width), tag: el.tagName, cls, txt })
  }
  rows.sort((a, b) => a.top - b.top || a.left - b.left)
  return rows
})
for (const x of r) console.log(`${String(x.top).padStart(4)} +${String(x.h).padStart(3)}  x=${String(x.left).padStart(4)} w=${x.w}  ${x.tag} ${x.cls} ${x.txt ? '| ' + x.txt : ''}`)
await b.close()
