import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'networkidle', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
await p.waitForTimeout(4000)
const r = await p.evaluate(async () => {
  const out = {}
  // 1. 搜索：输入「考研」，看有无结果
  const input = document.querySelector('input[placeholder*="搜索"]')
  out.searchInput = !!input
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '考研')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1500))
    const links = [...document.querySelectorAll('main a[href]')]
    out.searchResultCount = links.length
    out.searchHasKaoyan = links.some(a => (a.textContent||'').includes('考研'))
    // 清掉搜索
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
  }
  // 2. 分类切换：点左侧「前端开发」，看标题是否变
  const catBtn = [...document.querySelectorAll('button, a')].find(el => (el.textContent||'').trim() === '前端开发')
  out.categoryBtn = !!catBtn
  if (catBtn) {
    catBtn.click()
    await new Promise(r => setTimeout(r, 1500))
    const h = document.querySelector('main h2, main h1')
    out.afterCategoryTitle = h ? h.textContent.trim().slice(0, 20) : null
    out.afterCategoryCards = document.querySelectorAll('main a[href]').length
  }
  // 3. 子分类横滚 + 「全部」：找子分类 tablist 与「全部」按钮
  const rail = document.querySelector('[role="tablist"][aria-label*="子分类"]')
  out.subcatRail = !!rail
  if (rail) {
    out.subcatScrollable = rail.scrollWidth > rail.clientWidth
    const allBtn = [...rail.querySelectorAll('button')].find(x => (x.textContent||'').trim().startsWith('全部'))
    out.allButton = !!allBtn
    if (allBtn) { allBtn.click(); await new Promise(r => setTimeout(r, 800)); out.afterAllClick = true }
  }
  // 4. 高频直达条：#quick-access-tray 存在且有链
  const dock = document.querySelector('#quick-access-tray')
  out.dock = !!dock
  if (dock) out.dockLinks = dock.querySelectorAll('a[href]').length
  return out
})
console.log(JSON.stringify(r, null, 1))
await b.close()
