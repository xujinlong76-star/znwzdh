import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('visited', '1'); localStorage.setItem('subtitle-hint-dismissed', '1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3120', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForTimeout(6000)
// 功能 1：搜索
await p.fill('input[type="search"], input[placeholder*="搜索"]', '知乎').catch(()=>{})
await p.waitForTimeout(1500)
const searchHas = await p.evaluate(() => document.body.innerText.includes('知乎'))
await p.keyboard.press('Escape')
// 功能 2：分类切换（点第 2 个分类 tab）
const catTabs = await p.$$('[role="tab"]')
let catSwitched = false
if (catTabs.length > 1) { await catTabs[1].click(); await p.waitForTimeout(1500); catSwitched = true }
const afterCat = await p.evaluate(() => document.querySelector('main h2')?.textContent || '')
await catTabs[0].click().catch(()=>{})
await p.waitForTimeout(1200)
// 功能 3：子分类条横向滚动 + 「全部」按钮
const subcat = await p.evaluate(() => {
  const rail = document.querySelector('[role="tablist"][aria-label*="子分类"]')
  if (!rail) return { found: false }
  const allBtn = [...rail.querySelectorAll('button, a')].find(el => /全部/.test(el.textContent || ''))
  const before = rail.scrollLeft
  rail.scrollLeft += 200
  return { found: true, scrollable: rail.scrollWidth > rail.clientWidth, scrolled: rail.scrollLeft > before, hasAll: !!allBtn }
})
// 功能 4：高频直达条
const dock = await p.evaluate(() => {
  const d = document.querySelector('#quick-access-tray')
  if (!d) return { found: false }
  const links = d.querySelectorAll('a')
  return { found: true, linkCount: links.length, visible: d.getBoundingClientRect().height > 0 }
})
await p.screenshot({ path: 'verify-evidence/v1920-density-6.png', fullPage: false })
console.log(JSON.stringify({ searchHas, catSwitched, afterCat, subcat, dock }))
await b.close()
