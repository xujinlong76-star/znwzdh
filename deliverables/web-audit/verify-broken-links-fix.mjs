import { chromium } from '@playwright/test'

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3000'
const PAGES = [
  '/marketplace/code-and-package-search-pack',
  '/marketplace/ai-deep-search-pack',
  '/site/0248542c-f839-4527-aee9-a89280ef9e32',
  '/site/0269d801-195e-4d59-a533-aad0b280cd33',
]
const TAG_RE = /^\/tags\//

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })

for (const path of PAGES) {
  const page = await ctx.newPage()
  const bad = []
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  try {
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 90000 })
    await page.waitForTimeout(2500)
    const tags = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href^="/tags/"]')).map((a) => a.getAttribute('href'))
      const spans = Array.from(document.querySelectorAll('span')).map((s) => (s.textContent || '').trim()).filter((t) => t.startsWith('#'))
      return { links, spanChips: spans.slice(0, 8) }
    })
    console.log(`## ${path}`)
    console.log(`   4xx: ${bad.length ? [...new Set(bad)].join(' | ') : 'none'}`)
    console.log(`   tag links: ${tags.links.length ? tags.links.join(' ') : 'none'} | span chips: ${tags.spanChips.join(' ') || 'none'}`)
  } catch (e) {
    console.log(`## ${path} ERROR ${String(e).slice(0, 140)}`)
  }
  await page.close()
}

await browser.close()
console.log('=== FIX VERIFY DONE ===')
