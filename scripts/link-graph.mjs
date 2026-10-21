#!/usr/bin/env node
/**
 * 站内链接图采集器（零依赖，Node >= 20）
 *
 * 用于链接架构（IA）的验收指标采集，对应
 * docs/seo/link-architecture-navhub.md 的 §8「8 周可量化目标」：
 *   - 孤岛页面数（SSR 入链 = 0）
 *   - 内容型页面平均入链
 *   - 最大点击深度（首页出发）
 *   - ≤3 点击可达页面占比
 *   - 每页出链数
 *   - 软 404 探针（随机 slug 必须 404，不是 200）
 *
 * 用法：
 *   node scripts/link-graph.mjs                        # 默认 localhost:3000，上限 400 个 URL
 *   node scripts/link-graph.mjs --max-urls=2500 --max-depth=6
 *   node scripts/link-graph.mjs --check                # CI 模式：违反阈值时退出码 1
 *   node scripts/link-graph.mjs --no-probe             # 跳过软 404 探针
 *
 * 只跟同源 HTML 里的 <a href>，不执行 JS —— 这与爬虫首轮抓取一致，
 * 因此「入链」口径是 SSR 口径，不含客户端水合后新增的链接。
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// ---------- 参数 ----------
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=?(.*))?$/.exec(a)
    return m ? [m[1], m[2] === '' ? true : m[2] ?? true] : [a, true]
  }),
)
const BASE = String(argv.base ?? 'http://localhost:3000').replace(/\/$/, '')
const MAX_URLS = Number(argv['max-urls'] ?? 400)
const MAX_DEPTH = Number(argv['max-depth'] ?? 6)
const CONCURRENCY = Number(argv.concurrency ?? 8)
const OUT = resolve(String(argv.out ?? 'data/link-graph.json'))
const CHECK = Boolean(argv.check)
/** --assert-pagination：校验 /sites 分页的 robots 语义（seo-optimizer 的三条断言 + 首屏出链数） */
const ASSERT_PAGINATION = Boolean(argv['assert-pagination'])
const PROBE = !argv['no-probe']
const TIMEOUT_MS = Number(argv.timeout ?? 30000)
/**
 * --from-db：从 navhub.db 反推「应有页面清单」。
 *
 * 必需。只看 BFS 会说"孤岛 0 个"——因为孤岛压根没被发现（入链为 0 的页面
 * 永远不会被 BFS 走到）。只有拿库存清单减去「入链 > 0 的页面」，才能算出
 * 报告 §1 里那个 2164 的真实值。
 */
const FROM_DB = (() => {
  const v = argv['from-db']
  if (v === undefined) return 'data/navhub.db'
  const str = String(v)
  return ['none', 'off', 'false', 'true'].includes(str) ? null : str
})()
// 默认 2 而不是 1：710 个 1 站标签按设计渲染成 <span>（不接内链）+ 页面
// noindex（TAG_LINK_MIN=2，见 components/tag-cloud.tsx）。universe 若仍按
// minCount=1 统计，它们会被算成孤岛，--check 必红。需要旧口径时显式传
// --tag-min=1。
const TAG_MIN = Number(argv['tag-min'] ?? 2)

