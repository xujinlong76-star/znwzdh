import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell' })
const ctx = await b.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') })
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:3121/', { waitUntil: 'networkidle', timeout: 180000 })
await p.waitForSelector('main a[href]', { timeout: 90000 })
// 等搜索框出现（水合后才挂载）
await p.waitForSelector('input[placeholder*="搜索"]', { timeout: 30000 })
console.log('search input found')
const r = await p.evaluate(async () => {
  const input = document.querySelector('input[placeholder*="搜索"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '考研')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 2000))
  const links = [...document.querySelectorAll('main a[href]')]
  const texts = links.map(a => (a.textContent||'').trim()).filter(t => t.includes('考研'))
  return { resultLinks: links.length, kaoyanMatches: texts.slice(0,5), inputValue: input.value }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
