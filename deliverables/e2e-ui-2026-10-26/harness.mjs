import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'

export const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:3400'
export const API = process.env.AUDIT_API || 'http://127.0.0.1:8900'
export const OUT = fileURLToPath(new URL('./results/', import.meta.url))
export const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url))
mkdirSync(OUT, { recursive: true })
mkdirSync(SHOTS, { recursive: true })

const IGNORED_CONSOLE = [
  /data-trae-ref/i, /Download the React DevTools/i, /chrome-extension:\/\//i,
  /favicon/i, /\[HMR\]/i, /net::ERR_UNKNOWN_URL_SCHEME/i,
]

/** 单次浏览器会话：登录态可通过 storageState 复用 */
/**
 * 确保会话确实是登录态：storageState 过期 / cookie 域与 BASE 不一致时，
 * 页面会静默退回登录页，登录态巡检就变成「匿名巡检」——结果是假的。
 * 这里显式检测并现场走一次管理员旁路，重新落盘 storageState。
 */
export async function ensureAuth(page, context) {
  const probe = await page.request
    .get(BASE + '/api/auth/session', { headers: { accept: 'application/json' } })
    .catch(() => null)
  const body = probe ? await probe.text().catch(() => '') : ''
  if (/"(name|id)"\s*:/.test(body)) return { ok: true, via: 'storageState', session: body.slice(0, 120) }

  await page.goto(BASE + '/auth/signin', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {})
  const bypass = page.getByRole('button', { name: /以管理员身份一键进入/ }).first()
  for (let i = 0; i < 3; i++) {
    if (!(await bypass.isVisible().catch(() => false))) break
    await bypass.click({ timeout: 8000 }).catch(() => {})
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith('/auth/signin'), { timeout: 20_000, waitUntil: 'commit' })
      .then(() => true)
      .catch(() => false)
    if (left) break
  }
  const recheck = await page.request
    .get(BASE + '/api/auth/session', { headers: { accept: 'application/json' } })
    .catch(() => null)
  const rb = recheck ? await recheck.text().catch(() => '') : ''
  const ok = /"(name|id)"\s*:/.test(rb)
  if (ok) await context.storageState({ path: STATE_FILE })
  return { ok, via: 'bypass-login', url: page.url(), session: rb.slice(0, 120) }
}

export const STATE_FILE = OUT + 'storage-state.json'

export async function session({ auth = false, viewport } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: viewport || { width: 1440, height: 900 },
    ...(auth ? { storageState: OUT + 'storage-state.json' } : {}),
  })
  context.setDefaultTimeout(20_000)
  const page = await context.newPage()
  const logs = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], badResponses: [] }
  page.on('console', (m) => {
    try {
    const t = m.type()
    const text = m.text().slice(0, 300)
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return
    if (t === 'error') logs.consoleErrors.push(text)
    else if (t === 'warning') logs.consoleWarnings.push(text)
    } catch {}
  })
  page.on('pageerror', (e) => { try { logs.pageErrors.push(String(e.message).slice(0, 300)) } catch {} })
  page.on('requestfailed', (req, failure) => {
    try {
    const u = req.url()
    if (/hot-update|sockjs|\.woff2?($|\?)/i.test(u)) return
    logs.failedRequests.push(`${req.method()} ${path(u)} :: ${failure?.errorText}`)
    } catch {}
  })
  page.on('response', (r) => {
    try {
    if (r.status() >= 400) logs.badResponses.push(`${r.status()} ${path(r.url())}`)
    } catch {}
  })
  await context.addInitScript(VITALS)
  if (auth) {
    const check = await ensureAuth(page, context)
    if (!check.ok) console.warn(`[session] 登录态建立失败：url=${check.url} body=${check.session} —— 后续「登录态」结果不可信`)
    else console.log(`[session] 登录态 OK via=${check.via} ${check.session}`)
  }
  return { browser, context, page, logs }
}

