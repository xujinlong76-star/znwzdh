import { session, open, metrics, OUT, BASE, state } from './harness.mjs'
import { writeFileSync } from 'node:fs'

/**
 * 性能与流畅度取样。
 *
 * 三段：
 *   1) 重复加载（冷/热）：每条路由跑 N 次，看中位数与波动，而不是单点数字。
 *   2) 交互延迟：点击 -> 两帧之后（rAF x2），拿到「输入到可见」的经验值；
 *      同时记录交互窗口内的长任务，用来区分「服务端慢」和「主线程被占死」。
 *   3) API 直连耗时：p50/p95，判断慢在渲染还是在中枢取数。
 */
const ROUTES = [
  '/', '/sites', '/category', '/tags', '/hot', '/videos', '/marketplace', '/custom',
  '/preferences', '/me', '/favorites', '/admin', '/admin/sitelist', '/admin/tags',
  '/admin/stats', '/admin/categories', '/admin/navigation', '/admin/taxonomy', '/admin/resources',
]
const RUNS = Number(process.env.PERF_RUNS || 3)
const API = process.env.AUDIT_API || 'http://127.0.0.1:8900'

const INTERACTIONS = [
  { route: '/', name: '首页切到「AI 编程助手」分类', label: 'AI 编程助手', kind: 'text' },
  { route: '/', name: '首页打开 Spotlight（/）', label: null, kind: 'slash' },
  { route: '/hot', name: '热度榜切换内容密度', label: '内容密度切换', kind: 'prefix' },
  { route: '/marketplace', name: '市场按类型筛选', label: '按类型筛选', kind: 'prefix' },
  { route: '/admin/sitelist', name: '站点台账搜索框输入', label: null, kind: 'type:sites' },
  { route: '/admin/tags', name: '标签治理首个标签按钮', label: null, kind: 'firstbtn' },
  { route: '/preferences', name: '偏好页第一个开关', label: null, kind: 'firstswitch' },
]

const s = await session({ auth: true })
const loads = []
for (const route of ROUTES) {
  const samples = []
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now()
    await open(s.page, route, { settle: 400 })
    const wall = Date.now() - t0
    const m = await metrics(s.page).catch(() => null)
    samples.push({ wall, ...(m || {}) })
    if (i < RUNS - 1) await s.page.waitForTimeout(300)
  }
  const med = (key) => {
    const v = samples.map((x) => x[key] || 0).sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)] || 0
  }
  loads.push({
    route,
    samples,
    wallMed: med('wall'),
    wallMin: Math.min(...samples.map((x) => x.wall)),
    wallMax: Math.max(...samples.map((x) => x.wall)),
    ttfbMed: med('ttfb'),
    loadMed: med('loadEnd'),
    lcpMed: med('lcp'),
    clsMed: med('cls'),
    longMed: med('longTaskMsTotal'),
    dom: samples.at(-1).domNodes,
    htmlKB: samples.at(-1).htmlKB,
    bytesKB: samples.at(-1).bytesKB,
    jsKB: samples.at(-1).jsKB,
    resources: samples.at(-1).resources,
  })
  const l = loads.at(-1)
  console.log(`[load] ${route} wall=${l.wallMed}(${l.wallMin}~${l.wallMax}) ttfb=${l.ttfbMed} lcp=${l.lcpMed} cls=${l.clsMed} lt=${l.longMed} dom=${l.dom} html=${l.htmlKB}KB js=${l.jsKB}KB`)
}

