
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  page.on('pageerror', e => errs.push(e.message.slice(0, 140)))
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const initial = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    cards: document.querySelectorAll('[data-navhub-site-id]').length,
    sections: document.querySelectorAll('section[id]').length,
    placeholders: document.querySelectorAll('section[id$="-placeholder"]').length,
    scrollH: document.body.scrollHeight
  }))
  console.log('INITIAL:', JSON.stringify(initial))

  // 渐进滚动到底，模拟真实浏览
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2))
    await page.waitForTimeout(350)
  }
  const afterScroll = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    cards: document.querySelectorAll('[data-navhub-site-id]').length,
    placeholders: document.querySelectorAll('section[id$="-placeholder"]').length,
    scrollH: document.body.scrollHeight
  }))
  console.log('AFTER SCROLL:', JSON.stringify(afterScroll))
  console.log('errors:', JSON.stringify(errs.slice(0, 3)))

  // 键盘/无滚动用户路径：占位块的按钮存在吗
  const placeholderBtn = await page.evaluate(() => {
    const el = document.querySelector('section[id$="-placeholder"]')
    return el ? el.innerText.replace(/\n/g, ' | ').slice(0, 80) : null
  })
  console.log('placeholder sample:', placeholderBtn)
  await browser.close()
})()
