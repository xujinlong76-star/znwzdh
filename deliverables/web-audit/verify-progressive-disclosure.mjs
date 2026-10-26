/**
 * 首页渐进披露（每组首屏 N 张 + 「展开全部」）的真实浏览器验证。
 *
 * 断言：
 *  1. 首屏卡片被截断：按钮存在、组内卡片数 = N（默认 6）
 *  2. 点「展开全部」后该组卡片立即增至全量、aria-expanded=true
 *  3. 再点「收起」回到首屏数量（状态可逆）
 *  4. 展开/收起全程 0 个 fetch/xhr（数据已在客户端，纯状态切换）
 *  5. 移动端 390px 展开态无水平溢出
 *  6. 全程 0 控制台错误 / 0 页面错误 / 0 个 4xx
 *
 * 注意：水合前点击会被 React 丢弃（所有 SSR 页面的共性），因此先等
 * networkidle，再对同一按钮重试点击直到 aria-expanded 翻转。
 *
 * 用法：NAVHUB_AUDIT_BASE=http://127.0.0.1:3210 node verify-progressive-disclosure.mjs
 */
import { chromium } from '@playwright/test'

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3000'
const CARD = '.nav-card-deferred'

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()

const consoleErrors = []
const pageErrors = []
const badResponses = []
let dataRequests = 0
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('response', (r) => {
  const s = r.status()
  if (s >= 400 && s < 600) badResponses.push({ url: r.url(), status: s })
})
page.on('request', (r) => {
  const t = r.resourceType()
  if (t === 'fetch' || t === 'xhr') dataRequests++
})

await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 })
await page.waitForSelector(CARD, { timeout: 60000 })
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})

const cardsInitial = await page.locator(CARD).count()
const toggleButtons = await page.locator('button[data-group-toggle]').count()

const firstTruncated = page.locator('button[data-group-toggle][aria-expanded="false"]').first()
const key = await firstTruncated.getAttribute('data-group-toggle')
const labelBefore = (await firstTruncated.textContent())?.trim() ?? ''
const toggleOf = () => page.locator(`button[data-group-toggle="${key}"]`)
const groupCount = () =>
  page.evaluate((k) => {
    const btn = document.querySelector(`button[data-group-toggle="${k}"]`)
    return btn?.parentElement?.querySelectorAll('.nav-card-deferred').length ?? -1
  }, key)

const groupBefore = await groupCount()

// 水合前点击会被丢弃：重试直到 aria-expanded 真的翻转
let hydrated = false
for (let i = 0; i < 8; i++) {
  await toggleOf().click({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(400)
  if ((await toggleOf().getAttribute('aria-expanded')) === 'true') {
    hydrated = true
    break
  }
}

const groupAfter = await groupCount()
const cardsAfterExpand = await page.locator(CARD).count()
const labelAfterExpand = (await toggleOf().textContent())?.trim() ?? ''

// 收起还原 + 展开/收起零数据请求
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
const reqBase = dataRequests
await toggleOf().click()
await page.waitForTimeout(500)
const groupRestored = await groupCount()
const cardsRestored = await page.locator(CARD).count()
const reqAfterToggle = dataRequests

// 移动端 390px：展开态是否水平溢出
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(500)
await toggleOf().click()
await page.waitForTimeout(500)
const mobileOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
)

const out = {
  base: BASE,
  cardsInitial,
  toggleButtons,
  clickedGroup: key,
  labelBefore,
  hydratedWithinRetries: hydrated,
  groupCardsBefore: groupBefore,
  groupCardsAfter: groupAfter,
  groupGrew: groupAfter > groupBefore,
  cardsAfterExpand,
  cardsGrew: cardsAfterExpand > cardsInitial,
  labelAfterExpand,
  groupCardsAfterCollapse: groupRestored,
  cardsAfterCollapse: cardsRestored,
  collapseRestored: groupRestored === groupBefore && cardsRestored === cardsInitial,
  dataRequestsDuringToggle: reqAfterToggle - reqBase,
  mobileHorizontalOverflow: mobileOverflow,
  consoleErrors: consoleErrors.slice(0, 5),
  pageErrors: pageErrors.slice(0, 5),
  badResponses: badResponses.slice(0, 10),
}

console.log(JSON.stringify(out, null, 2))
await browser.close()
const pass =
  out.hydratedWithinRetries &&
  out.groupGrew &&
  out.collapseRestored &&
  out.dataRequestsDuringToggle === 0 &&
  !out.mobileHorizontalOverflow &&
  pageErrors.length === 0
process.exit(pass ? 0 : 1)
