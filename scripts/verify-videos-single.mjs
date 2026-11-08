
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:3000/videos', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const n = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === '浏览此分类').length)
  console.log('浏览此分类 count (collapsed):', n)
  const btn = await page.$('button:has-text("浏览此分类")')
  if (btn) {
    await btn.click()
    await page.waitForTimeout(1500)
    const single = await page.evaluate(() => ({
      sections: document.querySelectorAll('section[id]').length,
      search: location.search,
      domNodes: document.getElementsByTagName('*').length,
      h2: Array.from(document.querySelectorAll('h2')).slice(0, 2).map(h => h.innerText.split('\n')[0])
    }))
    console.log('after 浏览此分类:', JSON.stringify(single))
  }
  await browser.close()
})()