// 交互延迟：点击到两帧后
const inter = []
for (const it of INTERACTIONS) {
  await open(s.page, it.route, { settle: 1500 })
  const before = await state(s.page).catch(() => null)
  let did = false
  const t0 = Date.now()
  try {
    if (it.kind === 'slash') {
      await s.page.keyboard.press('/')
      did = true
    } else if (it.kind === 'type:sites') {
      const box = s.page.locator('main#main-content input[type="search"], main#main-content input[placeholder*="搜索"], input[placeholder*="搜索"]').first()
      if (await box.isVisible().catch(() => false)) {
        await box.click({ timeout: 4000 })
        await box.type('git', { delay: 10 })
        did = true
      }
    } else if (it.kind === 'firstbtn') {
      await s.page.locator('main#main-content button').first().click({ timeout: 4000 })
      did = true
    } else if (it.kind === 'firstswitch') {
      const sw = s.page.locator('[role="switch"]').first()
      if (await sw.count()) { await sw.click({ timeout: 4000 }); did = true }
      else { await s.page.locator('main#main-content button').first().click({ timeout: 4000 }); did = true }
    } else {
      const loc = s.page.getByRole('button', { name: new RegExp(it.label) }).or(s.page.locator(`text=${it.label}`)).first()
      await loc.click({ timeout: 6000 })
      did = true
    }
  } catch (err) {
    inter.push({ ...it, error: String(err.message).slice(0, 120) })
    continue
  }
  const latency = await s.page
    .evaluate(() => new Promise((res) => {
      const t = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => res(Math.round(performance.now() - t))))
    }))
    .catch(() => -1)
  await s.page.waitForTimeout(700)
  const after = await state(s.page).catch(() => null)
  const v = await s.page.evaluate(() => (window.__v?.long || []).slice(-3))
  inter.push({
    route: it.route,
    name: it.name,
    clickMs: Date.now() - t0 - 700,
    framesMs: latency,
    responded: !!after && (after.url !== before?.url || after.dialog !== before?.dialog || Math.abs(after.bodyHash - before?.bodyHash) > 20 || JSON.stringify(after.toast) !== JSON.stringify(before?.toast) || JSON.stringify(after.checked) !== JSON.stringify(before?.checked)),
    recentLongTasks: v,
  })
  console.log(`[int] ${it.name}: frames=${latency}ms clickMs=${inter.at(-1).clickMs} resp=${inter.at(-1).responded} long=${JSON.stringify(v)}`)
}

// API 直连耗时（全部为真实注册路由：/api/hot、/api/videos、/api/graph、
// /api/admin/stats、/api/sitemap-entries 都不存在——/hot /videos /graph 页是
// 纯客户端数据，不查中枢，所以不能把它们算成「接口慢/404」。
const apiEndpoints = [
  '/api/sites?limit=60', '/api/sites?limit=200', '/api/categories', '/api/categories/counts',
  '/api/tags?limit=200', '/api/search?q=ai&limit=20', '/api/search?q=%E5%B7%A5%E5%85%B7&limit=50',
  '/api/rank/trending', '/api/rank/new', '/api/plugins?limit=60', '/api/collections',
  '/api/recipes', '/api/comparisons', '/api/graph/centrality', '/api/stats', '/api/health',
  '/api/jobs', '/api/trash', '/api/submissions', '/api/admin/stats/trends',
]
const apiRes = []
for (const p of apiEndpoints) {
  const times = []
  let status = 0
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now()
    try {
      const r = await fetch(API + p, { headers: { accept: 'application/json' } })
      status = r.status
      const body = await r.text()
      times.push(Date.now() - t0)
      if (i === 4) apiRes.push({ path: p, status, kb: Math.round(body.length / 1024), p50: times.sort((a, b) => a - b)[2], max: Math.max(...times) })
    } catch (e) {
      apiRes.push({ path: p, status: 0, error: String(e.message).slice(0, 60) })
      break
    }
  }
  const a = apiRes.at(-1)
  console.log(`[api] ${p} -> ${a.status} p50=${a.p50}ms max=${a.max}ms ${a.kb}KB`)
}

// 移动端视口
const mobile = []
await s.browser.close()
const ms = await session({ auth: false, viewport: { width: 390, height: 844 } })
for (const route of ['/', '/sites', '/hot', '/marketplace', '/me', '/custom', '/tags']) {
  const t0 = Date.now()
  await open(ms.page, route, { settle: 800 })
  const m = await metrics(ms.page).catch(() => null)
  mobile.push({ route, wall: Date.now() - t0, ...(m || {}) })
  console.log(`[m] ${route} wall=${mobile.at(-1).wall} lcp=${m?.lcp} cls=${m?.cls} overflow=${m?.scrollOverflow}`)
}

writeFileSync(
  OUT + '06-perf.json',
  JSON.stringify({ base: BASE, runs: RUNS, loads, interactions: inter, api: apiRes, mobile }, null, 2)
)
console.log('[saved] 06-perf.json')
await ms.browser.close()
