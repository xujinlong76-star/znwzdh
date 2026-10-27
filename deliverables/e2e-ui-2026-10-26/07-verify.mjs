import { session, open, OUT, BASE, state } from './harness.mjs'
import { writeFileSync } from 'node:fs'

/**
 * 定向复核：只查普查/巡检里「结论有歧义」的几处，避免把测量噪声写进报告。
 *   1) /videos 的 精选视频 / 七年级 / 语文 按钮是真的没反应，还是我的状态探针不够细
 *   2) /category 的 <summary> 折叠不展开
 *   3) 后台 5 个页面缺 h1 是真缺，还是骨架期没等到
 *   4) 首页出现 role=dialog 常驻节点（会影响巡检的 Escape 复位判定）
 *   5) 首页分类切换 5.5s 是长任务还是我的等待窗口
 *   6) 外链 0 状态码（网络失败）重试，区分真死链与本机网络抖动
 */
const out = { at: new Date().toISOString(), base: BASE }
const s = await session({ auth: true })

// 1) /videos 过滤器
await open(s.page, '/videos', { settle: 2500 })
const snap = () =>
  s.page.evaluate(() => {
    const txt = (sel) => [...document.querySelectorAll(sel)].map((e) => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 40))
    return {
      cards: document.querySelectorAll('[class*="video"], article, a[href*="bilibili"], a[href*="youtube"]').length,
      titles: txt('h3, h4').slice(0, 6),
      activeBtns: [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true' || b.className.includes('active') || b.getAttribute('data-state') === 'active').map((b) => (b.innerText || '').slice(0, 16)),
      bodyLen: document.body.innerText.length,
      mainText: (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
    }
  })
const v = { route: '/videos' }
v.before = await snap()
for (const label of ['七年级', '语文', '精选视频']) {
  const b = s.page.locator(`button:has-text("${label}")`).first()
  if (!(await b.isVisible().catch(() => false))) {
    v[label] = { visible: false }
    continue
  }
  const t0 = Date.now()
  const before = await snap()
  await b.click({ timeout: 5000 }).catch((e) => (v[label] = { clickError: String(e.message).slice(0, 80) }))
  await s.page.waitForTimeout(1200)
  const after = await snap()
  v[label] = {
    visible: true,
    ms: Date.now() - t0,
    ariaPressed: await b.getAttribute('aria-selected').catch(() => null),
    cls: (await b.getAttribute('class').catch(() => ''))?.slice(0, 70),
    titlesChanged: JSON.stringify(before.titles) !== JSON.stringify(after.titles),
    bodyDiff: after.bodyLen - before.bodyLen,
    beforeTitles: before.titles.slice(0, 3),
    afterTitles: after.titles.slice(0, 3),
  }
}
out.videosFilters = v

// 2) /category summary
await open(s.page, '/category', { settle: 1500 })
out.categorySummary = await s.page.evaluate(() => {
  const sums = [...document.querySelectorAll('summary')]
  return sums.slice(0, 12).map((su) => ({
    label: (su.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28),
    parent: su.parentElement?.tagName,
    open: !!su.parentElement?.hasAttribute('open'),
    children: su.parentElement?.querySelectorAll('a').length,
    hasOnClickAttr: !!su.getAttribute('onclick'),
  }))
})
{
  const target = s.page.locator('summary', { hasText: '运维与安全' }).first()
  const before = await s.page.evaluate(() => document.querySelectorAll('details[open]').length)
  if (await target.isVisible().catch(() => false)) {
    await target.click({ timeout: 4000 }).catch(() => {})
    await s.page.waitForTimeout(600)
    const after = await s.page.evaluate(() => document.querySelectorAll('details[open]').length)
    out.categorySummaryProbe = { before, after, expanded: after > before }
  } else {
    out.categorySummaryProbe = { found: false }
  }
}

// 3) 后台页面 h1（长 settle）
const h1rows = []
for (const route of ['/admin/navigation', '/admin/resources', '/admin/site', '/admin/sitelist', '/admin/videos', '/admin/tags']) {
  await open(s.page, route, { settle: 2500 })
  const info = await s.page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)]
    const vis = (e) => !!e.getClientRects().length
    return {
      h1: q('h1').filter(vis).map((e) => e.innerText.trim().slice(0, 30)),
      h2: q('h2').filter(vis).map((e) => e.innerText.trim().slice(0, 24)).slice(0, 3),
      headingish: q('[class*="text-lg"],[class*="text-xl"],[class*="font-bold"]').filter(vis).map((e) => e.innerText.trim().slice(0, 24)).filter(Boolean).slice(0, 4),
      mainAria: document.querySelector('main')?.getAttribute('aria-label') || '',
      skeleton: q('[class*="animate-pulse"],[aria-busy="true"]').length,
    }
  })
  h1rows.push({ route, ...info })
  console.log(`[h1] ${route} h1=${JSON.stringify(info.h1)} h2=${JSON.stringify(info.h2)} skeleton=${info.skeleton}`)
}
out.adminHeadings = h1rows

