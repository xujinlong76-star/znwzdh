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
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '考研')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(1500)
await p.keyboard.press('Enter')
await p.waitForTimeout(2000)
const r = await p.evaluate(() => {
  return {
    url: location.href,
    mainLinks: document.querySelectorAll('main a[href]').length,
    kaoyanInMain: [...document.querySelectorAll('main a[href]')].filter(a => (a.textContent||'').includes('考研')).length,
    h1: (document.querySelector('main h1')||{}).textContent || null,
  }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