export function path(u) {
  try {
    const x = new URL(u)
    return x.pathname + x.search.slice(0, 70)
  } catch {
    return String(u).slice(0, 100)
  }
}

const VITALS = `(() => {
  window.__v = { lcp: 0, cls: 0, inp: 0, long: [] }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = Math.max(window.__v.lcp, e.startTime) }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentChange) window.__v.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((l) => { const e = l.getEntries().slice(-1)[0]; if (e) window.__v.inp = Math.max(window.__v.inp || 0, e.duration) }).observe({ type: 'event', buffered: true, durationThreshold: 40 })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.long.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: true })
  } catch (e) {}
})()`

/** 打开页面：等壳 + 等一个「数据到达才出现」的选择器；返回耗时 */
export async function open(page, url, { until = 'load', settle = 1200, timeout = 60_000 } = {}) {
  const t0 = Date.now()
  await page.goto(url.startsWith('http') ? url : BASE + url, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForLoadState(until, { timeout }).catch(() => {})
  if (settle) await page.waitForTimeout(settle)
  return Date.now() - t0
}

export async function metrics(page) {
  return page.evaluate(`(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const res = performance.getEntriesByType('resource') || []
    let bytes = 0, js = 0
    for (const r of res) { bytes += r.transferSize || 0; if (r.initiatorType === 'script') js += r.transferSize || 0 }
    const v = window.__v || {}
    return {
      ttfb: Math.round(nav.responseStart || 0),
      domReady: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEnd: Math.round(nav.loadEventEnd || 0),
      lcp: Math.round(v.lcp || 0),
      cls: Number((v.cls || 0).toFixed(4)),
      inpMax: Math.round(v.inp || 0),
      longTasks: (v.long || []).length,
      longTaskMsTotal: (v.long || []).reduce((a, b) => a + b, 0),
      resources: res.length,
      bytesKB: Math.round(bytes / 1024),
      jsKB: Math.round(js / 1024),
      domNodes: document.querySelectorAll('*').length,
      htmlKB: Math.round(document.documentElement.outerHTML.length / 1024),
      scrollOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }
  })()`)
}

/** 等可点击（含水合），失败返回 false 而不抛 */
export async function waitVisible(loc, ms = 15_000) {
  try {
    await loc.first().waitFor({ state: 'visible', timeout: ms })
    return true
  } catch {
    return false
  }
}

export const byText = (page, text, { role = 'button', exact = false } = {}) =>
  page.getByRole(role, { name: text, exact })

/** 按可见文本点击：role 名称 → hasText → getByText → DOM 原生 click 四级兜底 */
/**
 * 站点卡片计数：首页用 `div[data-navhub-site-id]`（整卡外链直接跳外部站点，
 * 页内没有一条 /site/ 详情链接），目录页 /sites、/category 才用 `a[href^="/site/"]`。
 * 只按其中一种写法计数，会把另一种页面读成 0 —— 取两者较大值。
 */
export async function cardCount(page) {
  const [a, b] = await Promise.all([
    page.locator('[data-navhub-site-id]').count().catch(() => 0),
    page.locator('a[href^="/site/"]').count().catch(() => 0),
  ])
  return Math.max(a, b)
}

export async function clickText(page, needle, { scope, role = 'button', timeout = 12_000 } = {}) {
  const label = typeof needle === 'string' ? needle : String(needle.source).replace(/\\\//g, '/')
  const root = scope ? page.locator(scope) : page
  const tries = [
    () => root.getByRole(role, { name: needle }),
    () => root.locator('button,a,[role="button"],[role="menuitem"],[role="tab"],[role="switch"]', { hasText: label }),
    () => root.getByText(needle),
  ]
  for (const make of tries) {
    const loc = make()
    if (await waitVisible(loc, Math.min(timeout, 6000))) {
      const t0 = Date.now()
      try {
        await loc.first().click({ timeout: 8000 })
        return { clicked: true, ms: Date.now() - t0, via: tries.indexOf(make) }
      } catch {
        /* 落到 DOM 兜底 */
      }
      const okDom = await page.evaluate(({ n }) => {
        const sel = 'button,a,[role="button"],[role="menuitem"],[role="tab"],[role="switch"]'
        const el = [...document.querySelectorAll(sel)].find((e) => (e.textContent || '').includes(n) && e.getClientRects().length)
        if (el) { el.click(); return true }
        return false
      }, { n: label })
      if (okDom) return { clicked: true, ms: Date.now() - t0, via: 'dom-fallback' }
    }
  }
  return { clicked: false, ms: 0, via: 'none' }
}

export async function state(page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    dialog: !!document.querySelector('[role="dialog"],[role="alertdialog"]'),
    menu: !!document.querySelector('[role="menu"][data-state="open"],[data-radix-menu-content]'),
    toast: [...document.querySelectorAll('[data-sonner-toast],[role="status"],[role="alert"]')].map((t) => t.textContent.trim().slice(0, 80)).filter(Boolean),
    bodyHash: document.body.innerText.length,
    /**
     * 只比长度会漏判一类真实响应：排序/筛选/切 Tab 之后，同一批卡片换个顺序，
     * innerText 长度可能一字不差（同样的字、同样的数量），页面级信号全为 false，
     * 于是被误判成「点了没反应」。这里加一个内容指纹（FNV-1a），
     * 顺序变了、文字换了都会被抓到；纯样式类变化仍由 theme/cls 负责。
     */
    textSig: (() => {
      const t = document.body.innerText
      let h = 0x811c9dc5
      for (let i = 0; i < t.length; i++) {
        h ^= t.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return h
    })(),
    checked: [...document.querySelectorAll('[role="switch"][aria-checked],[role="checkbox"][aria-checked]')].map((e) => e.getAttribute('aria-checked')),
    /**
     * SVG 内的文字不属于 innerText：图谱（/graph）筛选或缩放后节点换位、
     * 连线增减，页面文本一字不变，只用 innerText 会把真响应判成「无响应」。
     * 这里给 SVG 文本单独做指纹。
     */
    svgSig: (() => {
      let t = ''
      for (const s of document.querySelectorAll('svg')) t += s.textContent
      let h = 0x811c9dc5
      for (let i = 0; i < t.length; i++) {
        h ^= t.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return (t.length >>> 0) * 100003 + h
    })(),
    /**
     * 浮层：Radix 的 Select/Combobox 弹层不是 [role=dialog]，而是
     * [data-radix-popper-content-wrapper] 里的 listbox/option；
     * 只查 dialog+menu 会把「下拉打开了」判成无响应。
     */
    popup: document.querySelectorAll('[role="listbox"],[role="menu"],[role="option"],[data-radix-popper-content-wrapper],[data-radix-menu-content]').length,
    selectVal: [...document.querySelectorAll('select')].map((e) => `${e.getAttribute('aria-label') || e.name || ''}=${e.value}`).join('|'),
    activeTab: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((t) => t.textContent.trim().slice(0, 20)),
    resultCount: document.querySelectorAll('article,[data-site-card],[role="listitem"]').length,
    // 主题/密度等「改类名不改内容」的控件也要能判出响应
    theme: document.documentElement.className.slice(0, 120) + '|' + (document.documentElement.dataset.theme || ''),
    detailsOpen: document.querySelectorAll('details[open]').length,
  }))
}

export class Recorder {
  constructor(module) {
    this.module = module
    this.steps = []
  }

  async run(name, fn, { expect: expectation = '' } = {}) {
    const before = { t: Date.now() }
    try {
      const detail = await fn()
      this.steps.push({ name, status: 'PASS', ms: Date.now() - before.t, expectation, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
      console.log(`  ✓ ${name} ${typeof detail === 'string' ? detail : ''}`)
    } catch (err) {
      this.steps.push({ name, status: 'FAIL', ms: Date.now() - before.t, expectation, error: String(err.message).slice(0, 400) })
      console.log(`  ✗ ${name} :: ${String(err.message).slice(0, 160)}`)
    }
  }

  note(name, detail) {
    this.steps.push({ name, status: 'NOTE', detail: String(detail).slice(0, 400) })
    console.log(`  · ${name} ${String(detail).slice(0, 140)}`)
  }

  async save(tag, logs) {
    const file = `${OUT}${tag}.json`
    writeFileSync(file, JSON.stringify({ module: this.module, at: new Date().toISOString(), steps: this.steps, logs }, null, 2))
    console.log(`[saved] ${file}  PASS=${this.steps.filter((s) => s.status === 'PASS').length} FAIL=${this.steps.filter((s) => s.status === 'FAIL').length}`)
    return file
  }
}

/**
 * 同步断言。之前写成 `export async function assert`，
 * 而调用点大多写成 `assert(cond, msg)`（不 await）——
 * 那样抛出的其实是「被丢弃的 rejected promise」：
 * Recorder 照样记 PASS，进程稍后才被 unhandledRejection 打死。
 * 于是 05-edge 里「非法 slug 返回 500」「投稿无限流」这些真缺陷全被刷成了 ✓。
 */
export function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  return true
}

/** 打开搜索面板（快捷键 / 或 Cmd+K），返回是否成功 */
export async function openSpotlight(page) {
  await page.keyboard.press('/')
  await page.waitForTimeout(700)
  let vis = await page.locator('[role="dialog"]').isVisible().catch(() => false)
  if (!vis) {
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(900)
    vis = await page.locator('[role="dialog"]').isVisible().catch(() => false)
  }
  return vis
}

// 停用/启用 归入 danger：本轮实测把根类目「AI 工具」停用，导致其整棵子树的
// /category/<slug> 全变 404（234 条逐字段对比只差这一个 flag），影响面远超单个按钮。
const DANGER_RE = /(删除|清空|注销|退出登录|移除|卸载|重置|恢复出厂|吊销|下架|驳回|丢弃|重建|覆盖|停用|启用|drop|delete|remove|revoke|destroy|logout|sign ?out|purge|wipe|apply restore|restore)/i
const MUTATE_RE = /(保存|提交|应用|确认|安装|发布|上传|导入|新建|新增|创建|审批|通过|执行|运行|触发|立即|同步|导出|刷新|重试|签发|套用|添加|save|submit|apply|install|publish|upload|import|create|new|add|approve|run|sync|export|generate|issue)/i

export function riskOf(label) {
  if (DANGER_RE.test(label)) return 'danger'
  if (MUTATE_RE.test(label)) return 'mutate'
  return 'safe'
}

/** 给当前页可见按钮打序号标记并返回描述 */
export async function enumerate(page) {
  return page.evaluate(() => {
    const sel =
      'button,[role="button"],a[href],[role="switch"],[role="checkbox"],[role="tab"],summary,[aria-haspopup="menu"],input[type="checkbox"],input[type="radio"],input[type="file"],select,textarea,[role="combobox"],[role="slider"],[role="menuitem"]'
    const out = []
    let i = 0
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      if (el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') continue
      const label = (
        el.getAttribute('aria-label') ||
        el.title ||
        el.textContent ||
        el.getAttribute('href') ||
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? `占位:${el.placeholder || el.type}` : el.tagName === 'SELECT' ? `下拉:${(el.options && el.options[el.selectedIndex] && el.options[el.selectedIndex].text) || ''}` : '')
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50)
      if (!label) continue
      el.setAttribute('data-audit-idx', String(i))
      out.push({
        idx: i,
        label,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        href: el.getAttribute('href') || '',
        target: el.getAttribute('target') || '',
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        popup: el.getAttribute('aria-haspopup') || '',
      })
      i++
    }
    return out
  })
}

/** 内部链接批量校验状态码（点击会离开当前页，改用请求验证目标可达性） */
export async function checkLinks(context, entries, { concurrency = 8 } = {}) {
  const queue = entries.slice()
  const out = []
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift()
      const t0 = Date.now()
      const target = e.href.startsWith('/') ? BASE + e.href : e.href
      try {
        const r = await context.request.get(target, {
          timeout: e.internal ? 15_000 : 10_000,
          headers: { accept: 'text/html' },
        })
        out.push({ ...e, status: r.status(), ms: Date.now() - t0, ok: r.ok() })
      } catch (err) {
        out.push({ ...e, status: 0, ms: Date.now() - t0, ok: false, error: String(err.message).slice(0, 120) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
  return out
}

/** 读控件自身的可观测属性（点击后是否有「属于它的反馈」） */
export async function probe(page, idx) {
  return page.evaluate((n) => {
    const el = document.querySelector(`[data-audit-idx="${n}"]`)
    if (!el) return { exists: false }
    const g = (a) => el.getAttribute(a)
    const r = el.getBoundingClientRect()
    return {
      exists: true,
      label: g('aria-label'),
      checked: g('aria-checked'),
      expanded: g('aria-expanded'),
      pressed: g('aria-pressed'),
      selected: g('aria-selected'),
      state: g('data-state'),
      cls: String(el.className || '').slice(0, 160),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      detailsOpen: el.tagName === 'SUMMARY' ? String(!!el.parentElement?.hasAttribute('open')) : '',
    }
  }, idx)
}

function selfDelta(a, b) {
  if (!b || !b.exists) return { gone: true }
  const d = {}
  for (const k of ['label', 'checked', 'expanded', 'pressed', 'selected', 'state', 'cls', 'text', 'box', 'detailsOpen']) {
    if (String(a[k]) !== String(b[k])) d[k] = `${a[k]} -> ${b[k]}`
  }
  return d
}

/**
 * 逐控件点击巡检。
 *
 * 复位策略按代价分层：点击后没离开页面也没弹层 -> 不复位（最省时间）；
 * 弹层 -> Escape；Escape 无效或发生了导航 -> 重新打开页面并重新枚举。
 * 链接不点击（会把巡检页面导航走），改用请求校验目标状态码。
 * 「响应」判定同时看页面级信号（URL/弹层/toast/内容长度/列表条数）
 * 与控件自身信号（aria-checked、data-state、类名、文本、尺寸）——
 * 只看页面级会把「Tab 已选中再点一次」「折叠面板」误判成失灵。
 */
export async function sweep(page, url, { limit = 30, skipRisk = ['danger'], reloadSettle = 1200, linkLimit = 80 } = {}) {
  const results = []
  const seen = new Set()
  await open(page, url, { settle: reloadSettle })
  let items = await enumerate(page)

  const linkSeen = new Set()
  const linkEntries = []
  for (const it of items) {
    if (it.tag === 'a' && it.href && !linkSeen.has(it.href)) {
      linkSeen.add(it.href)
      linkEntries.push({ label: it.label, href: it.href, internal: it.href.startsWith('/') })
    }
  }
  const links = await checkLinks(page.context(), linkEntries.slice(0, linkLimit))

  let cursor = 0
  while (results.length < limit && cursor < items.length) {
    let item = items[cursor++]
    const key = `${item.tag}:${item.role}:${item.label}:${item.href}`
    if (seen.has(key)) continue
    seen.add(key)
    if (item.tag === 'a') continue // 链接走状态码校验
    // 原生输入控件：点击只产生焦点（无法判定「预期响应」），且 <select>/<file>
    // 会拉起系统级弹层挡住后续巡检 —— 输入行为改由 04-flows 用打字/赋值验证。
    if (item.tag === 'input' && item.type === 'file') {
      results.push({ ...item, risk: 'safe', action: 'file-input' })
      continue
    }
    if (item.tag === 'textarea' || (item.tag === 'input' && !['checkbox', 'radio'].includes(item.type))) {
      results.push({ ...item, risk: 'safe', action: 'field' })
      continue
    }
    /**
     * 原生 <select> 也是「交互控件」，必须真改值：
     * 市场/后台的筛选与排序大量用 select，跳过它等于没测这部分功能。
     * 选一个和当前不同的 option，改完立刻测页面响应，再复位成原值。
     */
    if (item.tag === 'select') {
      const opts = await page.evaluate((n) => {
        const el = document.querySelector(`[data-audit-idx="${n}"]`)
        return el ? { value: el.value, list: [...el.options].map((o) => o.value).filter((v) => v !== '') } : null
      }, item.idx)
      if (!opts || opts.list.length < 2) {
        results.push({ ...item, risk: 'safe', action: 'field', note: '没有可切换的第二项' })
        continue
      }
      const next = opts.list.find((v) => v !== opts.value) || opts.list[0]
      const sBefore = await state(page)
      const tSel = Date.now()
      const changed = await page
        .selectOption(`[data-audit-idx="${item.idx}"]`, next)
        .then(() => true)
        .catch(() => false)
      await page.waitForTimeout(900)
      const sAfter = await state(page).catch(() => null)
      const selDelta = sAfter ? diffState(sBefore, sAfter) : {}
      const valueChanged = !sAfter || sAfter.selectVal !== sBefore.selectVal
      results.push({
        ...item,
        risk: 'safe',
        action: 'select',
        clicked: changed,
        via: 'selectOption',
        ms: Date.now() - tSel,
        responded: valueChanged && (Object.values(selDelta).some(Boolean) || !!next),
        from: opts.value,
        to: next,
        optionCount: opts.list.length,
        delta: selDelta,
      })
      // 复位，避免污染后续控件的判定
      await page.selectOption(`[data-audit-idx="${item.idx}"]`, opts.value).catch(() => {})
      await page.waitForTimeout(400)
      continue
    }
    const risk = riskOf(item.label)
    if (skipRisk.includes(risk)) {
      results.push({ ...item, risk, action: 'skipped-danger' })
      continue
    }
    if (item.disabled) {
      results.push({ ...item, risk, action: 'disabled' })
      continue
    }
    /**
     * 失配自愈：上一个控件可能触发列表整批重渲染，DOM 节点被替换后
     * data-audit-idx 就失效了 —— 这会被误记成「点不着」。
     * 先确认标记还在；不在就重载本路由重新打标，并把游标对齐到同名控件之后。
     */
    const alive = await page
      .evaluate((n) => !!document.querySelector(`[data-audit-idx="${n}"]`), item.idx)
      .catch(() => false)
    if (!alive) {
      await open(page, url, { settle: 600 })
      items = await enumerate(page)
      const fresh = items.find((x) => x.tag === item.tag && x.label === item.label)
      if (!fresh) {
        results.push({
          ...item,
          risk,
          clicked: false,
          via: 'missing',
          ms: 0,
          responded: false,
          note: '重载重标后仍找不到该控件（多半被前一次点击从 DOM 移除）',
        })
        continue
      }
      item = fresh
      cursor = items.indexOf(fresh) + 1
    }
    const before = await state(page)
    const beforeSelf = await probe(page, item.idx)
    const alreadyActive =
      beforeSelf.selected === 'true' ||
      beforeSelf.checked === 'true' ||
      beforeSelf.expanded === 'true' ||
      beforeSelf.detailsOpen === 'true'
    const t0 = Date.now()
    let clicked = false
    // via 记录真实命中方式：Playwright 常规点击要求「可动作」（没被遮挡、不在动画中），
    // 5s 内点不动会抛错再走 DOM 兜底——ms≈5000+ 是「点不着」而不是「响应慢」，
    // 两者必须在报告里分开，否则会把遮挡问题误报成性能问题。
    let via = 'locator'
    try {
      await page.locator(`[data-audit-idx="${item.idx}"]`).first().click({ timeout: 2500 })
      clicked = true
    } catch {
      via = 'dom-fallback'
      clicked = await page.evaluate((n) => {
        const el = document.querySelector(`[data-audit-idx="${n}"]`)
        if (el) { el.click(); return true }
        return false
      }, item.idx)
    }
    await page.waitForTimeout(500)
    let after = await state(page).catch(() => null)
    if (!after) {
      // 导航把 evaluate 打断：控件确实有响应（跳页），等落地后再复位
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {})
      after = await state(page).catch(() => ({ url: page.url().replace(BASE, ''), dialog: false, menu: false, toast: [], bodyHash: 0, checked: [], activeTab: [], resultCount: 0 }))
    }
    let afterSelf = await probe(page, item.idx).catch(() => ({ exists: false }))
    let pageDelta = diffState(before, after)
    let self = selfDelta(beforeSelf, afterSelf)
    if (!Object.values(pageDelta).some(Boolean) && !Object.keys(self).length) {
      await page.waitForTimeout(700)
      const again = await state(page).catch(() => null)
      if (again) {
        pageDelta = diffState(before, again)
        after = again
        afterSelf = await probe(page, item.idx).catch(() => ({ exists: false }))
        self = selfDelta(beforeSelf, afterSelf)
      }
    }
    const ms = Date.now() - t0
    const responded = Object.values(pageDelta).some(Boolean) || Object.keys(self).length > 0
    results.push({
      ...item,
      risk,
      clicked,
      via,
      ms,
      responded,
      alreadyActive: !responded && alreadyActive,
      toastSeen: after.toast?.slice(-1)?.[0] || '',
      delta: pageDelta,
      self: Object.keys(self).length ? self : undefined,
    })

    /**
     * 复位策略（只恢复「能被恢复」的污染）：
     *   1) 跳页 → 重新加载本路由，游标归零；
     *   2) 浮层/菜单/弹窗打开 → Esc 关掉，关不掉才整页重载。
     * 「收起侧边栏」这类写入 localStorage 的全局态，重载同一 URL 也回不去，
     * 只能靠「每个路由新开浏览器上下文」复扫（见 03c-admin.mjs）；
     * 在这里对每个控件无条件 reload 既治不了它，又让耗时翻 3 倍。
     * 列表重渲染导致的 data-audit-idx 失配，改由点击失败时自愈重试处理。
     */
    if (after.url !== before.url) {
      await open(page, url, { settle: 700 })
      items = await enumerate(page)
      cursor = 0
      continue
    }
    if (after.dialog || after.menu || after.popup > before.popup) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const still = await state(page).catch(() => null)
      if (still && (still.dialog || still.menu || still.popup > after.popup)) {
        await open(page, url, { settle: 700 })
        items = await enumerate(page)
        cursor = 0
      }
    }
  }
  return { results, links }
}

function diffState(before, after) {
  return {
    urlChanged: after.url !== before.url,
    dialog: after.dialog && !before.dialog,
    menu: after.menu && !before.menu,
    toast: after.toast.length > before.toast.length,
    bodyChanged: Math.abs(after.bodyHash - before.bodyHash) > 40 || after.textSig !== before.textSig,
    checkedChanged: JSON.stringify(after.checked) !== JSON.stringify(before.checked),
    tabChanged: JSON.stringify(after.activeTab) !== JSON.stringify(before.activeTab),
    resultsChanged: after.resultCount !== before.resultCount,
    themeChanged: after.theme !== before.theme,
    detailsChanged: after.detailsOpen !== before.detailsOpen,
    svgChanged: after.svgSig !== before.svgSig,
    popupChanged: (after.popup || 0) !== (before.popup || 0),
    selectChanged: (after.selectVal || '') !== (before.selectVal || ''),
    newTab: (after.newPages || 0) > (before.newPages || 0),
  }
}
