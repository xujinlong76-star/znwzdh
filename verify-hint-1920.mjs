// 首访提示条再削线：验收探针 v3（1920x911）
// 用法：node verify-hint-1920.mjs [baseUrl]，默认 http://127.0.0.1:3121
// 分页测，避免相互干扰：
//  页 1（首访）：等提示条展开（占位>0）→ A 早期量取 → D 点 X 关闭 → reload 后仍不出现
//  页 2（首访）：等提示条收起（占位=0）→ B 稳态量取 → E 搜索聚焦时提示出现
//  页 3（回访对照）：C 量取
// 键一律用正确键 navhub:visited / navhub:subtitle-hint-dismissed
// 不用固定等待：水合快慢不定，轮询占位高度才是可靠信号。
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

async function hintOccupied(page) {
  return await page.evaluate(() => {
    const h = document.querySelector('[role="note"][aria-label="副标题提示"]')
    if (!h) return -1
    const rc = h.getBoundingClientRect()
    const cs = getComputedStyle(h)
    return Math.round(rc.height + parseFloat(cs.marginBottom))
  })
}

async function waitForHint(page, want, timeoutMs = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const occ = await hintOccupied(page)
    if (want === 'expanded' && occ > 0) return occ
    if (want === 'collapsed' && occ === 0) return occ
    if (want === 'present' && occ >= 0) return occ
    await page.waitForTimeout(200)
  }
  throw new Error(`hint did not reach ${want} within ${timeoutMs}ms (last occupied=${await hintOccupied(page)})`)
}

async function snapshot(page) {
  return await page.evaluate(() => {
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
    const hint = document.querySelector('[role="note"][aria-label="副标题提示"]')
    let hintBox = null
    if (hint) {
      const rc = hint.getBoundingClientRect()
      const cs = getComputedStyle(hint)
      hintBox = {
        height: Math.round(rc.height),
        marginBottom: cs.marginBottom,
        opacity: cs.opacity,
        maxHeight: cs.maxHeight,
        text: hint.textContent.trim().slice(0, 40),
        occupied: Math.round(rc.height + parseFloat(cs.marginBottom)),
      }
    }
    return {
      fullCount: full.length,
      partialCount: inView.length - full.length,
      fullRows: new Set(full.map((c) => Math.round(c.top))).size,
      chromeH,
      exposure: +((area / (vw * vh)) * 100).toFixed(1),
      hintVisible: !!hint,
      hintBox,
    }
  })
}

// --- 页 1：首访 A 早期 + D 关闭 ---
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
  await page.waitForSelector('main a[href]', { timeout: 90000 })
  await waitForHint(page, 'expanded')
  const early = await snapshot(page)
  console.log('=== A. FIRSTVISIT-EARLY (展开态，收起前) ===')
  console.log(JSON.stringify(early, null, 1))
  await page.screenshot({ path: `${OUT}/firstvisit-early.png` })
  // D：提示展开时点 X（DOM click，绕过 sticky 拦截）
  await page.evaluate(() => {
    document.querySelector('button[aria-label="关闭副标题提示"]')?.click()
  })
  await page.waitForTimeout(800)
  const afterClose = await page.evaluate(() => ({
    hint: !!document.querySelector('[role="note"][aria-label="副标题提示"]'),
    dismissedKey: localStorage.getItem('navhub:subtitle-hint-dismissed'),
  }))
  console.log(`=== D. DISMISS: after X click ${JSON.stringify(afterClose)} (expect hint=false, dismissedKey=1) ===`)
  await page.reload({ waitUntil: 'commit' })
  await page.waitForSelector('main a[href]', { timeout: 90000 })
  await page.waitForTimeout(3000)
  const afterReload = await page.evaluate(() => ({
    hint: !!document.querySelector('[role="note"][aria-label="副标题提示"]'),
    dismissedKey: localStorage.getItem('navhub:subtitle-hint-dismissed'),
    visitedKey: localStorage.getItem('navhub:visited'),
  }))
  console.log(`=== D. DISMISS-RELOAD: ${JSON.stringify(afterReload)} (expect hint=false, dismissedKey=1) ===`)
  await ctx.close()
}

// --- 页 2：首访 B 稳态 + E 搜索聚焦 ---
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 180000 })
  await page.waitForSelector('main a[href]', { timeout: 90000 })
  await waitForHint(page, 'expanded')
  await waitForHint(page, 'collapsed', 15000)
  const late = await snapshot(page)
  console.log('=== B. FIRSTVISIT-STEADY (收起后) ===')
  console.log(JSON.stringify(late, null, 1))
  await page.screenshot({ path: `${OUT}/firstvisit-steady.png` })
  // E：搜索聚焦，提示应重新出现（搜索文案）
  await page.evaluate(() => {
    const el = document.querySelector('input[placeholder*="搜索"]')
    if (el) el.focus()
  })
  await page.waitForTimeout(1200)
  const searchHint = await page.evaluate(() => {
    const h = document.querySelector('[role="note"][aria-label="副标题提示"]')
    if (!h) return { present: false }
    const cs = getComputedStyle(h)
    const rc = h.getBoundingClientRect()
    return { present: true, height: Math.round(rc.height), opacity: cs.opacity, maxHeight: cs.maxHeight, text: h.textContent.trim().slice(0, 40) }
  })
  console.log(`=== E. SEARCH-FOCUS: ${JSON.stringify(searchHint)} (expect present=true, height>0, search text) ===`)
  await ctx.close()
}

// --- 页 3：回访对照 ---
// 注意：固定 6s 等待会撞上布局未稳（图片/字体未齐时卡片偏矮，量到 30 张/
// 39.7% 的假象）。改为等网络空闲 + 首张站点卡片高到 154px 再量。
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 911 } })
  await ctx.addInitScript(() => {
    localStorage.setItem('navhub:visited', '1')
    localStorage.setItem('navhub:subtitle-hint-dismissed', '1')
  })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 180000 })
  await page.waitForSelector('main a[href]', { timeout: 90000 })
  // 等首张站点卡片（宽 251）高到 154 再量，最多 20s
  const t0 = Date.now()
  while (Date.now() - t0 < 20000) {
    const h = await page.evaluate(() => {
      const c = [...document.querySelectorAll('main a[href]')]
        .map((a) => a.getBoundingClientRect())
        .find((rc) => rc.width >= 240 && rc.width <= 260)
      return c ? Math.round(c.height) : -1
    })
    if (h >= 150) break
    await page.waitForTimeout(300)
  }
  const ret = await snapshot(page)
  console.log('=== C. RETURNING (对照) ===')
  console.log(JSON.stringify(ret, null, 1))
  await page.screenshot({ path: `${OUT}/returning.png` })
  await ctx.close()
}

await browser.close()
console.log('DONE')
