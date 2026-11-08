
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:3000/videos', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const info = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-video-id], .group.relative').length,
    videoLinks: Array.from(document.querySelectorAll('a[href^="/videos/v/"]')).length,
    domNodes: document.getElementsByTagName('*').length,
    hasPagination: !!document.querySelector('[aria-label*="分页"], nav[aria-label*="页"]'),
    bodyHeight: document.body.scrollHeight
  }))
  console.log(JSON.stringify(info, null, 2))
  await browser.close()
})()
