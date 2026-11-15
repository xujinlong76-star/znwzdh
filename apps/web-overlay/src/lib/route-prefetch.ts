/**
 * 站内路由预取（Batch 3 第 8 项 P1 / A1）——纯函数模块。
 *
 * 与 `lib/prefetch.ts` 的轨迹数学分开：这里只放「该不该预取、按什么顺序预取」
 * 的纯逻辑，可单测；真正的 `router.prefetch` 调用只发生在
 * `components/predictive-prefetch-provider.tsx`（站内链接 / 空闲）与
 * `components/video-player-page.tsx`（视频下一集）里。
 *
 * 契约（设计文档第 8 项 A1，测试钉死）：
 *   - 白名单：只允许 `/`、`/hot`、`/tags`、`/tags/[slug]`、`/favorites`、
 *     `/scenes`、`/scenes/[id]`（场景落地页，`app/scenes/[id]/page.tsx`
 *     文件头自称「场景落地页」）、`/videos`、`/videos/player?id=…`、
 *     `/site/[id]`、`/collections/[slug]`、`/offline`。不在名单上的（包括
 *     `/search`、`/videos/v/[id]`、`/pub/[slug]`）一律不预取。
 *   - 黑名单优先于白名单：`/admin/*`、`/api/*`、`/auth/*`、`/logout`、
 *     `/delete`、`/destroy`、任何带写操作语义的路径段（edit/create/…）。
 *   - 只发同源 RSC：只接受站内相对路径，或与当前 origin 一致的绝对 URL；
 *     预取候选不许含搜索关键词（`/videos/player` 只认 `id` / `t` 两个参数，
 *     其余白名单路由不带任何查询串）。
 *   - 会话预算：每会话站内预取 ≤5 条、每路由只 1 次；已预取集合放内存 Set，
 *     不持久化（刷新即清零）。`saveData` / 2G / 3G / 离线时 A1 全停。
 *   - 候选排序：视频下一集 > 用户明确意图 > 最近访问 top 3 > 收藏 top >
 *     场景切换后的落地页 1 条。
 *   - 冬眠：冬眠条目不得进入预取候选；「收藏 top」只取未冬眠、未待读分流
 *     （permanent）的条目。打开信号复用 `resurface.ts` 的
 *     `resolveLastOpened` / `daysSinceOpen` + `offline-recent` 的 50 条，
 *     这里不另起一套「上次打开」算法。
 */

import {
  isHibernating,
  manualHibernatedSet,
  type HibernatableFavoriteLike,
  type HibernationSettings,
  type ManualHibernatedItem,
} from './favorites-hibernation'
import { resolveTriageStatus } from './favorites-triage'
import {
  daysSinceOpen,
  latestVisitsById,
  resolveLastOpened,
  type ResurfaceVisitLike,
} from './resurface'
import type { RecentVisit } from './offline-recent'

/** 每会话站内预取上限（条）。 */
export const MAX_SESSION_PREFETCHES = 5
/** 最近访问空闲预取取前几条。 */
export const RECENT_PREFETCH_TOP_N = 3
/** 收藏 top 空闲预取取前几条。 */
export const FAVORITE_TOP_PREFETCH_N = 3
/** 下一集 high / normal 的进度分界：播过 75% 才算「快看完了」。 */
export const NEXT_VIDEO_PROGRESS_HIGH = 0.75
/** 悬停 / 轨迹指向站内卡片后，等这么久才预取（防扫过即烧流量）。 */
export const HOVER_PREFETCH_DELAY_MS = 150
/** 无 requestIdleCallback 时的空闲预取兜底延迟。 */
export const IDLE_PREFETCH_FALLBACK_MS = 1500

export type PrefetchPriority = 'high' | 'normal' | 'low'

export type PrefetchCandidateSource =
  | 'next-video'
  | 'user-intent'
  | 'recent'
  | 'favorite-top'
  | 'scene-landing'

export interface PrefetchCandidate {
  href: string
  priority: PrefetchPriority
  source: PrefetchCandidateSource
  /**
   * 附带的已加载元数据（如下一集的标题、收藏的站名）：预取只发路由的 RSC，
   * 元数据来自调用方手里已有的数据，不另发请求、不预取 iframe、不预取视频流。
   */
  meta?: { id: string; title: string }
}

/* ------------------------------ 白名单 ------------------------------ */