/** robots.ts 里显式 disallow 的路径，不参与链接图（爬虫也拿不到） */
const DISALLOWED = [/^\/admin(\/|$)/, /^\/api\//, /^\/preferences(\/|$)/, /^\/favorites(\/|$)/, /^\/s(\/|$)/]
/** 静态资源与非页面路径 */
const SKIP_EXT = /\.(png|jpe?g|webp|svg|ico|css|js|mjs|json|xml|txt|woff2?|ttf|map)$/i

/** URL 类型分类（用于分类型统计，与报告 §1 的表格口径一致） */
const RESERVED_MARKETPLACE = /^\/marketplace\/(author|import|installed|mine|publish)(\/|$)/
const TYPES = [
  ['site', /^\/site\/[^/]+$/],
  ['tag', /^\/tags\/[^/]+$/],
  ['tagsHub', /^\/tags$/],
  ['category', /^\/category(\/[^/]+)?$/],
  ['collection', /^\/collections\/[^/]+$/],
  ['collectionsHub', /^\/collections$/],
  ['marketplaceSub', RESERVED_MARKETPLACE],
  ['plugin', /^\/marketplace\/[^/]+$/],
  ['marketplaceHub', /^\/marketplace$/],
  ['sites', /^\/sites$/],
  ['home', /^\/$/],
]

function typeOf(pathname) {
  for (const [name, re] of TYPES) if (re.test(pathname)) return name
  return 'other'
}

// ---------- URL 归一 ----------
/** 把 href 归一成稳定的 key：同源、去 hash、去追踪参数、去尾斜杠、保留 page */
function normalize(href, baseUrl) {
  let u
  try {
    u = new URL(href, baseUrl)
  } catch {
    return null
  }
  if (u.origin !== new URL(BASE).origin) return null
  if (SKIP_EXT.test(u.pathname)) return null
  if (u.pathname.startsWith('/_next/')) return null
  if (DISALLOWED.some((re) => re.test(u.pathname))) return null

  // 只保留 page 参数；其余（utm/ref/sort…）一律丢弃，避免同页多 URL 稀释统计
  const kept = new URLSearchParams()
  const page = u.searchParams.get('page')
  if (page != null) kept.set('page', page)

  let pathname = u.pathname
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.replace(/\/+$/, '')
  const qs = kept.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

function splitPath(key) {
  const [pathname, search] = key.split('?')
  return { pathname, page: search ? new URLSearchParams(search).get('page') : null }
}

// ---------- 抓取 ----------
const stats = { fetched: 0, failed: 0, bytes: 0, nonHtml: 0 }

async function fetchHtml(key) {
  const url = BASE + key
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'navhub-link-graph/1.0 (+internal IA audit)', accept: 'text/html' },
    })
    if (res.status !== 200) return { status: res.status, html: null }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html')) {
      stats.nonHtml += 1
      return { status: res.status, html: null }
    }
    const html = await res.text()
    stats.fetched += 1
    stats.bytes += Buffer.byteLength(html)
    return { status: res.status, html }
  } catch {
    stats.failed += 1
    return { status: 0, html: null }
  } finally {
    clearTimeout(timer)
  }
}

const HREF_RE = /href\s*=\s*"([^"]*)"/g

function extractLinks(html, pageKey) {
  const out = new Set()
  let m
  HREF_RE.lastIndex = 0
  while ((m = HREF_RE.exec(html))) {
    const key = normalize(m[1].replace(/&amp;/g, '&'), BASE + pageKey)
    if (key && key !== pageKey) out.add(key)
  }
  return [...out]
}

// ---------- 应有页面清单（从库反推） ----------
async function loadUniverse() {
  if (!FROM_DB) return new Map()
  let DatabaseSync
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    console.warn('[warn] node:sqlite 不可用（需 Node >= 22），跳过 --from-db，孤岛统计将只覆盖已被发现的 URL')
    return new Map()
  }
  const db = new DatabaseSync(resolve(FROM_DB))
  const out = new Map()
  const add = (k) => out.set(k, true)

  add('/')
  for (const t of ['/tags', '/collections', '/marketplace', '/hot', '/graph', '/algorithms', '/custom', '/import', '/videos', '/submit']) add(t)

  for (const r of db.prepare("select id from sites where status = 'active' and deleted_at is null").all()) add(`/site/${r.id}`)
  for (const r of db.prepare('select slug from collections where enabled = 1').all()) add(`/collections/${r.slug}`)
  for (const r of db.prepare("select slug from plugins where status = 'published'").all()) add(`/marketplace/${r.slug}`)
  // 标签计数只算存活站点（与 store 的 listTagsWithCounts 同口径，2026-10-21）：
  // 裸 count(site_tags) 会把软删除站点的关联算进来，universe 虚高 → 大量
  // 「孤岛」实为已删站点的标签页，--check 指标失真。
  for (const r of db
    .prepare(
      `select t.slug from tags t
        left join site_tags st on st.tag_id = t.id
        left join sites s on s.id = st.site_id and s.deleted_at is null and s.enabled = 1
       group by t.id
      having count(s.id) >= ?`,
    )
    .all(TAG_MIN)) {
    add(`/tags/${encodeURIComponent(r.slug)}`)
  }
  return out
}

