import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3210'
const d = JSON.parse(fs.readFileSync('deliverables/web-audit/crawl-results.json', 'utf8'))
const targets = d.results
  .map((p) => new URL(p.url).pathname + new URL(p.url).search)
  .filter((p) => p.startsWith('/site/') || p.startsWith('/tags/') || p.startsWith('/category/') || p.startsWith('/collections/') || p.startsWith('/sites'))

console.log('targets:', targets.length)

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const findings = []

for (const path of targets) {
  const page = await ctx.newPage()
  let cur = path
  page.on('response', (r) => {
    const s = r.status()
    if (s >= 400 && s < 600) findings.push({ page: cur, url: r.url(), status: s, type: r.request().resourceType() })
  })
  try {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 40000 })
    await page.waitForTimeout(1500)
    // 同时采集页面上的可疑内链（emoji / 可能不存在的 tag）
    const suspicious = await page.evaluate(() => {
      const out = []
      for (const a of document.querySelectorAll('a[href]')) {
        const h = a.getAttribute('href') || ''
        if (h.includes('/marketplace/') && /%[0-9A-F]{2}/i.test(h) === false && /[^\x00-\x7F]/.test(h)) out.push({ kind: 'emoji', href: h })
        else if (/^\/marketplace\/%[0-9A-F]{2}/i.test(h)) out.push({ kind: 'emoji-enc', href: h })
      }
      return out
    })
    if (suspicious.length) {
      console.log(`!! ${path} -> ${suspicious.length} suspicious links`)
      const uniq = new Map()
      for (const s of suspicious) uniq.set(s.href, s)
      for (const [h, s] of uniq) console.log(`     [${s.kind}] ${h}`)
    }
  } catch { /* 忽略导航超时 */ }
  await page.close()
}

console.log('\n=== 4xx BY SOURCE PAGE (' + findings.length + ') ===')
const m = new Map()
for (const f of findings) {
  const k = f.page + ' -> ' + f.status + ' ' + new URL(f.url).pathname
  m.set(k, (m.get(k) || 0) + 1)
}
for (const [k, v] of m) console.log(`  ${v}x  ${k}`)

fs.writeFileSync('deliverables/web-audit/trace-4xx-source.json', JSON.stringify(findings, null, 2))
await browser.close()
console.log('\n=== SOURCE TRACE DONE ===')
