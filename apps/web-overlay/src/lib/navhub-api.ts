/**
 * NavHub 中枢 API 客户端（浏览器侧）。
 *
 * 与首页的 StorageAdapter 读路径分工：
 *   - 首页导航数据（navigation.json）仍走服务端 getFileContent（SSR，零延迟）
 *   - 搜索 / 收藏 / 标签 / 榜单 / 事件走这里的 REST 客户端（CSR，按需加载）
 *
 * 走**同源相对路径** /api/hub/*：由 next.config.js 的 rewrite 代理到中枢，
 * 因此没有 CORS 问题，也兼容 docker 内部主机名（api:8787 浏览器解析不了）。
 * 本地开发时需要 Web(3000) 与中枢(8787) 同时运行。
 *
 * 降级原则（与中枢一致）：任何网络失败都返回可用的空结果并标记 degraded，
 * 绝不把异常抛给 UI——导航站的首屏体验不能依赖中枢可用性。
 */

const BASE = '/api/hub'

/**
 * 归一化路径。
 *
 * BUG 教训（浏览器实测抓到的）：getJson 已拼接 BASE='/api/hub'，而调用方
 * 传入的路径又以 '/api' 开头，产生 '/api/hub/api/search' 这类双重前缀，
 * 中枢返回 404 —— 搜索结果/标签/榜单/详情页数据全部静默变空。
 * 这里统一兼容三种写法：'/api/search'、'/search'、'/api/hub/search'。
 */
function hubUrl(path: string): string {
  const normalized = path.replace(/^\/api(\/hub)?(?=\/)/, '')
  return BASE + normalized
}

/** 供测试与调试使用：暴露归一化规则 */
export { hubUrl }

export interface HubSite {
  id: string
  url: string
  title: string
  description: string | null
  iconKey: string | null
  tags: string[]
  categoryId: string
  status: string
  visitCount?: number
  trendScore?: number
  health?: { ok: boolean; httpStatus: number | null; latencyMs: number | null; lastCheckedAt: number | null } | null
  source?: string | null
  createdAt?: number
}

export interface HubSearchHit {
  siteId: string
  score: number
  contributions: Record<string, { rank: number; value: number }>
  site: HubSite | null
}

export interface HubSearchResult {
  hits: HubSearchHit[]
  channelsUsed: string[]
  semanticAvailable: boolean
  tookMs: number
  /** 本次分页偏移（0 = 第一页） */
  offset?: number
  /** 召回池内是否还有余量（不是全库总数）——据渲染「加载更多」 */
  hasMore?: boolean
  /** 客户端标记：true 表示请求失败走了降级 */
  degraded?: boolean
  /** 零结果时的兜底放宽级别（有结果时缺席）：filter=放宽了筛选，fuzzy=放宽了匹配 */
  fallback?: 'filter' | 'fuzzy'
  /** 零结果时的推荐搜索词（有结果时缺席） */
  suggestions?: string[]
  /** 零结果时的热门搜索词（有结果时缺席） */
  popular?: string[]
}

export interface HubTag {
  id: string
  name: string
  slug: string
  count: number
}

async function getJson<T>(path: string, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(hubUrl(path), { signal, headers: { Accept: 'application/json', ...authHeaders(), ...(extraHeaders || {}) } })
  if (!res.ok) throw hubError(res.status)
  return (await res.json()) as T
}

/**
 * 带状态码的错误：调用方需要按状态分支（如恢复回收站遇 409 = URL 冲突），
 * 只有 message 的 Error 无法判断。
 */
function hubError(status: number): Error & { status: number } {
  const err = new Error('hub ' + status) as Error & { status: number }
  err.status = status
  return err
}