/** 不带参数的白名单精确路由。 */
const EXACT_ROUTES = new Set([
  '/',
  '/hot',
  '/tags',
  '/favorites',
  '/scenes',
  '/videos',
  '/offline',
])

/** 单段动态路由：/tags/[slug]、/site/[id]、/collections/[slug]、/scenes/[id]。 */
const SINGLE_SEGMENT_ROUTES: Array<{ prefix: string }> = [
  { prefix: '/tags/' },
  { prefix: '/site/' },
  { prefix: '/collections/' },
  { prefix: '/scenes/' },
]

/* ------------------------------ 黑名单 ------------------------------ */

/** 黑名单前缀段：命中即禁（大小写不敏感，防 /Admin 绕过）。 */
const BLOCKED_PREFIXES = ['/admin', '/api', '/auth']

/** 黑名单精确路径。 */
const BLOCKED_EXACT = new Set(['/logout', '/delete', '/destroy'])

/**
 * 写操作语义的路径段：出现在任何一段里即禁。
 * 覆盖「删除 / 销毁 / 移除 / 登出 / 编辑 / 新建 / 更新 / 发布」等动作——
 * 预取绝不能替用户触发一次写操作（哪怕只是 GET 形态的写接口）。
 */
const WRITE_SEGMENTS = new Set([
  'delete',
  'destroy',
  'remove',
  'logout',
  'log-out',
  'signout',
  'sign-out',
  'edit',
  'create',
  'update',
  'publish',
  'unsubscribe',
  'deactivate',
  'reset',
])

/** 搜索关键词类查询参数名：出现在任何候选里即禁。 */
const SEARCH_QUERY_PARAMS = new Set(['q', 'query', 'keyword', 'keywords', 'search', 's'])

/** `/videos/player` 上唯一允许的查询参数（id 定位哪一集，t 定位秒数）。 */
const PLAYER_QUERY_PARAMS = new Set(['id', 't'])

function splitHref(href: string): { pathname: string; search: string } {
  const hashAt = href.indexOf('#')
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href
  const qAt = noHash.indexOf('?')
  if (qAt < 0) return { pathname: noHash, search: '' }
  return { pathname: noHash.slice(0, qAt), search: noHash.slice(qAt + 1) }
}

/** 归一化路由：去尾斜杠（根路径除外）、去 hash；查询串原样保留。 */
export function normalizeRouteHref(href: string): string {
  const { pathname, search } = splitHref(href)
  let path = pathname
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return search ? `${path}?${search}` : path
}

function hasBlockedSegment(pathname: string): boolean {
  const lower = pathname.toLowerCase()
  if (BLOCKED_EXACT.has(lower)) return true
  for (const prefix of BLOCKED_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) return true
  }
  for (const seg of lower.split('/')) {
    if (seg !== '' && WRITE_SEGMENTS.has(seg)) return true
  }
  return false
}

function hasSearchQueryParam(search: string): boolean {
  if (!search) return false
  for (const part of search.split('&')) {
    const key = part.split('=')[0] ?? ''
    try {
      if (SEARCH_QUERY_PARAMS.has(decodeURIComponent(key).toLowerCase())) return true
    } catch {
      if (SEARCH_QUERY_PARAMS.has(key.toLowerCase())) return true
    }
  }
  return false
}

/**
 * 这条站内 href 是否允许预取。黑名单优先于白名单；查询串里带搜索关键词即禁。
 * 只认相对路径（`/…`，不含 `//`）；绝对 URL 先过 `toInternalRouteHref`。
 */
export function isPrefetchableHref(href: string): boolean {
  if (typeof href !== 'string' || href === '' || !href.startsWith('/') || href.startsWith('//')) {
    return false
  }
  // 先归一化（去尾斜杠、去 hash），再按白名单 / 黑名单判定。
  const { pathname, search } = splitHref(normalizeRouteHref(href))
  if (pathname === '' || pathname.includes('\\')) return false
  // 黑名单先行：/site/delete 这类「白名单形、写操作实」的路径也得拦住。
  if (hasBlockedSegment(pathname)) return false
  if (hasSearchQueryParam(search)) return false

  if (EXACT_ROUTES.has(pathname)) {
    // 精确路由不带任何查询串（/videos?c=… 这类过滤态不预取）。
    return search === ''
  }
  for (const { prefix } of SINGLE_SEGMENT_ROUTES) {
    if (pathname.startsWith(prefix)) {
      const rest = pathname.slice(prefix.length)
      // 单段 slug：非空、不含斜杠；不带查询串。
      return rest !== '' && !rest.includes('/') && search === ''
    }
  }
  if (pathname === '/videos/player') {
    if (!search) return false
    const params = new URLSearchParams(search)
    const id = params.get('id')
    if (!id) return false
    for (const key of params.keys()) {
      if (!PLAYER_QUERY_PARAMS.has(key)) return false
    }
    return true
  }
  return false
}

