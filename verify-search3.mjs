import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'networkidle', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
await p.waitForSelector('input[placeholder*="搜索"]', { timeout: 30000 })
// 按 / 呼出超级搜索
await p.keyboard.press('/')
await p.waitForTimeout(1500)
let r = await p.evaluate(() => {
  const palette = document.querySelector('[cmdk-root], [data-slot="command"], [role="dialog"]')
  const input = document.querySelector('input[placeholder*="搜索"], input[placeholder*="快速"], input[cmdk-input]')
  return { palette: !!palette, paletteText: palette ? palette.textContent.trim().slice(0,80) : null, inputPh: input ? input.getAttribute('placeholder') : null }
})
console.log('after / :', JSON.stringify(r))
// 在超级搜索里输入 考研
await p.keyboard.type('考研', { delay: 60 })
await p.waitForTimeout(2000)
r = await p.evaluate(() => {
  const items = [...document.querySelectorAll('[cmdk-item], [data-slot="command-item"], [role="option"]')]
  return { itemCount: items.length, items: items.map(el => (el.textContent||'').trim().slice(0,30)).slice(0,8) }
})
console.log('super search 考研:', JSON.stringify(r, null, 1))
await b.close()
