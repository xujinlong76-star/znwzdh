
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const bad = []
  page.on('response', r => { if (r.status() >= 400) bad.push({ status: r.status(), url: r.url().slice(0, 120) }) })
  await page.goto('http://localhost:3000/graph', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  console.log('Failures on /graph:', JSON.stringify(bad, null, 2))
  await browser.close()
})()
