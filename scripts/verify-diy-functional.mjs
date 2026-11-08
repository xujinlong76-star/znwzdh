
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []
  page.on('pageerror', e => errs.push(e.message.slice(0, 140)))
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // 进入编辑态
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
    b && b.click()
  })
  await page.waitForTimeout(1800)

  const out = {}
  out.inEdit = await page.evaluate(() => !!document.querySelector('[data-diy-hud="true"]'))
  out.hudButtons = await page.evaluate(() => {
    const h = document.querySelector('[data-diy-hud="true"]')
    return h ? Array.from(h.querySelectorAll('button')).map(b => b.getAttribute('title') || b.textContent.trim()).filter(Boolean).slice(0, 6) : []
  })

  // 分类原地操控：下移第一个分类
  const before = await page.evaluate(() => Array.from(document.querySelectorAll('section[id]')).slice(0, 3).map(s => s.id))
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-category-in-situ] button'))
    const down = btns.find(b => (b.getAttribute('title') || '') === '向下移动分类')
    down && down.click()
  })
  await page.waitForTimeout(900)
  const after = await page.evaluate(() => Array.from(document.querySelectorAll('section[id]')).slice(0, 3).map(s => s.id))
  out.reorder = { before, after, changed: JSON.stringify(before) !== JSON.stringify(after) }

  // 形态切换（分类级密度覆盖）
  await page.evaluate(() => {
    const trigger = document.querySelector('[data-category-in-situ] button[title*="卡片形态"]')
    trigger && trigger.click()
  })
  await page.waitForTimeout(700)
  out.densityMenuOpen = await page.evaluate(() => !!document.querySelector('[role="menu"]'))

  // Esc 退出
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)
  out.exited = await page.evaluate(() => !document.querySelector('[data-diy-hud="true"]'))
  out.triggerBack = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY')))
  out.errors = errs.slice(0, 3)

  console.log(JSON.stringify(out, null, 2))
  await browser.close()
})()
