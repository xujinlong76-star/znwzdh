import { chromium } from '@playwright/test'
const b = await chromium.launch({ headless: true, executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox','--no-proxy-server','--disable-gpu'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { localStorage.setItem('visited', '1'); localStorage.setItem('subtitle-hint-dismissed', '1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3120', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(6000)
const r = await p.evaluate(() => {
  const rail = document.querySelector('[role="tablist"][aria-label*="子分类"]')
  if (!rail) return { found: false }
  const before = rail.scrollLeft
  rail.scrollLeft += 200
  const after = rail.scrollLeft
  const allBtn = [...rail.querySelectorAll('button, a')].find(el => /全部/.test(el.textContent || ''))
  // count visible cards + check 4-col orphan rule: at 1280 the grid should be ~4 cols, folded groups show 4 cards
  const cards = [...document.querySelectorAll('main a[href]')].map(a=>{const rc=a.getBoundingClientRect();return{w:Math.round(rc.width),h:Math.round(rc.height),top:Math.round(rc.top)}}).filter(c=>c.w>=200&&c.h>=80&&c.w<=400&&c.h===154)
  const gridCols = document.querySelector('[data-nav-grid]')?.getAttribute('data-grid-cols')
  return { found: true, scrollWidth: rail.scrollWidth, clientWidth: rail.clientWidth, scrollable: rail.scrollWidth > rail.clientWidth, scrolled: after > before, hasAll: !!allBtn, tallCards: cards.length, gridCols }
})
console.log(JSON.stringify(r))
await b.close()
