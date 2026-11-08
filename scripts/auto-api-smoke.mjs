
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

const endpoints = [
  '/api/health', '/api/site-config', '/api/home/navigation', '/api/home/site',
  '/api/search?q=kimi', '/api/navigation', '/api/sites?limit=3',
  '/api/videos?limit=3', '/api/plugins?limit=3', '/api/plugins/installed',
  '/api/collections', '/api/tags', '/api/facets', '/api/stats', '/api/hot',
  '/api/rank/trending?limit=3', '/api/graph', '/api/rss', '/feed.xml',
  '/api/weather?city=beijing', '/api/me', '/api/user-center',
  '/api/copilot/config', '/api/algorithms/linucb'
]

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  await page.goto('http://localhost:3000/404-not-exist', { waitUntil: 'domcontentloaded' })
  const out = await page.evaluate(async (eps) => {
    const res = []
    for (const ep of eps) {
      try {
        const r = await fetch(ep, { headers: { accept: 'application/json' } })
        const ct = r.headers.get('content-type') || ''
        let body = ''
        try { body = (await r.text()).slice(0, 120) } catch {}
        res.push({ ep, status: r.status, ct: ct.split(';')[0], body: r.ok ? '' : body })
      } catch (e) {
        res.push({ ep, status: 'ERR', body: String(e).slice(0, 100) })
      }
    }
    return res
  }, endpoints)
  console.log(JSON.stringify(out.filter(x => x.status === 'ERR' || x.status >= 400), null, 1))
  console.log('total probed:', out.length, '| ok:', out.filter(x => x.status === 200).length)
  await browser.close()
})()