/**
 * 任意 href（相对或绝对）转站内路由：相对路径原样取；绝对 URL 只有与当前
 * origin 一致才取 pathname + search（外站链接一律返回 null，不预取）。
 */
export function toInternalRouteHref(rawHref: string, origin?: string): string | null {
  if (typeof rawHref !== 'string' || rawHref === '') return null
  if (rawHref.startsWith('/')) {
    if (rawHref.startsWith('//')) return null
    return rawHref
  }
  if (!origin) return null
  try {
    const url = new URL(rawHref)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.origin !== origin) return null
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}

/* ------------------------------ 网络门控 ------------------------------ */

export interface PrefetchConnectionLike {
  saveData?: boolean
  effectiveType?: string
}

/**
 * A1 站内 RSC 预取的网络门：saveData / slow-2g / 2g / 3g / 离线时全停。
 * 注意与 A0 的 `determinePrefetchStrategy` 不同：3g 时 A0 还允许 dns-prefetch，
 * A1 的 RSC 预取在 3g 也停（RSC 比 DNS 贵得多）。
 * connection 缺失（API 不支持）时按网络良好处理。
 */
export function isRoutePrefetchNetworkAllowed(
  connection?: PrefetchConnectionLike | null,
  online = true,
): boolean {
  if (!online) return false
  if (!connection) return true
  if (connection.saveData) return false
  const t = connection.effectiveType
  if (t === 'slow-2g' || t === '2g' || t === '3g') return false
  return true
}

/* ------------------------------ 会话预算 ------------------------------ */

export interface RoutePrefetchSession {
  /** 已预取的路由（归一化后），内存 Set，不持久化。 */
  claimed: Set<string>
  maxPrefetches: number
}

export function createRoutePrefetchSession(
  maxPrefetches: number = MAX_SESSION_PREFETCHES,
): RoutePrefetchSession {
  return { claimed: new Set<string>(), maxPrefetches: Math.max(0, maxPrefetches) }
}

/**
 * SPA 会话内共享的预取会话（内存单例，刷新即清零）：Provider 与播放器页
 * 共用它，会话 ≤5 条的预算才是全局的，而不是每处各 5 条。
 * 测试用 `createRoutePrefetchSession()` 拿隔离会话，别碰这个单例。
 */
let sharedSession: RoutePrefetchSession | null = null

export function getSharedRoutePrefetchSession(): RoutePrefetchSession {
  if (!sharedSession) sharedSession = createRoutePrefetchSession()
  return sharedSession
}

/**
 * 认领一次预取：白名单内、未认领过、未超会话上限、且不是当前页本身时
 * 才返回 true 并记入集合；其余一律 false（调用方不许发 prefetch）。
 */
export function tryClaimRoutePrefetch(
  session: RoutePrefetchSession,
  href: string,
  currentHref?: string,
): boolean {
  if (!session || !href) return false
  const normalized = normalizeRouteHref(href)
  if (!isPrefetchableHref(normalized)) return false
  if (typeof currentHref === 'string' && currentHref !== '') {
    if (normalizeRouteHref(currentHref) === normalized) return false
  }
  if (session.claimed.has(normalized)) return false
  if (session.claimed.size >= session.maxPrefetches) return false
  session.claimed.add(normalized)
  return true
}

/* ------------------------------ 候选排序 ------------------------------ */

const SOURCE_RANK: Record<PrefetchCandidateSource, number> = {
  'next-video': 0,
  'user-intent': 1,
  recent: 2,
  'favorite-top': 3,
  'scene-landing': 4,
}

const PRIORITY_RANK: Record<PrefetchPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
}

/**
 * 候选排序：先按来源（视频下一集 > 用户明确意图 > 最近访问 top 3 >
 * 收藏 top > 场景落地页），同源内再按优先级 high > normal > low；
 * 全相同时保持输入顺序（Array.sort 稳定）。
 */
