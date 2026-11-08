
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

const routes = ['/', '/search', '/sites', '/hot', '/tags', '/collections', '/marketplace', '/videos', '/me', '/preferences', '/graph', '/algorithms', '/custom', '/favorites', '/offline', '/submit', '/import']

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  for (const route of routes) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const errs = []
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 160)))
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 160)) })
    let status = 0, title = '', h1 = '', loadMs = 0
    const t0 = Date.now()
    try {
      const resp = await page.goto('http://localhost:3000' + route, { waitUntil: 'domcontentloaded', timeout: 45000 })
      status = resp ? resp.status() : 0
      await page.waitForTimeout(1200)
      loadMs = Date.now() - t0
      title = await page.title()
      h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim().slice(0, 60) || '')
    } catch (e) {
      errs.push('NAVFAIL: ' + e.message.slice(0, 120))
    }
    results.push({ route, status, loadMs, title: title.slice(0, 50), h1, errCount: errs.length, errs: errs.slice(0, 3) })
    await context.close()
  }
  console.log(JSON.stringify(results, null, 2))
  await browser.close()
})()
