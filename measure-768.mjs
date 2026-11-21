import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 768, height: 1024 } })
await ctx.addInitScript(() => { localStorage.setItem('navhub:visited', '1'); localStorage.setItem('navhub:subtitle-hint-dismissed', '1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3120', { waitUntil: 'commit', timeout: 60000 })
await p.waitForTimeout(8000)
const r = await p.evaluate(() => {
  const links = [...document.querySelectorAll('main a[href]')]
  const sizes = links.map(a => { const rc = a.getBoundingClientRect(); return { w: Math.round(rc.width), h: Math.round(rc.height), top: Math.round(rc.top) } })
  const big = sizes.filter(s => s.w >= 200 && s.h >= 80)
  const h2 = document.querySelector('main h2')?.textContent
  const sidebar = document.querySelector('[class*="sidebar"]')?.getBoundingClientRect()
  return { totalLinks: links.length, bigCount: big.length, sample: sizes.slice(0, 8), h2, bodyText: document.body.innerText.slice(0, 120) }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