async function sendJson<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(hubUrl(path), {
    method,
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders(), ...(extraHeaders || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw hubError(res.status)
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

/**
 * 终端用户云端身份 token（多端/多用户场景）。
 *
 * 中枢侧规则（见 apps/api/src/server.ts resolveIdentity）：请求带有效 Bearer
 * 时，收藏/金库/画像/历史强制绑定 "token:<id>" 身份并忽略自报 anonId；
 * 不带时回退匿名行为。token 存 localStorage 只存本机，永不进 URL。
 * 获取方式：管理员 POST /api/tokens 建只读 token，把明文填到「偏好设置」。
 *
 * 安全提示：
 * - localStorage 无过期机制：token 长期有效，泄漏即长期失守；建议服务端定期轮换、
 *   用户登出/换机时调用 setApiToken(null) 清除；隐私模式写失败时静默回退匿名。
 * - 切勿把 token 拼进 URL query（会进浏览器历史/服务端访问日志/Referer）。
 */
const API_TOKEN_KEY = 'navhub_api_token'

export function getApiToken(): string | null {
  try {
    return localStorage.getItem(API_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setApiToken(token: string | null): void {
  try {
    if (!token || !token.trim()) localStorage.removeItem(API_TOKEN_KEY)
    else localStorage.setItem(API_TOKEN_KEY, token.trim())
  } catch {
    // 隐私模式等不可写存储：静默保持匿名行为
  }
}

function authHeaders(): Record<string, string> {
  try {
    const t = typeof localStorage === 'undefined' ? null : localStorage.getItem(API_TOKEN_KEY)
    return t && t.trim() ? { Authorization: 'Bearer ' + t.trim() } : {}
  } catch {
    return {}
  }
}

/**
 * 匿名身份传递：header 优先、query 兼容。
 *
 * 风险说明：`?anonId=` 会残留在浏览器历史、代理/网关访问日志与 Referer 中，
 * 且易被分享 URL 意外扩散。这里改为优先走 `X-Navhub-Anon-Id` header，
 * query 仅为兼容旧版中枢保留（待中枢确认支持 header 后可移除 query 侧）。
 */
function anonHeaders(identity?: string): Record<string, string> {
  return identity ? { 'X-Navhub-Anon-Id': identity } : {}
}

/** 通用 GET / 发送（管理端等自定义端点用；失败抛错，由调用方决定降级） */
export { getJson as hubGet, sendJson as hubSend }

/* ------------------------------ 检索 ------------------------------ */

export interface SearchParams {
  q: string
  limit?: number
  /** 分页偏移（0 = 第一页） */
  offset?: number
  categoryId?: string
  tag?: string
  /** 身份标识（匿名 anonId 或登录 userId），用于个性化与历史 */
  identity?: string
}

export async function searchSites(params: SearchParams, signal?: AbortSignal): Promise<HubSearchResult> {
  const query = new URLSearchParams({ q: params.q })
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))
  if (params.categoryId) query.set('categoryId', params.categoryId)
  if (params.tag) query.set('tag', params.tag)
  // 兼容旧中枢：query 保留 anonId；新中枢优先读 X-Navhub-Anon-Id header（防日志泄漏）
  if (params.identity) query.set('anonId', params.identity)
  try {
    return await getJson<HubSearchResult>('/api/search?' + query.toString(), signal, anonHeaders(params.identity))
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    return { hits: [], channelsUsed: [], semanticAvailable: false, tookMs: 0, degraded: true }
  }
}

/** 点击上报（fire-and-forget，失败静默） */
export function reportClick(siteId: string, identity?: string): void {
  // header 优先 + query 兼容（见 anonHeaders 注释）
  const query = identity ? '?anonId=' + encodeURIComponent(identity) : ''
  void sendJson('/api/events' + query, 'POST', { kind: 'click', siteId }, undefined, anonHeaders(identity)).catch(() => undefined)
}

/* ------------------------------ 标签 ------------------------------ */

export async function fetchTags(): Promise<HubTag[]> {
  try {
    return await getJson<HubTag[]>('/api/tags?minCount=1&limit=100')
  } catch {
    return []
  }
}

/* ------------------------------ 榜单 ------------------------------ */

export async function fetchTrending(limit = 20): Promise<HubSite[]> {
  try {
    const data = await getJson<{ hits: Array<{ site: HubSite }> }>('/api/rank/trending?limit=' + limit)
    return data.hits.map((h) => h.site).filter(Boolean)
  } catch {
    return []
  }
}

export async function fetchNewSites(limit = 20): Promise<HubSite[]> {
  try {
    const data = await getJson<{ hits: Array<{ site: HubSite }> }>('/api/rank/new?limit=' + limit)
    return data.hits.map((h) => h.site).filter(Boolean)
  } catch {
    return []
  }
}

/* ------------------------------ 精选专题 ------------------------------ */

export interface HubCollection {
  id: string
  slug: string
  title: string
  description?: string | null
  kind: 'topic' | 'geo' | 'roadmap'
  icon?: string | null
  sort: number
  enabled: boolean
}

export async function fetchCollections(): Promise<HubCollection[]> {
  try {
    return await getJson<HubCollection[]>('/api/collections')
  } catch {
    return []
  }
}

/** 专题详情（含站点列表；不存在时返回 null） */
export async function fetchCollectionDetail(slug: string): Promise<{ collection: HubCollection; sites: HubSite[] } | null> {
  try {
    return await getJson<{ collection: HubCollection; sites: HubSite[] }>('/api/collections/' + encodeURIComponent(slug))
  } catch {
    return null
  }
}

/** 单个站点详情（找不到时返回 null） */
export async function fetchSite(idOrUrl: string): Promise<HubSite | null> {
  try {
    // id 或 URL 都走 /api/sites/:id —— URL 必须先 encodeURIComponent，
    // 否则斜杠会被切成多段导致 404（实测：编码后 200，不编码 404）
    return await getJson<HubSite>('/api/sites/' + encodeURIComponent(idOrUrl))
  } catch {
    return null
  }
}

/** 相似站点（语义不可用时返回空数组） */
export async function fetchSimilar(siteId: string, limit = 6): Promise<HubSite[]> {
  try {
    const data = await getJson<{ hits: Array<{ site: HubSite }> }>(
      '/api/rank/similar/' + encodeURIComponent(siteId) + '?limit=' + limit,
    )
    return data.hits.map((h) => h.site).filter(Boolean)
  } catch {
    return []
  }
}

/* ------------------------------ 收藏夹 ------------------------------ */

export interface HubFavorite {
  id: string
  siteId: string
  folderId: string | null
  note: string | null
  createdAt: number
  site: HubSite | null
}

export async function listFavorites(identity: string): Promise<{ items: HubFavorite[]; folders: Array<{ id: string; name: string }> }> {
  try {
    return await getJson('/api/favorites?anonId=' + encodeURIComponent(identity), undefined, anonHeaders(identity))
  } catch {
    return { items: [], folders: [] }
  }
}

export async function addFavorite(identity: string, siteId: string): Promise<boolean> {
  try {
    await sendJson('/api/favorites?anonId=' + encodeURIComponent(identity), 'POST', { siteId }, undefined, anonHeaders(identity))
    return true
  } catch {
    return false
  }
}

export async function removeFavorite(identity: string, siteId: string): Promise<boolean> {
  try {
    await sendJson('/api/favorites/' + encodeURIComponent(siteId) + '?anonId=' + encodeURIComponent(identity), 'DELETE', undefined, undefined, anonHeaders(identity))
    return true
  } catch {
    return false
  }
}

/* ------------------------------ 搜索历史 ------------------------------ */

export async function fetchSearchHistory(identity: string, limit = 8): Promise<string[]> {
  try {
    const data = await getJson<{ items: Array<{ query: string }> }>(
      '/api/search-history?anonId=' + encodeURIComponent(identity) + '&limit=' + limit,
      undefined,
      anonHeaders(identity),
    )
    return data.items.map((i) => i.query)
  } catch {
    return []
  }
}

/* ------------------------ E2EE 零知识云端金库 ------------------------ */

export interface CloudVaultData {
  userId: string
  payload: string
  version: number
  updatedAt: number
}

export async function fetchCloudVault(identity: string): Promise<CloudVaultData | null> {
  try {
    const data = await getJson<{ ok: boolean; vault: CloudVaultData | null }>(
      '/api/vault/sync?anonId=' + encodeURIComponent(identity),
      undefined,
      anonHeaders(identity),
    )
    return data.vault ?? null
  } catch {
    return null
  }
}

export async function saveCloudVault(identity: string, payload: string): Promise<{ ok: boolean; version?: number; updatedAt?: number }> {
  try {
    return await sendJson('/api/vault/sync?anonId=' + encodeURIComponent(identity), 'PUT', { payload }, undefined, anonHeaders(identity))
  } catch {
    return { ok: false }
  }
}

export async function deleteCloudVault(identity: string): Promise<boolean> {
  try {
    await sendJson('/api/vault/sync?anonId=' + encodeURIComponent(identity), 'DELETE', undefined, undefined, anonHeaders(identity))
    return true
  } catch {
    return false
  }
}

