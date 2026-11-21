import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'networkidle', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
await p.waitForSelector('input[placeholder*="搜索"]', { timeout: 30000 })
// 用真实键盘输入（触发完整 keydown/input 事件链）
await p.click('input[placeholder*="搜索"]')
await p.keyboard.type('ChatGPT', { delay: 80 })
await p.waitForTimeout(2500)
const r = await p.evaluate(() => {
  const input = document.querySelector('input[placeholder*="搜索"]')
  // 找任何搜索结果浮层：combobox listbox、cmdk、或含站点名的下拉
  const listbox = document.querySelector('[role="listbox"], #navhub-search-bar-results, [cmdk-list]')
  const opts = [...document.querySelectorAll('[role="option"], [cmdk-item], [data-slot="command-item"]')]
  const anyDropdown = [...document.querySelectorAll('div')].filter(d => {
    const cs = getComputedStyle(d)
    return cs.position === 'absolute' && d.textContent.includes('ChatGPT') && d.textContent.length < 500
  }).length
  return { inputValue: input ? input.value : null, listbox: !!listbox, optionCount: opts.length, options: opts.map(o => (o.textContent||'').trim().slice(0,30)).slice(0,6), anyDropdown }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
