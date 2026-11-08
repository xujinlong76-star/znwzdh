
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(e.message.slice(0, 140)))
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const before = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    cards: document.querySelectorAll('[data-navhub-site-id]').length
  }))

  // hover 预热 + 点击进入编辑态
  const box = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
    return b ? b.getBoundingClientRect().toJSON() : null
  })
  if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(500) }

  const t0 = Date.now()
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
    b && b.click()
  })
  let hudMs = null
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250)
    const ok = await page.evaluate(() => !!document.querySelector('[data-diy-hud="true"]'))
    if (ok) { hudMs = Date.now() - t0; break }
  }
  await page.waitForTimeout(1500)
  const inEdit = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    cards: document.querySelectorAll('[data-navhub-site-id]').length,
    inSituControls: document.querySelectorAll('[data-category-in-situ]').length,
    placeholders: document.querySelectorAll('section[id$="-placeholder"]').length
  }))
  console.log('BEFORE:', JSON.stringify(before))
  console.log('HUD appeared ms:', hudMs)
  console.log('IN EDIT:', JSON.stringify(inEdit))
  console.log('errors:', JSON.stringify(errs.slice(0, 3)))
  await browser.close()
})()
