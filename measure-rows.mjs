// 量取首屏各 chrome 行的精确高度（跑在本机，目标 http://127.0.0.1:3100/）
import { chromium } from '@playwright/test'

const BASE = process.argv[2] || 'http://127.0.0.1:3100'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'

const browser = await chromium.launch({
  headless: true,
  executablePath: SHELL,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
await page.waitForTimeout(5000)
const rows = await page.evaluate(() => {
  const out = []
  const push = (name, el) => {
    if (!el) { out.push({ name, missing: true }); return }
    const r = el.getBoundingClientRect()
    out.push({ name, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) })
  }
  // 顶栏 sticky 容器
  push('toolbar-sticky', document.querySelector('.sticky.top-0'))
  // 顶栏搜索行（第一行 flex）
  push('toolbar-search-row', document.querySelector('.sticky.top-0 > div.flex'))
  // 工作区胶囊行（WorkspaceFilter）
  push('workspace-filter', document.querySelector('[role="tablist"][aria-label="工作区视图切换"]')?.closest('div[class*="border-b"]'))
  // 运营胶囊行（HomeMicroStrip）
  push('micro-strip', document.querySelector('[aria-label="首页快捷功能小窗入口"]'))
  // 高频直达
  push('quick-dock', document.querySelector('#quick-access-tray'))
  // 副标题提示
  push('subtitle-hint', document.querySelector('[aria-label="副标题提示"]'))
  // 主内容区 padding-top 的容器
  const mainPad = document.querySelector('#main-content > div.px-3')
  push('main-content-pad', mainPad)
  // 第一个分类标题头
  const firstH2 = document.querySelector('main h2')
  push('first-cat-header', firstH2?.closest('div[class*="border-b"]'))
  // 第一个子分类条
  push('first-subcat-rail', document.querySelector('[role="tablist"][aria-label*="子分类"]'))
  // 第一张卡片
  const cards = [...document.querySelectorAll('main a[href]')].filter((a) => {
    const r = a.getBoundingClientRect()
    return r.width >= 200 && r.height >= 80 && r.width <= 400
  })
  if (cards.length > 0) {
    const first = cards[0].getBoundingClientRect()
    out.push({ name: 'first-card', top: Math.round(first.top), bottom: Math.round(first.bottom), h: Math.round(first.height) })
    // 每行卡片数（第一行 top 相同的卡片数）
    const firstTop = Math.round(first.top)
    const rowCount = cards.filter((c) => Math.abs(c.getBoundingClientRect().top - firstTop) < 5).length
    out.push({ name: 'cards-per-row', count: rowCount })
    // 卡片网格的列数（用 grid 容器宽度 / 卡片宽）
    out.push({ name: 'total-cards-in-dom', count: cards.length })
  }
  // 移动端 h1（应隐藏在 1440）
  const h1s = [...document.querySelectorAll('h1')].map((h) => ({ text: h.textContent.slice(0, 20), visible: h.getBoundingClientRect().height > 0 }))
  out.push({ name: 'h1s', items: h1s })
  return out
})
console.log(JSON.stringify(rows, null, 1))
await browser.close()
console.log('DONE')
