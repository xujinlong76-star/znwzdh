import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'networkidle', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
await p.waitForSelector('input[placeholder*="搜索"]', { timeout: 30000 })
await p.evaluate(async () => {
  const input = document.querySelector('input[placeholder*="搜索"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '考研')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(2500)
const r = await p.evaluate(() => {
  // 找搜索下拉/浮层（role=dialog/listbox/option，或带搜索结果的容器）
  const dlg = document.querySelector('[role="dialog"], [role="listbox"], [cmdk-list], [data-slot="command-list"]')
  const opts = [...document.querySelectorAll('[role="option"], [cmdk-item], [data-slot="command-item"]')].map(el => (el.textContent||'').trim().slice(0,30)).slice(0,8)
  // 主内容是否被过滤：统计含“考研”的卡片
  const mainKaoyan = [...document.querySelectorAll('main a[href]')].filter(a => (a.textContent||'').includes('考研')).length
  // 是否出现“未找到/空态”提示
  const bodyText = document.body.innerText
  const hasEmpty = /没有找到|未找到|暂无相关/.test(bodyText)
  return { dialogPresent: !!dlg, dialogText: dlg ? dlg.textContent.trim().slice(0,120) : null, options: opts, mainKaoyan, hasEmpty }
})
console.log(JSON.stringify(r, null, 1))
await p.screenshot({ path: 'verify-evidence/search-kaoyan.png' })
await b.close()