// 4) 首页常驻 dialog 节点 + 5) 分类切换真实延迟
await open(s.page, '/', { settle: 2000 })
out.homeDialogs = await s.page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].map((d) => ({
    label: d.getAttribute('aria-label') || d.id || '(none)',
    hidden: d.getAttribute('aria-hidden'),
    state: d.getAttribute('data-state'),
    visible: !!d.getClientRects().length,
    text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
  }))
)
{
  const btn = s.page.getByRole('button', { name: /^AI 编程助手$/ }).first()
  const t0 = Date.now()
  const frames = await s.page
    .evaluate(async (label) => {
      const el = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.innerText || '').trim() === label)
      if (!el) return { found: false }
      const start = performance.now()
      let longSeen = []
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) longSeen.push(Math.round(e.duration)) }).observe({ type: 'longtask' })
      } catch {}
      el.click()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const paint = Math.round(performance.now() - start)
      await new Promise((r) => setTimeout(r, 1500))
      return { found: true, paintMs: paint, longTasks: longSeen }
    }, 'AI 编程助手')
    .catch((e) => ({ error: String(e.message).slice(0, 80) }))
  out.homeTabSwitch = { ...frames, wallMs: Date.now() - t0 }
  console.log('[home] AI 编程助手 click ->', JSON.stringify(out.homeTabSwitch))
}

// 7) /graph 分类筛选与缩放：图谱是 SVG/Canvas，页面文本不变，需要看图形属性
await open(s.page, '/graph', { settle: 2500 })
const gsnap = () =>
  s.page.evaluate(() => {
    const svg = document.querySelector('svg')
    const g = document.querySelector('svg g[transform], svg > g')
    return {
      svgNodes: document.querySelectorAll('svg circle, svg rect, svg path, svg text').length,
      canvas: document.querySelectorAll('canvas').length,
      transform: g ? String(g.getAttribute('transform')).slice(0, 40) : '',
      viewBox: svg ? String(svg.getAttribute('viewBox')).slice(0, 40) : '',
      legend: [...document.querySelectorAll('main [class*="chip"],main button')].map((b) => (b.innerText || '').trim().slice(0, 12)).filter(Boolean).slice(0, 8),
      bodyLen: document.body.innerText.length,
    }
  })
out.graph = []
for (const label of ['全部', 'UI & 设计', 'AI 实验室', '放大', '缩小']) {
  const before = await gsnap()
  const b = s.page.locator(`main button:has-text("${label}")`).first()
  const vis = await b.isVisible().catch(() => false)
  if (!vis) {
    out.graph.push({ label, visible: false })
    continue
  }
  await b.click({ timeout: 3000 }).catch(() => {})
  await s.page.waitForTimeout(1000)
  const after = await gsnap()
  out.graph.push({
    label,
    visible: true,
    nodesDiff: after.svgNodes - before.svgNodes,
    transformChanged: after.transform !== before.transform,
    beforeTransform: before.transform,
    afterTransform: after.transform,
    bodyDiff: after.bodyLen - before.bodyLen,
  })
  console.log(`[graph] ${label} nodesDiff=${after.svgNodes - before.svgNodes} transform=${out.graph.at(-1).transformChanged}`)
}

