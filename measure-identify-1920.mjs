import { chromium } from '@playwright/test'
const BASE = 'http://127.0.0.1:3120'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
const browser = await chromium.launch({ headless: true, executablePath: SHELL, args: ['--no-sandbox','--no-proxy-server','--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
await page.waitForTimeout(8000)
const r = await page.evaluate(() => {
  const out = {}
  // 92-tall links: what are they?
  const short = [...document.querySelectorAll('main a[href]')]
    .map((a) => { const rc = a.getBoundingClientRect(); return { top: Math.round(rc.top), w: Math.round(rc.width), h: Math.round(rc.height), text: (a.textContent||'').trim().slice(0,30), href: (a.getAttribute('href')||'').slice(0,40), parentCls: (a.parentElement?.className||'').toString().slice(0,60) } })
    .filter((c) => c.h === 92)
  out.short92 = short.slice(0, 12)
  // 154-tall cards: first card top, grid container
  const tall = [...document.querySelectorAll('main a[href]')]
    .map((a) => { const rc = a.getBoundingClientRect(); return { top: Math.round(rc.top), w: Math.round(rc.width), h: Math.round(rc.height) } })
    .filter((c) => c.h === 154)
  out.tall154count = tall.length
  out.tallFirstTop = tall.length ? tall[0].top : null
  // find grid container of a tall card
  const a = [...document.querySelectorAll('main a[href]')].find((el) => { const rc = el.getBoundingClientRect(); return rc.height === 154 })
  let g = a
  for (let i=0;i<8 && g;i++) { const cls=(g.className||'').toString(); if (cls.includes('grid')) break; g = g.parentElement }
  if (g) {
    const cs = getComputedStyle(g)
    const rc = g.getBoundingClientRect()
    out.grid = { cls: (g.className||'').toString().slice(0,160), w: Math.round(rc.width), x: Math.round(rc.left), cols: cs.gridTemplateColumns, gap: cs.gap, maxW: cs.maxWidth }
  }
  // simulate exposure using ONLY 154-tall cards, and using ALL cards
  const vw = window.innerWidth, vh = window.innerHeight
  const sim = (list, cut) => {
    let area=0, full=0
    for (const c of list) { const t=c.top-cut, b=t+c.h; if (t<vh && b>0) { area += c.w*(Math.min(vh,b)-Math.max(0,t)); if (t>=0&&b<=vh) full++ } }
    return { cut, full, exposure: +((area/(vw*vh))*100).toFixed(1) }
  }
  out.simTallOnly = [0,70,85,120,200,300,407].map((cut)=>sim(tall,cut))
  const all = [...document.querySelectorAll('main a[href]')].map((el)=>{const rc=el.getBoundingClientRect();return{top:Math.round(rc.top),w:Math.round(rc.width),h:Math.round(rc.height)}}).filter((c)=>c.w>=200&&c.h>=80&&c.w<=400)
  out.simAll = [0,70,85,120,200,300,407].map((cut)=>sim(all,cut))
  return out
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
console.log('DONE')
