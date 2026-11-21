// 稳定基线量取 v2：回访用户，等卡片高度稳定（154px 卡片数连续两次采样不变）再量
import { chromium } from '@playwright/test'
const BASE = 'http://127.0.0.1:3120'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
const browser = await chromium.launch({ headless: true, executablePath: SHELL, args: ['--no-sandbox','--no-proxy-server','--disable-gpu'] })
async function run(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') } catch {} })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
  // 等卡片稳定：每 2s 采样一次 154px 卡片数，连续两次相同即稳定，最多等 30s
  let stable = false
  let lastCount = -1
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000)
    const n = await page.evaluate(() => [...document.querySelectorAll('main a[href]')].filter((a) => { const r = a.getBoundingClientRect(); return r.width >= 200 && r.height === 154 && r.width <= 400 }).length)
    if (n > 0 && n === lastCount) { stable = true; break }
    lastCount = n
  }
  const r = await page.evaluate(({ tag, stable }) => {
    const vw = window.innerWidth, vh = window.innerHeight
    const row = (name, el) => { if (!el) return { name, missing: true }; const rc = el.getBoundingClientRect(); return { name, top: Math.round(rc.top), bottom: Math.round(rc.bottom), h: Math.round(rc.height) } }
    const rows = []
    rows.push(row('toolbar', document.querySelector('.sticky.top-0 > div.flex')))
    rows.push(row('quick-dock', document.querySelector('#quick-access-tray')))
    rows.push(row('cat-header', document.querySelector('main h2')?.closest('div[class*="border-b"]')))
    rows.push(row('subcat-rail', document.querySelector('[role="tablist"][aria-label*="子分类"]')))
    const cards = [...document.querySelectorAll('main a[href]')].map((a)=>{const rc=a.getBoundingClientRect();return{top:Math.round(rc.top),w:Math.round(rc.width),h:Math.round(rc.height)}}).filter((c)=>c.w>=200&&c.h>=80&&c.w<=400)
    const tall = cards.filter((c)=>c.h===154)
    const inView = tall.filter((c)=>c.top<vh&&c.top+c.h>0)
    const full = inView.filter((c)=>c.top>=0&&c.top+c.h<=vh)
    let area=0; for (const c of inView) area += c.w*(Math.min(vh,c.top+c.h)-Math.max(0,c.top))
    const firstCard = tall.length ? tall[0] : null
    return { tag, stable, chromeH: firstCard?firstCard.top:null, fullTall: full.length, partialTall: inView.length-full.length, fullAll: cards.filter((c)=>c.top>=0&&c.top+c.h<=vh&&c.top<vh).length, exposureTall: +((area/(vw*vh))*100).toFixed(1), rows }
  }, { tag, stable })
  console.log(JSON.stringify(r))
  await ctx.close()
  return r
}
await run('run1')
await run('run2')
await browser.close()
console.log('DONE')
