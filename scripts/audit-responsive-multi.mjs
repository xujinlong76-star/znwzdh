
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  
  const viewports = [
    { name: 'Mobile (390px)', width: 390, height: 844 },
    { name: 'Tablet (768px)', width: 768, height: 1024 },
    { name: 'Laptop (1280px)', width: 1280, height: 800 },
    { name: 'Desktop 1080p (1920px)', width: 1920, height: 1080 },
    { name: 'Ultrawide 2K (2560px)', width: 2560, height: 1440 },
  ]

  const results = []

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await context.newPage()
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    const metrics = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth
      const winWidth = window.innerWidth
      const hasHorizontalScroll = docWidth > winWidth

      const sidebar = document.querySelector('aside')
      const sidebarVisible = sidebar ? window.getComputedStyle(sidebar).display !== 'none' && sidebar.getBoundingClientRect().width > 0 : false

      const cards = Array.from(document.querySelectorAll('[data-navhub-site-id]')).slice(0, 8)
      const cardRects = cards.map(c => {
        const r = c.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }
      })

      // 计算实际一行排下了多少列
      let cols = 0
      if (cardRects.length > 0) {
        const firstY = cardRects[0].y
        cols = cardRects.filter(c => Math.abs(c.y - firstY) < 10).length
      }

      const restingBtn = document.querySelector('button[title*="DIY"], [data-diy-toolbar-resting]')
      const restingRect = restingBtn ? restingBtn.getBoundingClientRect() : null

      return {
        hasHorizontalScroll,
        docWidth,
        winWidth,
        sidebarVisible,
        colsInFirstRow: cols,
        sampleCardWidth: cardRects[0]?.w,
        sampleCardHeight: cardRects[0]?.h,
        restingBtnLocation: restingRect ? {
          right: Math.round(winWidth - restingRect.right),
          bottom: Math.round(window.innerHeight - restingRect.bottom),
          visible: restingRect.width > 0 && restingRect.height > 0
        } : null
      }
    })

    results.push({ viewport: vp.name, width: vp.width, ...metrics })
    await context.close()
  }

  console.log('Responsive Audit Results:', JSON.stringify(results, null, 2))
  await browser.close()
})()
