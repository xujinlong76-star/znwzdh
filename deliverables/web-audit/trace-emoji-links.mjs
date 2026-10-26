import { chromium } from '@playwright/test'

const BASE = 'http://127.0.0.1:3000'
const CANDIDATES = [
  '/marketplace',
  '/marketplace/installed',
  '/me/plugins',
  '/custom',
  '/',
  '/graph',
  '/sites',
]

const isEmojiPath = (href) => {
  try {
    const u = new URL(href, BASE)
    if (!u.pathname.startsWith('/marketplace/')) return false
    return /[^\x00-\x7F]/.test(u.pathname) || /%[89A-F][0-9A-F]/i.test(u.pathname)
  } catch { return false }
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()

for (const path of CANDIDATES) {
  try {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(2500)
    const found = await page.evaluate(() => {
      const out = []
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || ''
        if (!href.includes('/marketplace/')) continue
        out.push({
          href,
          text: (a.textContent || '').trim().slice(0, 60),
          aria: a.getAttribute('aria-label') || '',
          cls: (a.className || '').toString().slice(0, 80),
          parentCls: (a.parentElement?.className || '').toString().slice(0, 80),
        })
      }
      return out
    })
    const emojis = found.filter((x) => /[^\x00-\x7F]/.test(decodeURI(x.href)) || /%[89A-F][0-9A-F]/i.test(x.href))
    console.log(`\n### ${path} :: total=${found.length}, emojiLikely=${emojis.length}`)
    for (const e of emojis.slice(0, 20)) console.log('   ', JSON.stringify(e))
  } catch (e) {
    console.log(`\n### ${path} :: ERROR ${String(e).slice(0, 120)}`)
  }
}

await browser.close()
console.log('\n=== TRACE DONE ===')
