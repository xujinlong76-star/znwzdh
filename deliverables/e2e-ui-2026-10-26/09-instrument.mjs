/**
 * 用「对的仪器」复核巡检判为无响应的控件。
 *
 * 这些控件的反应形态根本不在 DOM 里，页面级 diff 必然看不见：
 *   filechooser —— 原生文件选择器（导入书签、上传封面）
 *   download    —— 触发浏览器下载（导出 JSON / 导出 Markdown / 明文 JSON）
 *   network     —— 只发请求、返回同样数据时 DOM 一字不变（刷新、同步快照）
 *   svg transform —— 缩放改的是 <g transform>（图谱放大/缩小）
 *   native validity —— 必填校验弹的是浏览器原生气泡（提交推荐收录）
 * 逐个确认，避免把「巡检测不到」写成「功能坏了」。
 */
import { session, open, OUT, BASE } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const s = await session({ auth: true })
const out = { base: BASE, checks: [] }

async function instrument(route, label, expect, extra = () => {}) {
  const rec = { route, label, expect, events: [], reqs: [], note: '' }
  await open(s.page, route, { settle: 2200 })
  const fc = []
  const dl = []
  const reqs = []
  // 注意：一旦挂上 filechooser 监听，Playwright 就不再自动关闭系统文件框，
  // 必须显式 setFiles([]) 取消，否则浏览器会一直卡在原生弹窗上。
  s.page.on('filechooser', (c) => {
    fc.push(c)
    c.setFiles([]).catch(() => {})
  })
  s.page.on('download', (d) => dl.push({ name: d.suggestedFilename() }))
  s.page.on('request', (r) => {
    const m = r.method()
    if (m !== 'GET' && r.url().includes('/api/')) reqs.push(`${m} ${r.url().replace(BASE, '').slice(0, 50)}`)
    if (m === 'GET' && /\/api\/(hub\/)?(favorites|stats|vitals|trashed|search-usage)/.test(r.url())) reqs.push(`GET ${r.url().replace(BASE, '').slice(0, 50)}`)
  })
  const loc = s.page.getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
  const vis = await loc.isVisible().catch(() => false)
  if (!vis) {
    rec.note = '按钮不可见/不存在'
    out.checks.push(rec)
    console.log(`\n=== ${route} :: ${label} -> ${rec.note}`)
    return rec
  }
  const before = await extra('before')
  try {
    await loc.click({ timeout: 3000 })
  } catch (e) {
    rec.note = '点击失败 ' + String(e.message).split('\n')[0].slice(0, 50)
  }
  await s.page.waitForTimeout(1500)
  const after = await extra('after')
  rec.events = [
    ...fc.map(() => 'filechooser(原生文件选择器)'),
    ...dl.map((d) => `download(${d.name})`),
  ]
  rec.reqs = [...new Set(reqs)].slice(0, 6)
  rec.domDelta = before && after && JSON.stringify(before) !== JSON.stringify(after) ? { before, after } : null
  rec.verdict = rec.events.length || rec.reqs.length || rec.domDelta ? '有响应（形态见 events/reqs/domDelta）' : '仍无任何可观测响应'
  out.checks.push(rec)
  console.log(`\n=== ${route} :: ${label} —— ${rec.verdict}`)
  if (rec.events.length) console.log('    events:', rec.events.join(', '))
  if (rec.reqs.length) console.log('    请求:', rec.reqs.join(' | '))
  if (rec.domDelta) console.log('    DOM:', JSON.stringify(rec.domDelta).slice(0, 180))
  if (rec.note) console.log('    note:', rec.note)
  return rec
}

// 下载类
await instrument('/favorites', '明文 JSON', 'download', () => s.page.evaluate(() => document.body.innerText.length))
await instrument('/admin/plugin-health', '导出 JSON', 'download', () => s.page.evaluate(() => document.body.innerText.length))
await instrument('/admin/plugin-health', '导出 Markdown', 'download', () => s.page.evaluate(() => document.body.innerText.length))
await instrument('/admin/plugin-health', '同步快照', 'network', () => s.page.evaluate(() => document.body.innerText.length))
// 刷新类（数据不变时 DOM 不变）
await instrument('/me', '刷新', 'network', () => s.page.evaluate(() => document.body.innerText.length))
await instrument('/admin/plugins', '刷新', 'network', () => s.page.evaluate(() => document.body.innerText.length))
// 文件选择器类
await instrument('/me/data', '从浏览器书签', 'filechooser', () => s.page.evaluate(() => document.body.innerText.length))
// 原生必填校验
await instrument('/submit', '提交推荐收录', 'native-validity', () => s.page.evaluate(() => document.body.innerText.length))
// 已激活空点类：/favorites 的「全部 20」
await instrument('/favorites', '全部 20', 'noop-if-active', () => s.page.evaluate(() => document.body.innerText.length))

