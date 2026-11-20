// 首屏接续线最终验证探针（单浏览器会话，多视口一次跑完）
// 用法：node measure-verify.mjs [baseUrl]，默认 http://127.0.0.1:3120
// 输出 JSON 到 stdout；截图写 /tmp/firstscreen-verify/
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.argv[2] || 'http://127.0.0.1:3120'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
fs.mkdirSync('/home/hatch/workspace/znwzdh-fix-firstscreen-1120/verify-evidence', { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: SHELL,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu'],
})

async function measure(viewport, label) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
  try {
    await page.waitForSelector('main a[href]', { timeout: 90000 })
  } catch { /* 继续量取 */ }
  await page.waitForTimeout(6000) // 等水合完成（mask 状态、箭头挂载）
  const r = await page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cards = [...document.querySelectorAll('main a[href]')]
      .map((a) => a.getBoundingClientRect())
      .filter((rc) => rc.width >= 200 && rc.height >= 80 && rc.width <= 400)
    const seen = new Set()
    const uniq = []
    for (const rc of cards) {
      const key = `${Math.round(rc.top)}-${Math.round(rc.left)}-${Math.round(rc.width)}x${Math.round(rc.height)}`
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push({ top: rc.top, left: rc.left, w: rc.width, h: rc.height })
    }
    const inView = uniq.filter((c) => c.top < vh && c.top + c.h > 0)
    const full = inView.filter((c) => c.top >= 0 && c.top + c.h <= vh)
    const partial = inView.filter((c) => !(c.top >= 0 && c.top + c.h <= vh))
    const chromeH = uniq.length ? Math.round(Math.min(...uniq.map((c) => c.top))) : null
    let area = 0
    for (const c of inView) {
      area += c.w * Math.max(0, Math.min(vh, c.top + c.h) - Math.max(0, c.top))
    }
    const firstCard = uniq[0]
    const perRow = firstCard ? uniq.filter((c) => Math.abs(c.top - firstCard.top) < 5).length : 0
    // 高频直达条高度
    const dock = document.querySelector('#quick-access-tray')
    const dockRect = dock ? dock.getBoundingClientRect() : null
    // 分类标题行 vs 热门标签条是否同一行：比较 h2 与 tag toolbar 的 top
    const h2 = document.querySelector('main h2')
    const tagBar = document.querySelector('main [role="toolbar"][aria-label*="热门标签"]')
    const h2Rect = h2 ? h2.getBoundingClientRect() : null
    const tagRect = tagBar ? tagBar.getBoundingClientRect() : null
    // 子分类条：mask / 箭头 / 「全部」按钮
    const rails = [...document.querySelectorAll('[role="tablist"][aria-label*="子分类"]')].slice(0, 2).map((el) => {
      const cs = getComputedStyle(el)
      const allBtn = [...el.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('全部'))
      const wrap = el.closest('div.relative')
      return {
        label: el.getAttribute('aria-label'),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        mask: cs.maskImage !== 'none' || cs.webkitMaskImage !== 'none',
        maskImage: (cs.maskImage || '').slice(0, 60),
        hasAllButton: !!allBtn,
        hasRightArrow: !!wrap?.querySelector('button[aria-label*="向右滚动"]'),
        hasLeftArrow: !!wrap?.querySelector('button[aria-label*="向左滚动"]'),
      }
    })
    // 任意横向溢出元素（body 级）
    const overflowers = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const rc = el.getBoundingClientRect()
        return rc.width > 0 && (rc.right > vw + 1 || rc.left < -1) && !['HTML', 'BODY'].includes(el.tagName)
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${(el.className.baseVal ?? el.className ?? '').toString().slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`)
    return {
      vw, vh,
      cardCount: uniq.length,
      fullCount: full.length,
      partialCount: partial.length,
      fullRows: new Set(full.map((c) => Math.round(c.top))).size,
      cardsPerRow: perRow,
      firstCardWH: firstCard ? `${Math.round(firstCard.w)}x${Math.round(firstCard.h)}` : null,
      chromeH,
      exposure: +((area / (vw * vh)) * 100).toFixed(1),
      docScrollWidth: document.documentElement.scrollWidth,
      docInnerWidth: vw,
      noHOverflow: document.documentElement.scrollWidth <= vw,
      dockH: dockRect ? Math.round(dockRect.height) : null,
      headerTagSameRow: h2Rect && tagRect ? Math.abs(Math.round(h2Rect.top) - Math.round(tagRect.top)) <= 12 : null,
      h2Top: h2Rect ? Math.round(h2Rect.top) : null,
      tagTop: tagRect ? Math.round(tagRect.top) : null,
      tagVisible: !!tagRect && tagRect.width > 0,
      rails,
      overflowers,
      h1Count: document.querySelectorAll('h1').length,
    }
  })
  console.log(`=== ${label} ${viewport.width}x${viewport.height} ===`)
  console.log(JSON.stringify(r, null, 1))
  if (label === 'V1440' || label === 'V360') {
    await page.screenshot({ path: `/home/hatch/workspace/znwzdh-fix-firstscreen-1120/verify-evidence/${label.toLowerCase()}.png` })
  }
  await ctx.close()
  return r
}

const ONLY = process.argv[3] || ''
const ALL = [
  [{ width: 1440, height: 900 }, 'V1440'],
  [{ width: 1920, height: 911 }, 'V1920'],
  [{ width: 1280, height: 900 }, 'V1280'],
  [{ width: 1024, height: 768 }, 'V1024'],
  [{ width: 768, height: 1024 }, 'V768'],
  [{ width: 360, height: 800 }, 'V360'],
]
const PLAN = ONLY ? ALL.filter(([, label]) => label === ONLY) : ALL
if (PLAN.length === 0) { console.error(`unknown viewport ${ONLY}`); process.exit(2) }
for (const [vp, label] of PLAN) await measure(vp, label)
await browser.close()
console.log('DONE')
