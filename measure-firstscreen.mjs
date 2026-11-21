// 首屏露出基线/复测量取探针（跑在本机，目标 http://127.0.0.1:3100/）
// 用法：node measure-firstscreen.mjs [baseUrl]
// 输出：每档视口的 chrome 高、完整卡片数、露出面积%、子分类条可滚性、360px 溢出
import { chromium } from '@playwright/test'

const BASE = process.argv[2] || 'http://127.0.0.1:3100'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'

const browser = await chromium.launch({
  headless: true,
  executablePath: SHELL,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu'],
})

async function measure(viewport, label) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
  // 等卡片挂载：等一个站点卡片出现
  try {
    await page.waitForSelector('a[href], [data-testid="site-card"], .nav-card-deferred, article', { timeout: 60000 })
  } catch { /* 继续量取 */ }
  await page.waitForTimeout(4000)
  const r = await page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    // 找所有站点卡片：用 grid 内的链接卡片（带 favicon img 或标题的 a）
    // 以「分类区内的卡片」为准：找 main 内所有 a[href^="/sites/"] 或带 data 的卡片
    // 更稳妥：找所有可见的、宽>200 高>100 的卡片容器（article 或 a）
    const cards = []
    // 卡片是 <a> 包裹的站点块，位于 grid 内；用 [data-site-id] 或 href 含站点特征
    const candidates = [...document.querySelectorAll('main a[href]')].filter((a) => {
      const rect = a.getBoundingClientRect()
      return rect.width >= 200 && rect.height >= 80 && rect.width <= 400
    })
    // 去重：同一卡片可能有嵌套 a，取最外层
    const seen = new Set()
    for (const a of candidates) {
      const rect = a.getBoundingClientRect()
      const key = `${Math.round(rect.top)}-${Math.round(rect.left)}-${Math.round(rect.width)}x${Math.round(rect.height)}`
      if (seen.has(key)) continue
      seen.add(key)
      cards.push({ top: rect.top, left: rect.left, w: rect.width, h: rect.height })
    }
    // 只取首屏区域内的卡片（top < vh）
    const inView = cards.filter((c) => c.top < vh && c.top + c.h > 0)
    // 完整可见：top>=0 且 bottom<=vh
    const full = inView.filter((c) => c.top >= 0 && c.top + c.h <= vh)
    const partial = inView.filter((c) => !(c.top >= 0 && c.top + c.h <= vh))
    // chrome 高 = 第一张卡片的 top（若无卡片则取第一个分类标题的 top）
    let chromeH = null
    if (cards.length > 0) {
      chromeH = Math.min(...cards.map((c) => c.top))
    }
    // 露出面积 = 首屏内卡片可见面积 / 视口面积
    let visibleCardArea = 0
    for (const c of inView) {
      const visTop = Math.max(0, c.top)
      const visBottom = Math.min(vh, c.top + c.h)
      const visH = Math.max(0, visBottom - visTop)
      visibleCardArea += c.w * visH
    }
    const exposure = (visibleCardArea / (vw * vh)) * 100
    // 子分类条：找 role=tablist 且 aria-label 含「子分类」的条
    const rails = [...document.querySelectorAll('[role="tablist"][aria-label*="子分类"]')]
    const railInfo = rails.slice(0, 3).map((el) => {
      const cs = getComputedStyle(el)
      return {
        label: el.getAttribute('aria-label'),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollable: el.scrollWidth > el.clientWidth + 4,
        mask: cs.maskImage !== 'none' || cs.webkitMaskImage !== 'none',
        overflowX: cs.overflowX,
      }
    })
    // 顶栏/工具栏行高：量 sticky 顶栏 bottom
    const toolbar = document.querySelector('.sticky.top-0')
    const toolbarBottom = toolbar ? Math.round(toolbar.getBoundingClientRect().bottom) : null
    // 首屏完整卡片行数
    const fullRows = new Set(full.map((c) => Math.round(c.top))).size
    return {
      vw, vh,
      cardCount: cards.length,
      fullCount: full.length,
      partialCount: partial.length,
      fullRows,
      chromeH: chromeH !== null ? Math.round(chromeH) : null,
      exposure: +exposure.toFixed(1),
      toolbarBottom,
      rails: railInfo,
      docScrollWidth: document.documentElement.scrollWidth,
      docInnerWidth: window.innerWidth,
      h1Count: document.querySelectorAll('h1').length,
    }
  })
  console.log(`=== ${label} ${viewport.width}x${viewport.height} ===`)
  console.log(JSON.stringify(r, null, 1))
  await ctx.close()
  return r
}

await measure({ width: 1440, height: 900 }, 'BASELINE-1440')
await measure({ width: 1920, height: 911 }, 'BASELINE-1920')
await measure({ width: 360, height: 800 }, 'BASELINE-360')
await browser.close()
console.log('DONE')
