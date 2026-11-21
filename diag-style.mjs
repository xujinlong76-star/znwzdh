import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'networkidle', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
await p.waitForTimeout(8000)
const r = await p.evaluate(() => {
  const h = document.querySelector('[role="note"][aria-label="副标题提示"]')
  const cs = h ? getComputedStyle(h) : null
  const card = document.querySelector('main a[href]')
  const cardRc = card ? card.getBoundingClientRect() : null
  // 检查 text-xs 是否生效：找一个 text-xs 元素
  const xs = document.querySelector('.text-xs')
  const xsCs = xs ? getComputedStyle(xs) : null
  return {
    hintFont: cs ? cs.fontSize : null,
    hintLine: cs ? cs.lineHeight : null,
    hintH: h ? Math.round(h.getBoundingClientRect().height) : null,
    cardWH: cardRc ? `${Math.round(cardRc.width)}x${Math.round(cardRc.height)}` : null,
    textXsFont: xsCs ? xsCs.fontSize : null,
    // 统计有多少样式表加载
    styleSheets: document.styleSheets.length,
  }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
