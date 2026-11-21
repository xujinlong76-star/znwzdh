// 量取 1920x911 各 chrome 行的精确高度
import { chromium } from '@playwright/test'
const BASE = process.argv[2] || 'http://127.0.0.1:3120'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
const browser = await chromium.launch({ headless: true, executablePath: SHELL, args: ['--no-sandbox','--no-proxy-server','--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
await page.waitForTimeout(6000)
const rows = await page.evaluate(() => {
  const out = []
  const push = (name, el) => {
    if (!el) { out.push({ name, missing: true }); return }
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    out.push({ name, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom })
  }
  push('toolbar-sticky', document.querySelector('.sticky.top-0'))
  push('toolbar-search-row', document.querySelector('.sticky.top-0 > div.flex'))
  // capsule row (HomeCapsuleRow)
  const capsule = document.querySelector('[role="tablist"][aria-label="工作区视图切换"]')
  push('capsule-row-tablist', capsule)
  push('capsule-row-wrap', capsule?.closest('div[class*="border-b"], div[class*="sticky"]') || capsule?.parentElement?.parentElement)
  push('quick-dock', document.querySelector('#quick-access-tray'))
  push('subtitle-hint', document.querySelector('[aria-label="副标题提示"]'))
  const mainPad = document.querySelector('#main-content > div.px-3')
  push('main-content-pad', mainPad)
  const firstH2 = document.querySelector('main h2')
  push('first-cat-header', firstH2?.closest('div[class*="border-b"]'))
  push('first-subcat-rail', document.querySelector('[role="tablist"][aria-label*="子分类"]'))
  const cards = [...document.querySelectorAll('main a[href]')].filter((a) => { const r = a.getBoundingClientRect(); return r.width >= 200 && r.height >= 80 && r.width <= 400 })
  if (cards.length > 0) {
    const first = cards[0].getBoundingClientRect()
    out.push({ name: 'first-card', top: Math.round(first.top), bottom: Math.round(first.bottom), h: Math.round(first.height) })
    out.push({ name: 'cards-per-row', count: cards.filter((c) => Math.abs(c.getBoundingClientRect().top - first.top) < 5).length })
  }
  // 所有直接位于 main 上方的块级元素（从 top=0 到 first-card.top），列出它们的 tag/class/height
  const all = []
  const walk = (el, depth) => {
    if (depth > 6) return
    for (const ch of el.children) {
      const r = ch.getBoundingClientRect()
      if (r.height > 0 && r.top < 500 && r.bottom > 0) {
        const cls = (ch.className.baseVal ?? ch.className ?? '').toString().slice(0, 80)
        all.push({ tag: ch.tagName, cls, top: Math.round(r.top), h: Math.round(r.height) })
      }
      walk(ch, depth + 1)
    }
  }
  walk(document.body, 0)
  out.push({ name: 'TOP-LEVEL-BLOCKS', items: all.slice(0, 40) })
  return out
})
console.log(JSON.stringify(rows, null, 1))
await browser.close()
console.log('DONE')
