import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
const p = await ctx.newPage()
const t0 = Date.now()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'commit', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
console.log(`cards ready at +${Date.now()-t0}ms`)
for (let i = 0; i < 20; i++) {
  await p.waitForTimeout(500)
  const s = await p.evaluate(() => {
    const h = document.querySelector('[role="note"][aria-label="副标题提示"]')
    return {
      hint: !!h,
      hintH: h ? Math.round(h.getBoundingClientRect().height) : null,
      visited: localStorage.getItem('navhub:visited'),
      dismissed: localStorage.getItem('navhub:subtitle-hint-dismissed'),
    }
  })
  console.log(`+${Date.now()-t0}ms hint=${s.hint} h=${s.hintH} visited=${s.visited} dismissed=${s.dismissed}`)
  if (i > 4 && s.hint) break
}
await b.close()
