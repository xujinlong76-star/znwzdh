import { chromium } from '@playwright/test'
const b = await chromium.launch({ headless: true, executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox','--no-proxy-server','--disable-gpu'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { localStorage.setItem('visited', '1'); localStorage.setItem('subtitle-hint-dismissed', '1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3120', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(6000)
const r = await p.evaluate(() => {
  const grid = document.querySelector('[data-nav-grid]')
  const cols = grid?.getAttribute('data-grid-cols')
  // per-group visible card count for the first folded group
  const firstGrid = document.querySelector('[data-nav-grid][data-grid-folded]')
  let visibleInFirst = 0
  if (firstGrid) {
    visibleInFirst = [...firstGrid.querySelectorAll('[data-navhub-site-id]')].filter(el => getComputedStyle(el).display !== 'none').length
  }
  // count tall cards in view
  const tall = [...document.querySelectorAll('main a[href]')].map(a=>{const rc=a.getBoundingClientRect();return{h:Math.round(rc.height),top:Math.round(rc.top)}}).filter(c=>c.h===154&&c.top<900&&c.top+c.h>0)
  return { cols, visibleInFirst, tallInView: tall.length }
})
console.log(JSON.stringify(r))
await b.close()
