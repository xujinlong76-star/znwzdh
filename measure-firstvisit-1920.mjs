// 首访态量取：不设任何 localStorage（副标题提示出现，+42px chrome）
import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3120', { waitUntil: 'commit', timeout: 60000 })
await p.waitForSelector('main a[href]', { timeout: 60000 })
await p.waitForTimeout(5000)
const r = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('main a[href]')]
    .map(a => a.getBoundingClientRect())
    .filter(rc => rc.width >= 200 && rc.height >= 80 && rc.width <= 400)
  const seen = new Set(); const uniq = []
  for (const rc of cards) {
    const k = `${Math.round(rc.top)}-${Math.round(rc.left)}`
    if (seen.has(k)) continue; seen.add(k); uniq.push(rc)
  }
  const vh = window.innerHeight
  const inView = uniq.filter(c => c.top < vh && c.top + c.height > 0)
  const full = inView.filter(c => c.top >= 0 && c.top + c.height <= vh)
  let area = 0
  for (const c of inView) area += c.width * (Math.min(vh, c.top + c.height) - Math.max(0, c.top))
  const hint = document.querySelector('[role="note"][aria-label="副标题提示"]')
  return { chromeH: Math.round(Math.min(...uniq.map(c => c.top))), fullCount: full.length, partialCount: inView.length - full.length, exposure: +(area / (window.innerWidth * vh) * 100).toFixed(1), hintVisible: !!hint }
})
console.log(JSON.stringify(r))
await p.screenshot({ path: 'verify-evidence/v1920-firstvisit.png' })
await b.close()