// 图谱缩放：看 svg <g transform>
await open(s.page, '/graph', { settle: 2500 })
for (const name of ['放大', '缩小']) {
  const t0 = await s.page.evaluate(() => [...document.querySelectorAll('svg g[transform]')].map((g) => g.getAttribute('transform')).join(' | ').slice(0, 120))
  await s.page.getByRole('button', { name }).first().click({ timeout: 2500 }).catch(() => {})
  await s.page.waitForTimeout(900)
  const t1 = await s.page.evaluate(() => [...document.querySelectorAll('svg g[transform]')].map((g) => g.getAttribute('transform')).join(' | ').slice(0, 120))
  out.checks.push({ route: '/graph', label: name, expect: 'svg-transform', events: [], reqs: [], verdict: t0 !== t1 ? '有响应（transform 变化）' : '仍无响应', domDelta: { before: t0, after: t1 } })
  console.log(`\n=== /graph :: ${name} —— ${t0 !== t1 ? '有响应' : '无响应'}\n    before=${t0}\n    after =${t1}`)
}

// 图谱分类筛选：看 SVG 节点数量
const nodeCount = () => s.page.evaluate(() => document.querySelectorAll('svg g[transform] circle, svg g circle, svg g text').length)
for (const name of ['UI & 设计', 'AI 实验室', '全部']) {
  const n0 = await nodeCount()
  await s.page.getByRole('button', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first().click({ timeout: 2500 }).catch(() => {})
  await s.page.waitForTimeout(1200)
  const n1 = await nodeCount()
  out.checks.push({ route: '/graph', label: name, expect: 'svg-node-count', events: [], reqs: [], verdict: n0 !== n1 ? `有响应（节点 ${n0}→${n1}）` : `仍无响应（${n0}→${n1}）` })
  console.log(`\n=== /graph :: 筛选 ${name} —— 节点 ${n0} -> ${n1}`)
}

// 视频页筛选：看卡片标题集合
await open(s.page, '/videos', { settle: 2200 })
const vids = () => s.page.evaluate(() => [...document.querySelectorAll('a[href*="/videos/"]')].map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16)).slice(0, 6).join('|'))
for (const name of ['精选视频', '七年级', '语文']) {
  const v0 = await vids()
  await s.page.getByRole('button', { name: new RegExp(name) }).first().click({ timeout: 2500 }).catch(() => {})
  await s.page.waitForTimeout(1200)
  const v1 = await vids()
  out.checks.push({ route: '/videos', label: name, expect: 'card-list', events: [], reqs: [], verdict: v0 !== v1 ? '有响应（列表变化）' : '仍无响应（列表未变）', domDelta: { before: v0, after: v1 } })
  console.log(`\n=== /videos :: ${name} —— ${v0 !== v1 ? '有响应' : '无响应'}\n    before=${v0}\n    after =${v1}`)
}

// 市场：全部插件 / 飙升榜 —— 看 role=tab 的 aria-selected
await open(s.page, '/marketplace', { settle: 2500 })
for (const name of ['全部插件', '飙升榜', '搜索']) {
  const before = await s.page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => `${(t.textContent || '').trim().slice(0, 12)}=${t.getAttribute('aria-selected')}`).join(' | '))
  const loc = s.page.locator('[role="tab"]', { hasText: name }).first()
  const ok = await loc.isVisible().catch(() => false)
  if (ok) await loc.click({ timeout: 2500 }).catch(() => {})
  else await s.page.getByRole('button', { name: new RegExp(name) }).first().click({ timeout: 2500 }).catch(() => {})
  await s.page.waitForTimeout(1200)
  const after = await s.page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => `${(t.textContent || '').trim().slice(0, 12)}=${t.getAttribute('aria-selected')}`).join(' | '))
  out.checks.push({ route: '/marketplace', label: name, expect: 'tab-selected', events: [], reqs: [], verdict: before !== after ? '有响应（选中态变化）' : '仍无响应（选中态未变）', domDelta: { before, after } })
  console.log(`\n=== /marketplace :: ${name} —— ${before !== after ? '有响应' : '无响应'}\n    before=${before}\n    after =${after}`)
}

writeFileSync(OUT + '09-instrument-checks.json', JSON.stringify(out, null, 2))
console.log('\n[saved] 09-instrument-checks.json')
console.log('\n=== 汇总 ===')
for (const c of out.checks) console.log(`  ${c.route} | ${c.label} → ${c.verdict}`)
await s.browser.close()
