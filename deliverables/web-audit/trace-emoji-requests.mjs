import { chromium } from '@playwright/test'

const BASE = 'http://127.0.0.1:3000'
const PAGES = [
  '/marketplace/publish',
  '/marketplace/import',
  '/marketplace/mine',
  '/marketplace/ai-agentic-coding',
  '/marketplace/ai-agentic-coding/preview',
  '/marketplace?kind=theme',
  '/marketplace?kind=bundle',
  '/marketplace?kind=search-pack',
  '/marketplace?kind=workspace-preset',
]

const nonAsciiMarketplace = (u) => {
  try {
    const url = new URL(u)
    if (!url.pathname.includes('/marketplace/')) return false
    return /[^\x00-\x7F]/.test(decodeURIComponent(url.pathname))
  } catch { return false }
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const hits = []

for (const path of PAGES) {
  const page = await ctx.newPage()
  page.on('request', (req) => {
    const u = req.url()
    if (nonAsciiMarketplace(u)) {
      hits.push({
        page: path,
        reqUrl: u,
        type: req.resourceType(),
        referer: req.headers()['referer'] || '',
        frameUrl: req.frame()?.url() || '',
      })
    }
  })
  try {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(3000)
    // 触发懒渲染：滚到底再等
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1500)
  } catch (e) {
    console.log(`!! ${path} ${String(e).slice(0, 100)}`)
  }
  await page.close()
}

console.log(`\n=== HITS (${hits.length}) ===`)
const byPage = new Map()
for (const h of hits) {
  if (!byPage.has(h.page)) byPage.set(h.page, [])
  byPage.get(h.page).push(h)
}
for (const [p, arr] of byPage) {
  console.log(`\n## ${p}  (${arr.length})`)
  const uniq = new Map()
  for (const a of arr) uniq.set(decodeURIComponent(new URL(a.reqUrl).pathname), a)
  for (const [k, a] of uniq) console.log(`   ${k}  type=${a.type}  referer=${a.referer.slice(0, 80)}`)
}

await browser.close()
console.log('\n=== REQ TRACE DONE ===')
