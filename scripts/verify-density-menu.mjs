
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
    b && b.click()
  })
  await page.waitForTimeout(1500)

  // 用真实鼠标点击形态按钮
  const handle = await page.$('[data-category-in-situ] button[title*="卡片形态"]')
  console.log('density trigger found:', !!handle)
  if (handle) {
    await handle.click()
    await page.waitForTimeout(800)
    const menu = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"]')
      return m ? Array.from(m.querySelectorAll('[role="menuitem"]')).map(i => i.textContent.trim().slice(0, 24)) : null
    })
    console.log('menu items:', JSON.stringify(menu))

    // 选「紧凑条形」
    if (menu) {
      const item = await page.$('[role="menuitem"]:has-text("紧凑")')
      if (item) {
        await item.click()
        await page.waitForTimeout(1200)
        const applied = await page.evaluate(() => {
          const sec = document.querySelector('[data-category-in-situ]')
          const card = document.querySelector('[data-navhub-site-id]')
          return { cardClass: card ? card.className.slice(0, 90) : null }
        })
        console.log('after applying compact:', JSON.stringify(applied))
      }
    }
  }
  await browser.close()
})()
