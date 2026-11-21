// 首访提示条再削线：基线 + 验收探针（1920x911 双态）
// 用法：node measure-hint-1920.mjs [baseUrl]，默认 http://127.0.0.1:3121
// FIRSTVISIT=1 时量首访态（不设任何键，提示出现）；否则量回访态（正确键 navhub:visited + navhub:subtitle-hint-dismissed）。
// 输出 JSON 到 stdout；截图写 verify-evidence/
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.argv[2] || 'http://127.0.0.1:3121'
const SHELL = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'
const OUT = '/home/hatch/workspace/znwzdh-fix-firstscreen-hint-1121/verify-evidence'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: SHELL,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu'],
})

async function measure(label, firstVisit) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
  if (!firstVisit) {
    await ctx.addInitScript(() => {
      localStorage.setItem('navhub:visited', '1')
      localStorage.setItem('navhub:subtitle-hint-dismissed', '1')
    })
  }
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
  try { await page.waitForSelector('main a[href]', { timeout: 90000 }) } catch { /* continue */ }
  await page.waitForTimeout(6000)
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
    const chromeH = uniq.length ? Math.round(Math.min(...uniq.map((c) => c.top))) : null
    let area = 0
    for (const c of inView) {
      area += c.w * Math.max(0, Math.min(vh, c.top + c.h) - Math.max(0, c.top))
    }
    // 提示条实测：存在与否、盒模型构成
    const hint = document.querySelector('[role="note"][aria-label="副标题提示"]')
    let hintBox = null
    if (hint) {
      const rc = hint.getBoundingClientRect()
      const cs = getComputedStyle(hint)
      hintBox = {
        height: Math.round(rc.height),
        marginBottom: cs.marginBottom,
        padding: cs.padding,
        border: cs.borderTopWidth + ' ' + cs.borderBottomWidth,
        lineHeight: cs.lineHeight,
        fontSize: cs.fontSize,
        text: hint.textContent.trim().slice(0, 60),
        // 占位总高度 = 自身高 + 下外边距
        occupied: Math.round(rc.height + parseFloat(cs.marginBottom)),
      }
    }
    return {
      vw, vh,
      cardCount: uniq.length,
      fullCount: full.length,
      partialCount: inView.length - full.length,
      fullRows: new Set(full.map((c) => Math.round(c.top))).size,
      chromeH,
      exposure: +((area / (vw * vh)) * 100).toFixed(1),
      hintVisible: !!hint,
      hintBox,
    }
  })
  console.log(`=== ${label} 1920x911 ===`)
  console.log(JSON.stringify(r, null, 1))
  await page.screenshot({ path: `${OUT}/${label.toLowerCase()}.png` })
  await ctx.close()
  return r
}

const first = await measure('FIRSTVISIT', true)
const ret = await measure('RETURNING', false)
console.log(`=== SUMMARY === firstvisit full=${first.fullCount} exposure=${first.exposure}% chrome=${first.chromeH} hint=${first.hintVisible ? JSON.stringify(first.hintBox) : 'hidden'} | returning full=${ret.fullCount} exposure=${ret.exposure}% chrome=${ret.chromeH}`)
await browser.close()
console.log('DONE')
