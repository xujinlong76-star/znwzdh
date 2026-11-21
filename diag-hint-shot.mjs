import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
const p = await ctx.newPage()
const t0 = Date.now()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'commit', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
// 轮询等提示展开
let occ = -1, tries = 0
while (tries++ < 100) {
  occ = await p.evaluate(() => {
    const h = document.querySelector('[role="note"][aria-label="副标题提示"]')
    if (!h) return -1
    const rc = h.getBoundingClientRect()
    return Math.round(rc.height + parseFloat(getComputedStyle(h).marginBottom))
  })
  if (occ > 0) break
  await p.waitForTimeout(200)
}
console.log(`hint expanded at +${Date.now()-t0}ms, occupied=${occ}`)
const info = await p.evaluate(() => {
  const h = document.querySelector('[role="note"][aria-label="副标题提示"]')
  const rc = h.getBoundingClientRect()
  const cs = getComputedStyle(h)
  return { top: Math.round(rc.top), left: Math.round(rc.left), w: Math.round(rc.width), h: Math.round(rc.height), opacity: cs.opacity, display: cs.display, vis: cs.visibility, scrollY: window.scrollY, text: h.textContent.trim().slice(0,30) }
})
console.log('hint rect:', JSON.stringify(info))
await p.screenshot({ path: 'verify-evidence/diag-hint-expanded.png' })
console.log(`screenshot taken at +${Date.now()-t0}ms`)
await b.close()
