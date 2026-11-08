
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  page.on('pageerror', e => errs.push(e.message.slice(0, 150)))
  await page.goto('http://localhost:3000/videos', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const collapsed = await page.evaluate(() => ({
    cards: document.querySelectorAll('a[href*="/videos/v/"], button:has(img)').length,
    domNodes: document.getElementsByTagName('*').length,
    scrollH: document.body.scrollHeight,
    sections: document.querySelectorAll('section[id]').length,
    imgs: document.querySelectorAll('img').length,
    expandBtnText: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).find(t => t.startsWith('展开剩余'))
  }))
  console.log('COLLAPSED:', JSON.stringify(collapsed))
  console.log('errors:', JSON.stringify(errs.slice(0, 3)))

  // 点击「展开剩余」
  const btn = await page.$('button:has-text("展开剩余")')
  if (btn) {
    await btn.click()
    await page.waitForTimeout(2500)
    const expanded = await page.evaluate(() => ({
      domNodes: document.getElementsByTagName('*').length,
      scrollH: document.body.scrollHeight,
      sections: document.querySelectorAll('section[id]').length,
      hasCollapseBtn: Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('收起其余分类'))
    }))
    console.log('EXPANDED:', JSON.stringify(expanded))
  } else {
    console.log('expand button not found')
  }

  // 「浏览此分类」是否可用
  const onlyBtn = await page.$('button:has-text("浏览此分类")')
  console.log('浏览此分类 present:', !!onlyBtn)
  if (onlyBtn) {
    await onlyBtn.click()
    await page.waitForTimeout(1500)
    const single = await page.evaluate(() => ({
      sections: document.querySelectorAll('section[id]').length,
      url: location.search,
      domNodes: document.getElementsByTagName('*').length
    }))
    console.log('SINGLE CATEGORY:', JSON.stringify(single))
  }
  await browser.close()
})()
