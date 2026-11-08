
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })
  const eps = [
    '/api/hub/health', '/api/hub/stats', '/api/hub/categories', '/api/hub/sites?limit=2',
    '/api/hub/tags?limit=2', '/api/hub/rank/trending?limit=2', '/api/hub/search?q=react',
    '/api/hub/plugins?limit=2', '/api/hub/collections?limit=2', '/api/hub/facets',
    '/api/hub/navsphere/snapshot', '/api/hub/me'
  ]
  const out = await page.evaluate(async (list) => {
    const res = []
    for (const ep of list) {
      try {
        const r = await fetch(ep, { headers: { accept: 'application/json' } })
        const t = (await r.text()).slice(0, 100)
        res.push({ ep, status: r.status, sample: r.ok ? t.slice(0, 60) : t })
      } catch (e) { res.push({ ep, status: 'ERR', sample: String(e).slice(0, 80) }) }
    }
    return res
  }, eps)
  console.log(JSON.stringify(out, null, 1).slice(0, 3000))
  await browser.close()
})()
