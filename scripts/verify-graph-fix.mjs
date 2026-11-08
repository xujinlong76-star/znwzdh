
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const bad = []
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 90)) })
  await page.goto('http://localhost:3000/graph', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const info = await page.evaluate(() => {
    const h1 = document.querySelector('h1')
    return {
      h1: h1 ? h1.innerText.replace(/\n/g, ' | ') : null,
      hasSampleBadge: document.body.innerText.includes('示例数据'),
      hasLiveBadge: /实时 \d+ 个站点/.test(document.body.innerText),
      liveMatch: (document.body.innerText.match(/实时 (\d+) 个站点/) || [])[1] || null
    }
  })
  console.log('failures:', JSON.stringify(bad, null, 2))
  console.log('graph:', JSON.stringify(info, null, 2))
  await browser.close()
})()
