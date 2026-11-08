
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

const IGNORE = [/Download the React DevTools/i, /Images loaded lazily/i, /\[HMR\]/i, /\[Fast Refresh\]/i]

// 真实动态路由样本（来自 /sitemap.xml 与 /videos/sitemap.xml 实测）
const routes = [
  '/', '/search?q=kimi', '/sites', '/sites/p/2', '/hot', '/tags',
  '/tags/%E5%BC%80%E6%BA%90', '/tags/%E5%9B%BD%E4%BA%A7', '/tags/ai',
  '/collections', '/collections/agentic-ai', '/collections/ai-coding',
  '/category', '/category/ai-tools', '/category/frontend-development', '/category/ai-tools/p/2',
  '/marketplace', '/marketplace/gamer-bundle', '/marketplace/creator-bundle',
  '/marketplace/installed', '/marketplace/mine', '/marketplace/publish', '/marketplace/import',
  '/videos', '/videos/player',
  '/videos/v/video_cursor_mastery', '/videos/v/video_lhy_ml_2022',
  '/site/df2e173e-e520-4232-9338-808bd092e523',
  '/site/f9c5c118-59d9-404a-a946-6f013837befb',
  '/graph', '/algorithms', '/custom', '/favorites', '/offline', '/preferences', '/submit', '/import',
  '/me', '/me/account', '/me/data', '/me/history', '/me/notifications', '/me/plugins', '/me/settings',
  '/me/vault', '/me/workspaces',
  '/auth/signin', '/auth/signup', '/auth/forgot-password', '/auth/reset-password',
  '/admin', '/admin/navigation', '/admin/sitelist', '/admin/plugins', '/admin/videos', '/admin/site',
  '/this-route-does-not-exist-xyz'
]

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const problems = []
  for (const route of routes) {
    const p = await ctx.newPage()
    const loc = { route, status: 0, console: [], pageErrors: [], failed: [], hydration: [], blank: false }
    p.on('console', (m) => {
      const t = m.text()
      if (IGNORE.some(re => re.test(t))) return
      if (m.type() === 'error' || m.type() === 'warning') {
        if (/hydrat|did not match|Text content does not match/i.test(t)) loc.hydration.push(t.slice(0, 200))
        else loc.console.push(t.slice(0, 200))
      }
    })
    p.on('pageerror', (e) => loc.pageErrors.push(String(e.message).slice(0, 200)))
    p.on('response', (r) => { if (r.status() >= 400) loc.failed.push(r.status() + ' ' + r.url().replace('http://localhost:3000','').slice(0, 90)) })
    try {
      const resp = await p.goto('http://localhost:3000' + route, { waitUntil: 'domcontentloaded', timeout: 120000 })
      loc.status = resp ? resp.status() : 0
      await p.waitForTimeout(2000)
      loc.blank = await p.evaluate(() => document.body.innerText.trim().length < 40)
    } catch (e) {
      loc.pageErrors.push('NAV: ' + String(e.message).slice(0, 100))
    }
    const interesting = loc.console.length || loc.pageErrors.length || loc.failed.length || loc.hydration.length || loc.blank || (loc.status >= 400 && loc.status !== 404)
    if (interesting) problems.push(loc)
    await p.close()
  }
  console.log('=== PROBLEMS: ' + problems.length + ' / ' + routes.length + ' ===')
  console.log(JSON.stringify(problems, null, 1))
  await browser.close()
})()
