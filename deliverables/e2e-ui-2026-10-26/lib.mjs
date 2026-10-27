import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:3200'
export const API = process.env.AUDIT_API || 'http://127.0.0.1:8900'
export const OUT = fileURLToPath(new URL('./results/', import.meta.url))
export const STATE = OUT + 'storage-state.json'

export const ROUTES = {
  public: [
    '/', '/sites', '/category', '/tags', '/collections', '/hot', '/videos',
    '/graph', '/algorithms', '/marketplace', '/custom', '/preferences',
    '/submit', '/import', '/me', '/favorites', '/offline', '/auth/signin',
  ],
  authed: [
    '/me', '/me/account', '/me/data', '/me/history', '/me/notifications',
    '/me/plugins', '/me/settings', '/me/vault', '/me/workspaces',
    '/favorites', '/custom', '/preferences', '/import', '/submit',
    '/marketplace', '/marketplace/installed', '/marketplace/mine', '/marketplace/publish',
    '/graph', '/algorithms',
  ],
  admin: [
    '/admin', '/admin/ai', '/admin/audit', '/admin/categories', '/admin/collections',
    '/admin/facets', '/admin/jobs', '/admin/navigation', '/admin/plugin-health',
    '/admin/plugins', '/admin/resources', '/admin/site', '/admin/sitelist',
    '/admin/stats', '/admin/tags', '/admin/taxonomy', '/admin/tokens',
    '/admin/trash', '/admin/videos', '/admin/data/restore',
  ],
}

const DANGER = /(删除|清空|注销|退出登录|移除|重置|恢复出厂|吊销|下架|驳回|丢弃|drop|delete|remove|revoke|destroy|logout|sign ?out|purge|wipe)/i
const MUTATE = /(保存|提交|应用|确认|安装|发布|上传|导入|新建|新增|创建|启用|停用|审批|通过|执行|运行|触发|立即|同步|导出|刷新|重试|重试|retry|save|submit|apply|install|publish|upload|import|create|new|add|enable|disable|approve|run|sync|export|refresh)/i

export function classify(label) {
  if (DANGER.test(label)) return 'danger'
  if (MUTATE.test(label)) return 'mutate'
  return 'safe'
}

export async function launch(opts = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  })
  context.setDefaultTimeout(45_000)
  const page = await context.newPage()
  return { browser, context, page }
}

export function observe(page, bag) {
  page.on('console', (m) => {
    const t = m.type()
    if (t === 'error' || t === 'warning') {
      const text = m.text().slice(0, 400)
      if (/data-trae-ref|Extension|favicon|Download the React DevTools|Recoverable Error|hydrat/i.test(text) && t === 'error' && /trae|extension|devtools/i.test(text)) return
      ;(t === 'error' ? bag.consoleErrors : bag.consoleWarnings).push(text)
    }
  })
  page.on('pageerror', (e) => bag.pageErrors.push(String(e.message).slice(0, 400)))
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (/favicon|\.woff|\.woff2|sockjs|hot-update|__next|analytics/i.test(u)) return
    bag.failedRequests.push(`${r.method()} ${short(u)} :: ${r.failure()?.errorText}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) bag.badResponses.push(`${r.status()} ${r.request().method()} ${short(r.url())}`)
  })
}

export function short(u) {
  try {
    const x = new URL(u)
    return x.host + x.pathname + (x.search ? x.search.slice(0, 60) : '')
  } catch {
    return u.slice(0, 120)
  }
}

export const METRIC_PROBE = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {}
  const res = performance.getEntriesByType('resource')
  const byType = {}
  let total = 0
  for (const r of res) {
    const t = r.initiatorType || 'other'
    byType[t] = (byType[t] || 0) + (r.transferSize || 0)
    total += r.transferSize || 0
  }
  const lcp = (window.__lcp || []).slice(-1)[0]
  const inp = (window.__inp || 0)
  const cls = (window.__cls || 0)
  const longTasks = (window.__long || [])
  return {
    ttfb: Math.round(nav.responseStart || 0),
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    loadEnd: Math.round(nav.loadEventEnd || 0),
    lcp: lcp ? Math.round(lcp.value) : null,
    cls: Number((cls || 0).toFixed(3)),
    inp: Math.round(inp),
    resourceCount: res.length,
    resourceBytes: total,
    jsBytes: byType.script || 0,
    cssBytes: byType.css || 0,
    imgBytes: (byType.img || 0) + (byType.link || 0),
    fetchBytes: (byType.xmlhttprequest || 0) + (byType.fetch || 0),
    longTaskCount: longTasks.length,
    longTaskTotalMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
    maxLongTaskMs: Math.round(longTasks.length ? Math.max(...longTasks) : 0),
    domNodes: document.querySelectorAll('*').length,
    htmlKB: Math.round(document.documentElement.outerHTML.length / 1024),
  }
})()`

export const VITALS_BOOTSTRAP = `(() => {
  window.__lcp = []; window.__cls = 0; window.__inp = 0; window.__long = []
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push({ value: e.startTime }) }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentChange) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((l) => { const e = l.getEntries().slice(-1)[0]; if (e) window.__inp = e.duration }).observe({ type: 'event', buffered: true, durationThreshold: 40 })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration - 50) }).observe({ type: 'longtask', buffered: true })
  } catch (err) {}
})()`

export async function controls(page) {
  return page.evaluate(() => {
    const sel = 'button,[role="button"],a[href],input,select,textarea,[role="switch"],[role="tab"],[role="menuitem"],[role="combobox"],[role="checkbox"],[role="radio"],summary,[aria-haspopup]'
    const out = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      const visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      const label = (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.name || el.type || '').trim().replace(/\s+/g, ' ').slice(0, 60)
      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        label,
        href: el.getAttribute('href') || '',
        haspopup: el.getAttribute('aria-haspopup') || '',
        checked: el.getAttribute('aria-checked') ?? (el.checked ?? ''),
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        visible,
        inViewport: visible && r.top < innerHeight && r.bottom > 0,
      })
    }
    return out
  })
}

export function newBag() {
  return { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], badResponses: [] }
}

/** 管理员快捷登录（本地 dev 栈）；返回是否成功离开登录页 */
export async function loginAsAdmin(page) {
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForLoadState('load', { timeout: 90_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  if (!page.url().includes('/auth/signin')) return { ok: true, url: page.url() }
  const bypass = page.getByRole('button', { name: /以管理员身份一键进入/ }).first()
  const n = await page.getByRole('button', { name: /以管理员身份一键进入/ }).count()
  const visible = await bypass.isVisible().catch((e) => { console.log('[login] visibility error:', String(e.message).slice(0, 120)); return false })
  console.log(`[login] bypass matches=${n} visible=${visible}`)
  if (!visible) {
    const body = await page.locator('body').innerText().catch(() => '')
    return { ok: false, reason: 'bypass-button-missing', snippet: body.slice(0, 600) }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    await bypass.click({ force: attempt > 1 })
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith('/auth/signin'), { timeout: 40_000, waitUntil: 'commit' })
      .then(() => true)
      .catch(() => false)
    if (left) return { ok: true, url: page.url(), attempts: attempt }
    await page.waitForTimeout(1500)
  }
  const err = await page.locator('[role="alert"], .text-destructive, form p').allInnerTexts().catch(() => [])
  return { ok: false, reason: 'still-on-signin', attempts: 3, errorText: err.join(' | ').slice(0, 400), url: page.url() }
}

export async function save(name, data) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(OUT + name, JSON.stringify(data, null, 2))
  console.log(`[saved] ${name}`)
}
