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

import { isNotFound, type DegradedHandler } from './degrade'

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

export interface HubSiteRelation {
  id: string
  sourceSiteId: string
  targetSiteId?: string | null
  targetTitle: string
  targetUrl: string
  relationType: 'alternative' | 'complementary' | 'ecosystem' | 'part_of' | 'upstream' | 'mirror' | 'related'
  isFreeOrOpenSource?: boolean
  note?: string | null
  confidence?: number
  bidirectional?: boolean
  site?: HubSite | null
  sourceSite?: HubSite | null
}

export interface HubSiteRelationsPayload {
  siteId: string
  siteTitle: string
  outgoing: HubSiteRelation[]
  incoming: HubSiteRelation[]
  all: HubSiteRelation[]
  total: number
}

export interface HubSite {
  id: string
  url: string
  title: string
  titleEn?: string | null
  description: string | null
  descriptionEn?: string | null
  iconKey: string | null
  tags: string[]
  categoryId: string
  status: string
  visitCount?: number
  trendScore?: number
  health?: { ok: boolean; httpStatus: number | null; latencyMs: number | null; lastCheckedAt: number | null } | null
  source?: string | null
  facets?: Record<string, string[]>
  relations?: HubSiteRelation[]
  actions?: Array<{ id: string; label: string; urlTemplate: string; placeholder?: string; icon?: string }>
  liveMetrics?: { githubStars?: number; latestVersion?: string; openSource?: boolean; license?: string; latencyMs?: number }
  createdAt?: number
  updatedAt?: number
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
  /** 知识图谱对标方案与实体关联命中（如搜 "figma" 命中其开源平替 "Penpot"） */
  relationHits?: HubSiteRelation[]
}

export interface HubTag {
  id: string
  name: string
  slug: string
  count: number
}

async function getJson<T>(path: string, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(hubUrl(path), { signal, headers: { Accept: 'application/json', ...authHeaders(), ...(extraHeaders || {}) } })
  if (!res.ok) throw hubError(res.status, await hubServerMessage(res))
  const text = await res.text()
  return (text.trim() ? JSON.parse(text) : {}) as T
}

/**
 * 状态码 → 可读中文信息。
 *
 * 曾经这里只有 'hub ' + status（如 "hub 502"）——用户看到这串代号完全
 * 无法行动（502 是中枢没起、被防火墙挡了、还是崩了？）。现在的策略：
 *   1. 优先透出服务端的 error 字段——中枢的 400/409 都带中文可读原因；
 *   2. 服务端没给消息时，按状态码给出下一步行动指引。
 */
const HUB_STATUS_HINT: Record<number, string> = {
  400: '请求被中枢拒绝（参数或有效期策略不符）',
  401: '未授权：请先在「偏好设置」填入有效的 API Token',
  403: '权限不足：当前 Token 的 scope 不足以执行该操作',
  404: '中枢不存在该接口',
  409: '冲突：同名凭据已存在，或未吊销凭据已达上限',
  413: '请求体过大',
  429: '请求过于频繁，请稍后再试',
  502: 'NavHub 中枢不可用（连接失败）：请确认 API 服务已启动（默认 :8787）',
  503: 'NavHub 中枢暂时不可用，请稍后再试',
}

function hubError(status: number, serverMessage?: string): Error & { status: number } {
  const msg = serverMessage && serverMessage.trim()
    ? serverMessage.trim()
    : HUB_STATUS_HINT[status] ?? ('NavHub 中枢返回 HTTP ' + status)
  const err = new Error(msg) as Error & { status: number }
  err.status = status
  return err
}

/**
 * 从错误响应体提取服务端的可读消息。
 *
 * 中枢错误体统一为 { error: string, detail?: unknown }。提取顺序有意为之：
 *   1. 先看 zod detail——中枢 400 时 error 是笼统的「参数无效」，detail 首条
 *      才能拼出「参数无效（字段 name）：Required」这种可定位到字段的描述；
 *   2. detail 不存在或不可用时回退 error——409 撞名 / scopes 非法等自定义
 *      校验只带 error（中文可读原因），没有 detail，不受本顺序影响。
 */
async function hubServerMessage(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text()
    if (!text.trim()) return undefined
    const parsed = JSON.parse(text) as { error?: unknown; detail?: unknown }
    if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
      const first = parsed.detail[0] as { path?: unknown; message?: unknown }
      const where = Array.isArray(first.path) && first.path.length > 0 ? '（字段 ' + first.path.join('.') + '）' : ''
      if (typeof first.message === 'string') return '参数无效' + where + '：' + first.message
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
    return undefined
  } catch {
    return undefined
  }
}

