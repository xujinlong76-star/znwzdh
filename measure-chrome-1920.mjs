import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('visited', '1'); localStorage.setItem('subtitle-hint-dismissed', '1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3120', { waitUntil: 'commit', timeout: 60000 })
await p.waitForSelector('main a[href]', { timeout: 60000 })
await p.waitForTimeout(5000)
const r = await p.evaluate(() => {
  const out = []
  const pick = (sel, label) => {
    const els = [...document.querySelectorAll(sel)]
    for (const el of els.slice(0, 3)) {
      const rc = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      out.push({ label, tag: el.tagName, cls: (el.className.baseVal ?? el.className + '').toString().slice(0, 80), top: Math.round(rc.top), h: Math.round(rc.height), pt: cs.paddingTop, pb: cs.paddingBottom, mt: cs.marginTop, mb: cs.marginBottom, gap: cs.gap })
    }
  }
  pick('header', 'header')
  pick('main', 'main')
  pick('main > div', 'main>div')
  pick('#quick-access-tray', 'dock')
  pick('main h2', 'h2')
  pick('[role="tablist"]', 'tablist')
  pick('input[type="search"]', 'search-input')
  // h1s
  const h1s = [...document.querySelectorAll('h1')].map(h => ({ text: (h.textContent || '').slice(0, 40), top: Math.round(h.getBoundingClientRect().top), cls: (h.className + '').slice(0, 60) }))
  // walk main children top-level
  const mainKids = [...document.querySelector('main').children].map(el => ({ tag: el.tagName, cls: (el.className + '').slice(0, 60), top: Math.round(el.getBoundingClientRect().top), h: Math.round(el.getBoundingClientRect().height) }))
  // first card grid
  const firstCard = document.querySelector('main a[href]')
  const fc = firstCard ? firstCard.getBoundingClientRect() : null
  return { out, h1s, mainKids, firstCardTop: fc ? Math.round(fc.top) : null, firstCardH: fc ? Math.round(fc.height) : null }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
