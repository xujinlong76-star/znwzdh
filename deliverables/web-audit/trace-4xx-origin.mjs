import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:3000'
const KNOWN = [
  '/', '/admin', '/admin/ai', '/admin/audit', '/admin/categories', '/admin/collections', '/admin/data',
  '/admin/data/restore', '/admin/facets', '/admin/jobs', '/admin/navigation', '/admin/plugin-health',
  '/admin/plugins', '/admin/resources', '/admin/resources/download', '/admin/site', '/admin/sitelist',
  '/admin/stats', '/admin/submissions', '/admin/tags', '/admin/taxonomy', '/admin/tokens', '/admin/trash',
  '/admin/videos', '/algorithms', '/auth/error', '/auth/signin', '/category', '/collections', '/custom',
  '/favorites', '/graph', '/hot', '/import', '/marketplace', '/marketplace/import', '/marketplace/installed',
  '/marketplace/mine', '/marketplace/publish', '/me', '/me/account', '/me/data', '/me/history',
  '/me/notifications', '/me/plugins', '/me/settings', '/me/vault', '/me/workspaces', '/offline',
  '/preferences', '/sites', '/submit', '/tags', '/videos', '/videos/player',
  '/category/ai-tools', '/category/ai-tools/p/2', '/category/chat-assistants',
  '/tags/' + encodeURIComponent('开源'), '/tags/' + encodeURIComponent('国产'),
  '/collections/agentic-ai', '/collections/ai-coding', '/collections/frontend-starter',
  '/marketplace/ai-agentic-coding', '/marketplace/ai-agentic-coding/preview',
]

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const findings = []

for (const path of KNOWN) {
  const page = await ctx.newPage()
  const cur = { page: path }
  page.on('response', (r) => {
    const s = r.status()
    if (s >= 400 && s < 600) {
      findings.push({ page: cur.page, url: r.url(), status: s, type: r.request().resourceType() })
    }
  })
  try {
    await page.goto(BASE + path, { waitUntil: 'commit', timeout: 25000 })
    await page.waitForTimeout(2800)
  } catch (e) {
    // 忽略导航超时：已发生的响应仍被记录
  }
  await page.close()
}

const byPage = new Map()
for (const f of findings) {
  if (!byPage.has(f.page)) byPage.set(f.page, [])
  byPage.get(f.page).push(f)
}

console.log(`\n=== 4xx/5xx BY PAGE (${findings.length} total) ===`)
for (const [p, arr] of byPage) {
  console.log(`\n## ${p} (${arr.length})`)
  const uniq = new Map()
  for (const a of arr) uniq.set(a.status + ' ' + a.url, a)
  for (const [k, a] of uniq) console.log(`   [${a.type}] ${k}`)
}

fs.writeFileSync('deliverables/web-audit/trace-4xx-origin.json', JSON.stringify(findings, null, 2))
await browser.close()
console.log('\n=== 4XX ORIGIN DONE ===')
