import { chromium } from '@playwright/test'
const BASE = 'http://127.0.0.1:3120'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
const browser = await chromium.launch({ headless: true, executablePath: SHELL, args: ['--no-sandbox','--no-proxy-server','--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
await page.waitForTimeout(8000)
await page.screenshot({ path: 'verify-evidence/v1920-baseline.png' })
const r = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('main a[href]')]
    .map((a) => { const rc = a.getBoundingClientRect(); return { top: Math.round(rc.top), w: Math.round(rc.width), h: Math.round(rc.height), cls: (a.className||'').toString().slice(0,90), href: (a.getAttribute('href')||'').slice(0,30) } })
    .filter((c) => c.w >= 200 && c.h >= 80 && c.w <= 400)
  // distinct heights
  const heights = {}
  for (const c of cards) heights[c.h] = (heights[c.h]||0)+1
  // first 6 cards full detail
  const first6 = cards.slice(0,6)
  // grid container: find the grid holding the first card
  const first = document.querySelector('main a[href]')
  let grid = first
  for (let i=0;i<6 && grid;i++) { if (grid.className && grid.className.toString().includes('grid')) break; grid = grid.parentElement }
  const gridCls = grid ? (grid.className||'').toString().slice(0,200) : 'not-found'
  const gridRect = grid ? grid.getBoundingClientRect() : null
  // main content width
  const main = document.querySelector('main')
  const mainRect = main ? main.getBoundingClientRect() : null
  // sidebar width
  const aside = document.querySelector('aside')
  const asideRect = aside ? aside.getBoundingClientRect() : null
  return { heights, first6, gridCls, gridW: gridRect ? Math.round(gridRect.width) : null, mainX: mainRect ? Math.round(mainRect.left) : null, mainW: mainRect ? Math.round(mainRect.width) : null, asideW: asideRect ? Math.round(asideRect.width) : null, asideVisible: asideRect ? asideRect.width > 0 : false }
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
console.log('DONE')