/** <meta name="robots" content="...">，兼容属性顺序颠倒与单双引号 */
function extractRobots(html) {
  const re = /<meta\b[^>]*>/gi
  let m
  while ((m = re.exec(html))) {
    const tag = m[0]
    const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(tag)
    if (!name || !/^robots$/i.test(name[1].trim())) continue
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)
    return (content ? content[1] : '').toLowerCase()
  }
  return ''
}

// ---------- BFS ----------
async function crawl() {
  const edges = new Map() // from -> [to]
  const depth = new Map([['/', 0]])
  const title = new Map()
  const robots = new Map()
  const status = new Map()
  const queue = ['/']
  const seen = new Set(queue)

  let frontier = ['/']
  let d = 0
  while (frontier.length && d < MAX_DEPTH && seen.size < MAX_URLS) {
    const next = []
    for (let i = 0; i < frontier.length; i += CONCURRENCY) {
      const batch = frontier.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map(async (key) => {
          const { status: st, html } = await fetchHtml(key)
          return { key, st, html }
        }),
      )
      for (const { key, st, html } of results) {
        status.set(key, st)
        const links = html ? extractLinks(html, key) : []
        edges.set(key, links)
        const t = html ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) : null
        if (t) title.set(key, t[1].trim().slice(0, 120))
        if (html) robots.set(key, extractRobots(html))
        for (const to of links) {
          if (!seen.has(to) && seen.size < MAX_URLS) {
            seen.add(to)
            depth.set(to, d + 1)
            next.push(to)
          }
        }
      }
    }
    frontier = next
    d += 1
  }
  // 已发现但未抓取的（超过 max-urls）也要计入"入链"，否则孤岛会被高估
  for (const to of edges.values()) for (const t of to) if (!depth.has(t)) depth.set(t, MAX_DEPTH + 1)
  return { edges, depth, title, status, robots }
}

