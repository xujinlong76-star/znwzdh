import { chromium } from '@playwright/test'
const BASE = 'http://127.0.0.1:3120'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
const browser = await chromium.launch({ headless: true, executablePath: SHELL, args: ['--no-sandbox','--no-proxy-server','--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
await ctx.addInitScript(() => { try { localStorage.setItem('navhub:visited','1'); localStorage.setItem('navhub:subtitle-hint-dismissed','1') } catch {} })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
await page.waitForTimeout(10000)
await page.screenshot({ path: 'verify-evidence/v1920-merged.png' })
const r = await page.evaluate(() => {
  const rect = (el) => { if (!el) return null; const rc = el.getBoundingClientRect(); return { top: Math.round(rc.top), bottom: Math.round(rc.bottom), left: Math.round(rc.left), right: Math.round(rc.right), w: Math.round(rc.width), h: Math.round(rc.height) } }
  const capsuleTablist = document.querySelector('[role="tablist"][aria-label="工作区视图切换"]')
  const capsuleWrap = capsuleTablist?.closest('div[class*="flex"]')
  const dock = document.querySelector('#quick-access-tray')
  // are capsule and dock on the same row? (overlapping vertical range)
  const c = rect(capsuleWrap), d = rect(dock)
  const sameRow = c && d ? (c.top < d.bottom && d.top < c.bottom) : false
  // workspace tabs present?
  const wsTabs = [...document.querySelectorAll('[role="tablist"][aria-label="工作区视图切换"] button[role="tab"]')].map((b)=>b.textContent.trim())
  // dock tabs present?
  const dockTabs = [...document.querySelectorAll('#quick-access-tray [role="tab"]')].map((b)=>b.textContent.trim())
  // dock site links count
  const dockLinks = document.querySelectorAll('#quick-access-tray a[href]').length
  // capsule operation capsules (drama/ai/plugin/guide) - check for their buttons
  const opBtns = [...document.querySelectorAll('button')].filter((b)=>/短剧|AI 找站|插件精选|向导/.test(b.textContent)).length
  return { capsule: c, dock: d, sameRow, wsTabs, dockTabs, dockLinks, opBtns }
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
console.log('DONE')