export function sortPrefetchCandidates(candidates: PrefetchCandidate[]): PrefetchCandidate[] {
  return [...candidates].sort((a, b) => {
    const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    if (bySource !== 0) return bySource
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  })
}

/* ------------------------------ 视频下一集 ------------------------------ */

export interface NextVideoLike {
  id: string
  title: string
  videoConfig?: { durationSec?: number | null } | null
}

/** 播放进度比：时长未知 / 非法时返回 NaN（调用方据此判定「到不了 75%」）。 */
export function progressRatio(currentTimeSec: number, durationSec?: number | null): number {
  if (!durationSec || durationSec <= 0 || !Number.isFinite(currentTimeSec) || currentTimeSec < 0) {
    return Number.NaN
  }
  return currentTimeSec / durationSec
}

/** 下一集优先级：进度 >75% 为 high（快看完了，最值得预取），否则 normal。 */
export function nextVideoPriority(ratio: number): PrefetchPriority {
  if (!Number.isFinite(ratio)) return 'normal'
  return ratio > NEXT_VIDEO_PROGRESS_HIGH ? 'high' : 'normal'
}

/**
 * 下一集候选（最多 2 条）：下一集 + 再下一集（low、最多 1 条）。
 * 只含路由与元数据——不含 iframe 地址、不含视频流；「预取」本身由调用方
 * 在进度 >75% 时才真正发出（进度 <75% 且无悬停时不预取，见验收标准）。
 */
export function buildNextVideoCandidates(
  videos: NextVideoLike[],
  currentIndex: number,
  ratio: number,
): PrefetchCandidate[] {
  if (!Array.isArray(videos) || currentIndex < 0 || currentIndex >= videos.length) return []
  const out: PrefetchCandidate[] = []
  const next = videos[currentIndex + 1]
  if (next && typeof next.id === 'string' && next.id !== '') {
    out.push({
      href: `/videos/player?id=${encodeURIComponent(next.id)}`,
      priority: nextVideoPriority(ratio),
      source: 'next-video',
      meta: { id: next.id, title: next.title },
    })
  }
  const nextNext = videos[currentIndex + 2]
  if (nextNext && typeof nextNext.id === 'string' && nextNext.id !== '') {
    out.push({
      href: `/videos/player?id=${encodeURIComponent(nextNext.id)}`,
      priority: 'low',
      source: 'next-video',
      meta: { id: nextNext.id, title: nextNext.title },
    })
  }
  return out
}

/* ------------------------------ 最近访问 ------------------------------ */

/**
 * 最近访问 top 3（normal）：只在用户回到首页 / `/offline` 时才由调用方
 * 在空闲时预取；其它页面不预取最近访问（用户正在别处忙，别烧流量）。
 * 只取站内白名单路由（外站链接、搜索页一律滤掉）；当前页本身不预取。
 */
export function buildRecentCandidates(
  visits: RecentVisit[],
  currentPath: string,
  limit: number = RECENT_PREFETCH_TOP_N,
  origin?: string,
): PrefetchCandidate[] {
  if (currentPath !== '/' && currentPath !== '/offline') return []
  const cap = Math.max(0, limit)
  if (cap === 0) return []
  const out: PrefetchCandidate[] = []
  const seen = new Set<string>()
  const sorted = [...(visits ?? [])].sort((a, b) => b.visitedAt - a.visitedAt)
  for (const visit of sorted) {
    if (out.length >= cap) break
    if (!visit || typeof visit.href !== 'string') continue
    const internal = toInternalRouteHref(visit.href, origin)
    if (!internal) continue
    const normalized = normalizeRouteHref(internal)
    if (seen.has(normalized)) continue
    // 当前页本身不预取（首页 / /offline 回到自己没有意义）。
    const { pathname } = splitHref(normalized)
    if (pathname === currentPath && normalized === currentPath) continue
    if (!isPrefetchableHref(normalized)) continue
    seen.add(normalized)
    out.push({
      href: normalized,
      priority: 'normal',
      source: 'recent',
      meta: { id: visit.id, title: visit.title },
    })
  }
  return out
}

/* ------------------------------ 收藏 top ------------------------------ */

/**
 * 收藏 top（normal）：只取未冬眠、未待读分流（permanent）的条目，映射到
 * 站内详情页 `/site/[id]`——收藏本体存的是外站链接，外站链接不预取。
 * 排序复用 resurface 的打开信号：最近记录到打开的排前面，从未记录到打开
 * 的排最后（不声称用户真的没看过，只按本机记录排）。
 */