// 8) /marketplace 标签与搜索按钮
await open(s.page, '/marketplace', { settle: 2200 })
const msnap = () =>
  s.page.evaluate(() => ({
    cards: document.querySelectorAll('[class*="plugin"], article').length,
    bodyLen: document.body.innerText.length,
    activeTabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"], button[data-state="active"]')].map((t) => (t.textContent || '').trim().slice(0, 14)),
    firstTitle: (document.querySelector('main h3, main [class*="title"]')?.textContent || '').trim().slice(0, 30),
    dialog: !!document.querySelector('[role="dialog"]'),
    head: (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
  }))
out.marketplace = []
for (const label of ['全部插件', '🔥 飙升榜', '搜索', '已安装', 'Taps 订阅源']) {
  const before = await msnap()
  const b = s.page.locator(`main button:has-text("${label}")`).first()
  const vis = await b.isVisible().catch(() => false)
  if (!vis) {
    out.marketplace.push({ label, visible: false })
    continue
  }
  const t0 = Date.now()
  let via = 'locator'
  await b.click({ timeout: 2500 }).catch(async () => {
    via = 'dom-fallback'
    await s.page.evaluate((l) => {
      const el = [...document.querySelectorAll('main button')].find((x) => (x.textContent || '').includes(l))
      if (el) el.click()
    }, label)
  })
  await s.page.waitForTimeout(1200)
  const after = await msnap()
  out.marketplace.push({
    label,
    visible: true,
    via,
    ms: Date.now() - t0,
    cardsDiff: after.cards - before.cards,
    bodyDiff: after.bodyLen - before.bodyLen,
    dialog: after.dialog,
    headChanged: after.head !== before.head,
    beforeActive: before.activeTabs,
    afterActive: after.activeTabs,
  })
  console.log(`[mkt] ${label} via=${via} ms=${Date.now() - t0} cards=${after.cards - before.cards} headChanged=${out.marketplace.at(-1).headChanged}`)
  if ((await state(s.page).catch(() => ({ dialog: false })))?.dialog) await s.page.keyboard.press('Escape')
  await s.page.waitForTimeout(300)
}

// 9) /custom 巡检里判为「无响应」的六个控件逐一定位
await open(s.page, '/custom', { settle: 2600 })
const csnap = () =>
  s.page.evaluate(() => ({
    modules: document.querySelectorAll('[class*="module"],[data-module],[class*="card"]').length,
    dialog: !!document.querySelector('[role="dialog"]'),
    bodyLen: document.body.innerText.length,
    canvasText: (document.querySelector('[class*="canvas"], main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
    hash: location.hash,
  }))
out.custom = []
for (const label of ['💻 全栈极客工作台', '赛博点阵画布', '时钟', 'UUID', '编辑模式', '复制全文内容', '添加模块']) {
  const before = await csnap()
  const b = s.page.locator(`main button:has-text("${label}"), main button[aria-label*="${label}"]`).first()
  const vis = await b.isVisible().catch(() => false)
  if (!vis) {
    out.custom.push({ label, visible: false })
    continue
  }
  await b.click({ timeout: 2500 }).catch(async () => {
    await s.page.evaluate((l) => {
      const el = [...document.querySelectorAll('main button')].find((x) => `${x.textContent} ${x.getAttribute('aria-label') || ''}`.includes(l))
      if (el) el.click()
    }, label)
  })
  await s.page.waitForTimeout(1200)
  const after = await csnap()
  out.custom.push({
    label,
    visible: true,
    dialogNow: after.dialog,
    bodyDiff: after.bodyLen - before.bodyLen,
    modulesDiff: after.modules - before.modules,
    hashChanged: after.hash !== before.hash,
    canvasChanged: after.canvasText !== before.canvasText,
  })
  console.log(`[custom] ${label} dialog=${after.dialog} bodyDiff=${after.bodyLen - before.bodyLen} modDiff=${after.modules - before.modules}`)
  if (after.dialog) {
    await s.page.keyboard.press('Escape')
    await s.page.waitForTimeout(400)
  }
}

// 10) 后台侧边栏「分组标题」按钮：导航管理/插件市场/资源管理 点下去到底该发生什么？
// 巡检判成「无响应」，但源码里它们本来就不是链接——AdminLayoutClient.tsx:225 是
// toggleMenuItem（展开子项），且子项只在 !isSidebarCollapsed 时渲染。
// 所以判据不是 URL，而是「子项链接是否出现」+ chevron 是否旋转。
await open(s.page, '/admin/trash', { settle: 3500 })
out.adminSidebar = []
for (const [label, child] of [['导航管理', '分类管理'], ['插件市场', '网址体检'], ['资源管理', '网站图标下载']]) {
  const read = () =>
    s.page.evaluate((c) => {
      const links = [...document.querySelectorAll('aside a, nav a')].map((a) => a.getAttribute('href'))
      return {
        childPresent: links.includes(c),
        url: location.pathname,
        chev: [...document.querySelectorAll('aside svg, nav svg')].filter((s2) => s2.className.baseVal?.includes('rotate-180')).length,
      }
    }, child)
  const b0 = await read()
  const btn = s.page.locator(`aside button:has-text("${label}"), nav button:has-text("${label}")`).first()
  const vis = await btn.isVisible().catch(() => false)
  // 点两次：一次展开、一次收起，验证 toggle 而非单向
  const t0 = Date.now()
  if (vis) await btn.click({ timeout: 2500 }).catch(() => {})
  const latency = Date.now() - t0
  await s.page.waitForTimeout(800)
  const b1 = await read()
  await (vis ? btn.click({ timeout: 2500 }).catch(() => {}) : null)
  await s.page.waitForTimeout(800)
  const b2 = await read()
  out.adminSidebar.push({ label, visible: vis, latency, before: b0, expanded: b1, collapsed: b2 })
  console.log(`[sidebar] ${label} vis=${vis} latency=${latency}ms 子项:${b0.childPresent}->${b1.childPresent}->${b2.childPresent} 导航:${b0.url}->${b1.url}`)
}

// 11) /sites 与 /tags 巡检「控件=0」：是真没有交互件，还是枚举/水合时窗问题？
out.zeroControlPages = []
for (const route of ['/sites', '/tags', '/collections', '/preferences']) {
  const rows = { route, at: [] }
  for (const settle of [600, 2500, 5000]) {
    await open(s.page, route, { settle })
    const inv = await s.page.evaluate(() => {
      const sel = 'button,[role="button"],a[href],[role="switch"],[role="tab"],summary,select,textarea,input'
      const all = [...document.querySelectorAll(sel)]
      const vis = all.filter((e) => (e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0))
      return {
        total: all.length,
        visible: vis.length,
        buttons: vis.filter((e) => e.tagName === 'BUTTON' || e.getAttribute('role') === 'button').length,
        inputs: vis.filter((e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)).length,
        bodyLen: document.body.innerText.length,
        sample: vis.slice(0, 6).map((e) => `${e.tagName}:${(e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14)}`),
      }
    })
    rows.at.push({ settle, ...inv })
    console.log(`[zero] ${route} settle=${settle} visible=${inv.visible} buttons=${inv.buttons} inputs=${inv.inputs} body=${inv.bodyLen}`)
  }
  out.zeroControlPages.push(rows)
}

// 6) 外链重试
const flagged = [
  'https://podcastle.ai/',
  'https://www.copy.ai/',
  'https://github.com/huggingface/peft',
  'https://uniapp.dcloud.net.cn/',
  'https://uberduck.ai/',
  'https://x.ai/',
  'https://poe.com/',
]
out.externalRetry = []
for (const u of flagged) {
  const attempts = []
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now()
    try {
      const r = await s.context.request.get(u, { timeout: 12_000, headers: { 'user-agent': 'Mozilla/5.0 Chrome/140 Safari/537.36' } })
      attempts.push({ status: r.status(), ms: Date.now() - t0 })
    } catch (e) {
      attempts.push({ status: 0, ms: Date.now() - t0, error: String(e.message).split('\n')[0].slice(0, 70) })
    }
  }
  out.externalRetry.push({ url: u, attempts })
  console.log(`[ext] ${u} ${JSON.stringify(attempts)}`)
}

writeFileSync(OUT + '07-verify.json', JSON.stringify(out, null, 2))
console.log('[saved] 07-verify.json')
await s.browser.close()