// ---------- 指标 ----------
function computeMetrics({ edges, depth, title, status }, universe) {
  const indegree = new Map()
  const outdegree = new Map()
  for (const [from, tos] of edges) {
    outdegree.set(from, tos.length)
    for (const to of tos) indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }

  // 全量 = 库存清单 ∪ BFS 发现的（BFS 可能发现清单外的 URL，例如 /marketplace/import）
  const all = new Set([...universe.keys(), ...depth.keys()])
  // 库存里有但 BFS 没走到的，深度记为「不可达」
  const UNREACHABLE = MAX_DEPTH + 1
  const dep = (k) => depth.get(k) ?? UNREACHABLE

  const crawled = new Set(edges.keys())
  const ymd = (k) => typeOf(splitPath(k).pathname)

  const orphans = [...all].filter((k) => k !== '/' && (indegree.get(k) ?? 0) === 0)

  const byType = {}
  for (const k of all) {
    const t = ymd(k)
    byType[t] ??= { urls: 0, crawled: 0, indegreeSum: 0, orphans: 0, depthSum: 0, reachable: 0 }
    const b = byType[t]
    b.urls += 1
    if (crawled.has(k)) b.crawled += 1
    b.indegreeSum += indegree.get(k) ?? 0
    b.depthSum += dep(k) <= MAX_DEPTH ? dep(k) : MAX_DEPTH
    if ((indegree.get(k) ?? 0) === 0 && k !== '/') b.orphans += 1
    if (dep(k) <= MAX_DEPTH) b.reachable += 1
  }
  for (const b of Object.values(byType)) {
    b.avgIndegree = +(b.indegreeSum / b.urls).toFixed(2)
    b.avgDepth = +(b.depthSum / b.urls).toFixed(2)
    b.reachablePct = +((b.reachable / b.urls) * 100).toFixed(1)
  }

  const contentTypes = new Set(['site', 'tag', 'category', 'collection', 'plugin', 'sites'])
  const contentUrls = [...all].filter((k) => contentTypes.has(ymd(k)))
  const contentIndegree = contentUrls.reduce((s, k) => s + (indegree.get(k) ?? 0), 0)

  const reachable = [...all].filter((k) => dep(k) <= MAX_DEPTH)
  const maxDepthReached = Math.max(0, ...[...all].map((k) => (dep(k) <= MAX_DEPTH ? dep(k) : -1)))

  return {
    indegree,
    outdegree,
    orphans,
    byType,
    totals: {
      urls: all.size,
      universeSize: universe.size,
      crawled: crawled.size,
      maxDepthReached,
      reachableUrls: reachable.length,
      reachablePct: +((reachable.length / all.size) * 100).toFixed(1),
      orphanCount: orphans.length,
      orphanPct: +((orphans.length / all.size) * 100).toFixed(1),
      contentUrls: contentUrls.length,
      contentAvgIndegree: +(contentIndegree / Math.max(1, contentUrls.length)).toFixed(3),
      maxOutlinks: Math.max(0, ...outdegree.values()),
      maxOutlinksAt: [...outdegree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      totalBytes: stats.bytes,
      fetchFailed: stats.failed,
    },
  }
}

// ---------- 软 404 探针 ----------
async function probeSoft404() {
  const patterns = ['/site/{rand}', '/tags/{rand}', '/collections/{rand}', '/category/{rand}']
  const rand = () => `zz-probe-${Math.random().toString(36).slice(2, 10)}`
  const hits = []
  for (const p of patterns) {
    for (let i = 0; i < 3; i += 1) {
      const path = p.replace('{rand}', rand())
      try {
        const res = await fetch(BASE + path, { redirect: 'manual' })
        hits.push({ path, status: res.status, soft404: res.status === 200 })
      } catch {
        hits.push({ path, status: 0, soft404: false })
      }
    }
  }
  return { probed: hits.length, soft404Count: hits.filter((h) => h.soft404).length, samples: hits }
}

// ---------- 输出 ----------
function printReport(m, probe) {
  const pad = (s, n) => String(s).padEnd(n)
  const num = (s, n) => String(s).padStart(n)
  console.log('\n=== 链接图总览 ===')
  const t = m.totals
  console.log(`库存页面          ${num(t.universeSize, 6)}   （--from-db 反推，含未发现的孤岛）`)
  console.log(`图中 URL          ${num(t.urls, 6)}   （已抓取 ${t.crawled}）`)
  console.log(`孤岛（入链=0）    ${num(t.orphanCount, 6)}   ${t.orphanPct}%`)
  console.log(`内容型页面        ${num(t.contentUrls, 6)}   平均入链 ${t.contentAvgIndegree}`)
  console.log(`最大点击深度      ${num(t.maxDepthReached, 6)}   ≤${MAX_DEPTH} 跳可达 ${t.reachablePct}%`)
  console.log(`单页最大出链      ${num(t.maxOutlinks, 6)}   ${t.maxOutlinksAt ?? '-'}`)
  console.log(`抓取失败          ${num(t.fetchFailed, 6)}   累计 HTML ${(t.totalBytes / 1048576).toFixed(1)} MB`)

  console.log('\n=== 分类型 ===')
  console.log(
    pad('类型', 14) + num('URL', 7) + num('孤岛', 7) + num('均入链', 9) + num('均深度', 9) + num('可达%', 8),
  )
  const order = TYPES.map((x) => x[0]).concat('other')
  for (const k of order) {
    const b = m.byType[k]
    if (!b) continue
    console.log(
      pad(k, 14) + num(b.urls, 7) + num(b.orphans, 7) + num(b.avgIndegree, 9) + num(b.avgDepth, 9) + num(b.reachablePct, 8),
    )
  }

  if (probe) {
    console.log('\n=== 软 404 探针 ===')
    console.log(`探测 ${probe.probed} 个随机 slug，返回 200 的 ${probe.soft404Count} 个`)
    for (const h of probe.samples.filter((x) => x.soft404)) console.log(`  ${h.status}  ${h.path}`)
  }
}

/**
 * `/sites` 分页的 robots 语义断言（seo-optimizer 规格）。
 *
 * 为什么必须进 CI：这里的错误都是「不报错、只是白做」的形态——
 *   · 为了 noindex 顺手写 follow:false → 1013 条内链的权重传递当场断掉；
 *   · 页 1 被判 noindex → 整个目录页白建；
 *   · `?page=1` 返 200 → 同页两个 URL 并存。
 * 路由未建时（当前 /sites 是 404）不判失败，只标注 skipped。
 */
async function assertPagination(graph) {
  const results = []
  const robots = graph.robots ?? new Map()
  const outlinks = graph.edges ?? new Map()
  const siteLinksOf = (key) => (outlinks.get(key) ?? []).filter((u) => u.startsWith('/site/'))
  const crawled = (key) => outlinks.has(key)

  // 前置：路由是否存在
  const head = async (key) => {
    try {
      const res = await fetch(BASE + key, { redirect: 'manual' })
      return res.status
    } catch {
      return 0
    }
  }
  const rootStatus = await head('/sites')
  const page1Status = await head('/sites?page=1')
  const built = rootStatus === 200

  if (!built) {
    return {
      applicable: false,
      note: `/sites 未上线（GET /sites = ${rootStatus}），4 条断言全部 skipped`,
      failures: [],
    }
  }

  // 断言 1：分页页有 /site/ 出链但 robots 含 nofollow
  // 独立探测 page=2，不依赖 BFS 是否走到——断言不能依赖抓取覆盖
  const probePagination = async (key) => {
    try {
      const res = await fetch(BASE + key, { redirect: 'manual' })
      if (res.status !== 200) return { key, status: res.status, robots: '', siteLinks: 0 }
      const html = await res.text()
      return {
        key,
        status: res.status,
        robots: extractRobots(html),
        siteLinks: extractLinks(html, key).filter((u) => u.startsWith('/site/')).length,
      }
    } catch {
      return { key, status: 0, robots: '', siteLinks: 0 }
    }
  }
  for (const key of ['/sites?page=2', '/sites?page=3']) {
    const p = await probePagination(key)
    if (p.status !== 200) continue
    if (p.siteLinks > 0 && p.robots.includes('nofollow')) {
      results.push({
        ok: false,
        rule: 'pagination-follow',
        detail: `${key} 有 ${p.siteLinks} 条 /site/ 出链，但 robots="${p.robots}" 含 nofollow —— 权重传递会断`,
        fix: '改为 {index:false, follow:true}',
      })
    } else {
      results.push({
        ok: true,
        rule: 'pagination-follow',
        detail: `${key} robots="${p.robots}"，${p.siteLinks} 条 /site/ 出链`,
      })
    }
  }
  if (!robots.has('/sites?page=2')) {
    // 记录一下：BFS 没走到分页页，说明分页链接不可爬（本身也是个提示，不判失败）
    results.push({ ok: true, rule: 'pagination-discoverable', detail: 'BFS 未从页 1 发现 ?page=2（分页链接可能不在 SSR 里）' })
  }

  // 断言 2：页 1 不得 noindex
  const rootRobots = robots.get('/sites') ?? ''
  if (rootRobots.includes('noindex')) {
    results.push({
      ok: false,
      rule: 'page1-indexable',
      detail: `/sites（页 1）robots="${rootRobots}" 含 noindex —— 目录主体必须可索引`,
      fix: '页 1 移除 robots.noindex',
    })
  } else {
    results.push({ ok: true, rule: 'page1-indexable', detail: `/sites robots="${rootRobots || '(无)'}"` })
  }

  // 断言 3：?page=1 必须 308 到 /sites
  if (![301, 308].includes(page1Status)) {
    results.push({
      ok: false,
      rule: 'page1-canonical-url',
      detail: `/sites?page=1 返回 ${page1Status}，期望 301/308 —— 同页两个 URL 并存`,
      fix: '在 page.tsx 里对 page=1 做 permanentRedirect("/sites")',
    })
  } else {
    results.push({ ok: true, rule: 'page1-canonical-url', detail: `/sites?page=1 → ${page1Status}` })
  }

  // 断言 4：页 1 首屏 SSR 的 /site/ 出链数 = 60
  const n = siteLinksOf('/sites').length
  if (n !== 60) {
    results.push({
      ok: false,
      rule: 'page1-ssr-outlinks',
      detail: `/sites 首屏 SSR 的 /site/ 出链 = ${n}，期望 60（SSR 被踢成客户端渲染，或分页漏了）`,
      fix: '确认 page.tsx 在 RSC 内渲染 60 条标题内链',
    })
  } else {
    results.push({ ok: true, rule: 'page1-ssr-outlinks', detail: '/sites 首屏 60 条 /site/ 内链' })
  }

  return { applicable: true, note: '', runs: results, failures: results.filter((r) => !r.ok) }
}

function checkThresholds(m, probe, pagination) {
  const t = m.totals
  const fails = []
  if (t.contentAvgIndegree < 3.5) fails.push(`内容型页面平均入链 ${t.contentAvgIndegree} < 3.5`)
  if (t.reachablePct < 98) fails.push(`≤${MAX_DEPTH} 跳可达占比 ${t.reachablePct}% < 98%`)
  if (t.orphanCount > 40) fails.push(`孤岛数 ${t.orphanCount} > 40`)
  if (probe && probe.soft404Count > 0) fails.push(`软 404：${probe.soft404Count} 个随机 slug 返回 200`)
  if (pagination?.failures?.length) {
    for (const f of pagination.failures) fails.push(`[${f.rule}] ${f.detail}`)
  }
  return fails
}

// ---------- main ----------
const started = Date.now()
const universe = await loadUniverse()
console.log(`[universe] ${universe.size} 个库存页面（来自 ${FROM_DB}）`)
const graph = await crawl()
const metrics = computeMetrics(graph, universe)
const probe = PROBE ? await probeSoft404() : null
const pagination = ASSERT_PAGINATION ? await assertPagination(graph) : null

printReport(metrics, probe)

if (pagination) {
  console.log('\n=== /sites 分页断言 ===')
  if (!pagination.applicable) {
    console.log('  skipped：' + pagination.note)
  } else {
    for (const r of pagination.runs ?? []) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  [${r.rule}] ${r.detail}`)
      if (!r.ok && r.fix) console.log(`        fix: ${r.fix}`)
    }
  }
}

mkdirSync(dirname(OUT), { recursive: true })
const payload = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  config: { maxUrls: MAX_URLS, maxDepth: MAX_DEPTH, concurrency: CONCURRENCY },
  totals: metrics.totals,
  byType: metrics.byType,
  orphanSamples: metrics.orphans.slice(0, 200),
  orphans: metrics.orphans,
  depth: Object.fromEntries([...graph.depth.entries()].filter(([, v]) => v <= MAX_DEPTH)),
  indegree: Object.fromEntries([...metrics.indegree.entries()]),
  outdegree: Object.fromEntries([...metrics.outdegree.entries()]),
  titles: Object.fromEntries([...graph.title.entries()]),
  soft404: probe,
  paginationAsserts: pagination,
  tookMs: Date.now() - started,
}
writeFileSync(OUT, JSON.stringify(payload, null, 2))
console.log(`\n已写入 ${OUT}（${(JSON.stringify(payload).length / 1048576).toFixed(1)} MB，${Date.now() - started} ms）`)

if (CHECK) {
  const fails = checkThresholds(metrics, probe, pagination)
  if (fails.length) {
    console.error('\n[check] 未达阈值：')
    for (const f of fails) console.error('  - ' + f)
    process.exit(1)
  }
  console.log('\n[check] 全部阈值通过')
}
