
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const apiCalls = []
  page.on('response', r => { if (r.url().includes('/api/search') || r.url().includes('/api/plugins')) apiCalls.push({ url: r.url().slice(0, 90), status: r.status() }) })

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)

  const input = await page.$('input[data-search-input]')
  await input.click()
  await input.type('kimi', { delay: 40 })
  await page.waitForTimeout(2000)

  const panel = await page.evaluate(() => {
    const p = document.getElementById('navhub-search-results-panel')
    const s = document.getElementById('navhub-search-suggest-panel')
    const el = p || s
    return {
      resultsPanel: !!p, suggestPanel: !!s,
      options: el ? Array.from(el.querySelectorAll('[role="option"]')).slice(0, 8).map(o => o.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)) : [],
      text: el ? el.innerText.slice(0, 300) : null
    }
  })
  console.log('API calls:', JSON.stringify(apiCalls, null, 2))
  console.log('Panel:', JSON.stringify(panel, null, 2))

  // 拼音测试
  await input.fill('')
  await input.type('jianli', { delay: 40 })
  await page.waitForTimeout(1800)
  const pinyin = await page.evaluate(() => {
    const p = document.getElementById('navhub-search-results-panel') || document.getElementById('navhub-search-suggest-panel')
    return p ? Array.from(p.querySelectorAll('[role="option"]')).slice(0, 5).map(o => o.textContent.trim().replace(/\s+/g, ' ').slice(0, 50)) : []
  })
  console.log('Pinyin results:', JSON.stringify(pinyin))

  await browser.close()
})()
