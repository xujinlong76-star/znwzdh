
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const before = await page.evaluate(() => {
    const isTab = (el) => {
      if (el.disabled) return false
      const ti = el.getAttribute('tabindex')
      if (ti !== null) { const n = parseInt(ti, 10); return !isNaN(n) && n >= 0 }
      return ['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(el.tagName)
    }
    const main = document.querySelector('#main-content')
    const all = main ? Array.from(main.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(isTab) : []
    const pills = document.querySelectorAll('[data-dir-pill]')
    const pillTabbable = Array.from(pills).filter(isTab).length
    const toolbar = document.querySelector('[role="toolbar"]')
    return {
      total: all.length,
      pills: pills.length,
      pillTabbable,
      toolbarExists: !!toolbar,
      toolbarTabIndex: toolbar?.getAttribute('tabindex'),
      toolbarLabel: toolbar?.getAttribute('aria-label')
    }
  })
  console.log('目录带改造后:', JSON.stringify(before))

  // 键盘实测：聚焦 toolbar，方向键移动
  await page.focus('[role="toolbar"]')
  const a0 = await page.evaluate(() => document.activeElement?.getAttribute('data-dir-pill') !== null ? document.activeElement?.textContent?.trim().slice(0, 20) : 'toolbar')
  await page.keyboard.press('ArrowRight')
  const a1 = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 20))
  await page.keyboard.press('End')
  const aEnd = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 20))
  await page.keyboard.press('Home')
  const aHome = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 20))
  console.log('键盘: 进入=' + a0 + ' | →=' + a1 + ' | End=' + aEnd + ' | Home=' + aHome)

  await browser.close()
})()