async function sendJson<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders(), ...(extraHeaders || {}) }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(hubUrl(path), {
    method,
    signal,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw hubError(res.status, await hubServerMessage(res))
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

/**
 * 触发降级回调。
 *
 * 回调是 UI 层代码，可能自己抛错；但「已降级」这个事实不该因此改变，
 * 降级路径也绝不能把异常抛回调用方（见文件顶部降级原则）。
 */
function notifyDegraded(onDegraded: DegradedHandler | undefined, error: unknown): void {
  try {
    onDegraded?.(error)
  } catch {
    // 忽略：UI 回调的异常不该影响数据兜底
  }
}

/**
 * 降级包装：失败时回调 onDegraded 再返回兜底值。
 *
 * 为什么需要回调：`catch { return [] }` 让页面完全看不出「空」是真空还是中枢挂了。
 * 页面因此把故障渲染成「暂无数据／站点不存在」，用户被误导且没有重试入口
 * （真实缺陷，见 lib/degrade.ts 顶部注释）。回调把失败事实交回给调用方，
 * 由调用方决定展示降级提示；不传回调时行为与以前完全一致。
 */
async function degrade<T>(fallback: T, run: () => Promise<T>, onDegraded?: DegradedHandler): Promise<T> {
  try {
    return await run()
  } catch (error) {
    notifyDegraded(onDegraded, error)
    return fallback
  }
}

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
  void sendJson('/api/events' + query, 'POST', { kind: 'click', siteId }, undefined, anonHeaders(identity)).catch(() => {
    // 点击上报是 fire-and-forget：离线、被拦截、匿名模式都算正常，不该冒泡到页面逻辑
  })
}

/* ------------------------------ 标签 ------------------------------ */

export async function fetchTags(onDegraded?: DegradedHandler): Promise<HubTag[]> {
  return degrade([], () => getJson<HubTag[]>('/api/tags?minCount=1&limit=100'), onDegraded)
}

/* ------------------------------ 榜单 ------------------------------ */

export async function fetchTrending(limit = 20, onDegraded?: DegradedHandler): Promise<HubSite[]> {
  return degrade(
    [],
    async () => {
      const data = await getJson<{ hits: Array<{ site: HubSite }> }>('/api/rank/trending?limit=' + limit)
      return data.hits.map((h) => h.site).filter(Boolean)
    },
    onDegraded,
  )
}

export async function fetchNewSites(limit = 20, onDegraded?: DegradedHandler): Promise<HubSite[]> {
  return degrade(
    [],
    async () => {
      const data = await getJson<{ hits: Array<{ site: HubSite }> }>('/api/rank/new?limit=' + limit)
      return data.hits.map((h) => h.site).filter(Boolean)
    },
    onDegraded,
  )
}

/**
 * 单个站点详情（找不到时返回 null）。
 *
 * 404 是**正常业务结果**（站点确实被清理了），不触发 onDegraded ——
 * 页面据此显示「站点不存在」；而 5xx / 网络失败会触发回调，
 * 页面必须改口说「中枢不可用」，绝不能说「站点不存在」。
 */
export async function fetchSite(idOrUrl: string, onDegraded?: DegradedHandler): Promise<HubSite | null> {
  try {
    // id 或 URL 都走 /api/sites/:id —— URL 必须先 encodeURIComponent，
    // 否则斜杠会被切成多段导致 404（实测：编码后 200，不编码 404）
    return await getJson<HubSite>('/api/sites/' + encodeURIComponent(idOrUrl))
  } catch (error) {
    if (!isNotFound(error)) notifyDegraded(onDegraded, error)
    return null
  }
}

/** 相似站点（语义不可用时返回空数组） */
export async function fetchSimilar(siteId: string, limit = 6, onDegraded?: DegradedHandler): Promise<HubSite[]> {
  return degrade(
    [],
    async () => {
      const data = await getJson<{ hits: Array<{ site: HubSite }> }>(
        '/api/rank/similar/' + encodeURIComponent(siteId) + '?limit=' + limit,
      )
      return data.hits.map((h) => h.site).filter(Boolean)
    },
    onDegraded,
  )
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

/** 云端收藏接口的返回形状（listFavorites / 同步结果共用） */
export interface HubFavoritesPayload {
  items: HubFavorite[]
  folders: Array<{ id: string; name: string }>
}

export async function listFavorites(identity: string, onDegraded?: DegradedHandler): Promise<HubFavoritesPayload> {
  return degrade<HubFavoritesPayload>(
    { items: [], folders: [] },
    () =>
      getJson<HubFavoritesPayload>(
        '/api/favorites?anonId=' + encodeURIComponent(identity),
        undefined,
        anonHeaders(identity),
      ),
    onDegraded,
  )
}

export async function addFavorite(identity: string, siteId: string, onDegraded?: DegradedHandler): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson('/api/favorites?anonId=' + encodeURIComponent(identity), 'POST', { siteId }, undefined, anonHeaders(identity))
      return true
    },
    onDegraded,
  )
}

export async function removeFavorite(identity: string, siteId: string, onDegraded?: DegradedHandler): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson('/api/favorites/' + encodeURIComponent(siteId) + '?anonId=' + encodeURIComponent(identity), 'DELETE', undefined, undefined, anonHeaders(identity))
      return true
    },
    onDegraded,
  )
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

/* ------------------------------ 精选专题 ------------------------------ */

export interface HubCollection {
  id: string
  slug: string
  title: string
  description?: string | null
  kind: 'topic' | 'geo' | 'roadmap'
  coverUrl?: string | null
  icon?: string | null
  enabled: boolean
  sort: number
  siteCount?: number
  createdAt?: number
  updatedAt?: number
}

export async function fetchCollections(onDegraded?: DegradedHandler): Promise<HubCollection[]> {
  return degrade([], () => getJson<HubCollection[]>('/api/collections'), onDegraded)
}

/** 专题详情：404 = 专题确实不存在（不触发降级回调）；5xx / 网络失败触发 */
export async function fetchCollectionDetail(
  slug: string,
  onDegraded?: DegradedHandler,
): Promise<{ collection: HubCollection; sites: HubSite[] } | null> {
  try {
    return await getJson<{ collection: HubCollection; sites: HubSite[] }>('/api/collections/' + encodeURIComponent(slug))
  } catch (error) {
    if (!isNotFound(error)) notifyDegraded(onDegraded, error)
    return null
  }
}

/* ------------------------------ 实体关系与知识图谱 ------------------------------ */

export async function fetchSiteRelations(siteId: string): Promise<HubSiteRelationsPayload | null> {
  try {
    return await getJson<HubSiteRelationsPayload>('/api/sites/' + encodeURIComponent(siteId) + '/relations')
  } catch {
    return null
  }
}

