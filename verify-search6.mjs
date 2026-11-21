import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'networkidle', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
await p.waitForSelector('input[role="combobox"]', { timeout: 30000 })
await p.waitForTimeout(12000) // 等搜索索引建好
await p.evaluate(async () => {
  const input = document.querySelector('input[role="combobox"]')
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'ChatGPT')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(3000)
const r = await p.evaluate(() => {
  const results = document.querySelector('#navhub-search-bar-results')
  const items = results ? [...results.querySelectorAll('[role="option"], li, a')].map(el => (el.textContent||'').trim().slice(0,30)).filter(Boolean).slice(0,8) : []
  return { resultsPresent: !!results, itemCount: items.length, items }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
