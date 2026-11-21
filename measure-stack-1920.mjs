import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('visited', '1'); localStorage.setItem('subtitle-hint-dismissed', '1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3120', { waitUntil: 'commit', timeout: 60000 })
await p.waitForSelector('main a[href]', { timeout: 60000 })
await p.waitForTimeout(5000)
const r = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('main a[href]')]
    .map(a => ({ el: a, rc: a.getBoundingClientRect() }))
    .filter(x => x.rc.width >= 200 && x.rc.height >= 80)
  const first = cards[0].el
  const chain = []
  let el = first
  while (el && el !== document.body) {
    const rc = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    chain.push({ tag: el.tagName, cls: (el.className + '').slice(0, 70), top: Math.round(rc.top), h: Math.round(rc.height), pt: cs.paddingTop, pb: cs.paddingBottom, mt: cs.marginTop, mb: cs.marginBottom })
    el = el.parentElement
  }
  // children of the main content div (top 57, the px-3... div) that are above first card
  const contentDiv = [...document.querySelectorAll('main > div')].find(d => d.getBoundingClientRect().top === 57)
  const kids = contentDiv ? [...contentDiv.children].map(c => {
    const rc = c.getBoundingClientRect()
    const cs = getComputedStyle(c)
    return { tag: c.tagName, cls: (c.className + '').slice(0, 70), top: Math.round(rc.top), h: Math.round(rc.height), pt: cs.paddingTop, pb: cs.paddingBottom, mt: cs.marginTop, mb: cs.marginBottom }
  }).filter(k => k.top < 400) : []
  // sticky header children
  const sticky = document.querySelector('main > div.sticky')
  const stickyKids = sticky ? [...sticky.children].map(c => {
    const rc = c.getBoundingClientRect()
    return { tag: c.tagName, cls: (c.className + '').slice(0, 70), top: Math.round(rc.top), h: Math.round(rc.height) }
  }) : []
  // gap between rows: second row top - first row top
  const rows = {}
  for (const c of cards) { const t = Math.round(c.rc.top); (rows[t] = rows[t] || []).push(c) }
  const rowTops = Object.keys(rows).map(Number).sort((a, b) => a - b)
  return { chain, kids, stickyKids, rowTops: rowTops.slice(0, 5), firstCard: { top: Math.round(cards[0].rc.top), h: Math.round(cards[0].rc.height), w: Math.round(cards[0].rc.width) } }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