export function buildFavoriteTopCandidates(
  favorites: HibernatableFavoriteLike[],
  visits: ResurfaceVisitLike[],
  settings: HibernationSettings,
  manual: ManualHibernatedItem[],
  now: number,
  limit: number = FAVORITE_TOP_PREFETCH_N,
): PrefetchCandidate[] {
  const cap = Math.max(0, limit)
  if (cap === 0) return []
  const visitsById = latestVisitsById(visits ?? [])
  const manualSet = manualHibernatedSet(manual ?? [])
  const seen = new Set<string>()
  const eligible: HibernatableFavoriteLike[] = []
  for (const fav of favorites ?? []) {
    if (!fav || typeof fav.siteId !== 'string' || fav.siteId === '') continue
    if (seen.has(fav.siteId)) continue
    seen.add(fav.siteId)
    // 冬眠条目不得进入预取候选；待读箱 / 已读（非 permanent）也不进。
    if (isHibernating(fav, visitsById, settings, manualSet, now)) continue
    if (resolveTriageStatus(fav, now) !== 'permanent') continue
    eligible.push(fav)
  }
  eligible.sort((a, b) => {
    const lastA = resolveLastOpened(a, visitsById, now)
    const lastB = resolveLastOpened(b, visitsById, now)
    const rankA = lastA ?? Number.NEGATIVE_INFINITY
    const rankB = lastB ?? Number.NEGATIVE_INFINITY
    if (rankB !== rankA) return rankB - rankA
    // 同为「从未记录到打开」时用天数兜底：收藏越久越靠后（daysSinceOpen 越大越靠后）。
    const daysA = daysSinceOpen(a, visitsById, now)
    const daysB = daysSinceOpen(b, visitsById, now)
    if (daysA !== daysB) return daysA - daysB
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    return a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0
  })
  return eligible.slice(0, cap).map((fav) => ({
    href: `/site/${encodeURIComponent(fav.siteId)}`,
    priority: 'normal' as PrefetchPriority,
    source: 'favorite-top' as PrefetchCandidateSource,
    meta: { id: fav.siteId, title: fav.title },
  }))
}

/* ------------------------------ 场景落地页 ------------------------------ */

/**
 * 场景切换成功事件（Batch 3 第 8 项 P2）：`scene-switcher.tsx` 的
 * performSceneSwitch 在切换成功后 dispatch 该事件（detail: { sceneId }），
 * PredictivePrefetchProvider 接住后空闲预取 1 条 buildSceneLandingCandidate。
 * 事件名放这里（纯函数模块），避免 Provider 直接 import 场景切换组件
 * （会把下拉菜单等重依赖拖进全局首屏）。
 */
export const SCENE_SWITCHED_EVENT = 'navhub:scene-switched'

/**
 * 场景切换后的落地页（low，1 条）：只预取目标场景的首页
 * `/scenes/[id]`，绝不预取场景内全部站点。
 * 场景切换的接线点在 `scene-switcher.tsx`（本文件不管事件，只给纯构造）；
 * 调用方拿到切换成功的 sceneId 后，在空闲时把这一条放进候选池即可。
 */
export function buildSceneLandingCandidate(sceneId: string): PrefetchCandidate | null {
  if (typeof sceneId !== 'string' || sceneId.trim() === '') return null
  const href = `/scenes/${encodeURIComponent(sceneId.trim())}`
  if (!isPrefetchableHref(href)) return null
  return { href, priority: 'low', source: 'scene-landing' }
}

/* ------------------------------ 空闲拾取 ------------------------------ */

/**
 * 空闲时拾取 1 条最高优先候选并认领：网络门控不过时直接返回 null，
 * 不认领、不烧预算；认领成功的调用方随后发一次 `router.prefetch`。
 */
export function pickIdlePrefetchCandidate(
  candidates: PrefetchCandidate[],
  session: RoutePrefetchSession,
  opts?: { networkAllowed?: boolean; currentHref?: string },
): PrefetchCandidate | null {
  if (opts?.networkAllowed === false) return null
  for (const candidate of sortPrefetchCandidates(candidates ?? [])) {
    if (tryClaimRoutePrefetch(session, candidate.href, opts?.currentHref)) return candidate
  }
  return null
}
