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
import { getIdentity } from './identity'
import type { PluginDiffResult, PluginManifest, PluginKind } from './plugins/plugin-manifest'
// 响应形状来自中枢契约的生成物（scripts/generate-rest-contract-types.mjs）：
// 手抄一份接口曾经是最大的漂移面——中枢改了字段，前端照旧编译通过、运行时 undefined。
// 这里只 import 类型，生成文件是自包含的，不会把 @navhub/core 拖进浏览器包。
import type {
  CategoryCountsResponse,
  CategoryListResponse,
  InstalledPluginsResponse,
  PluginTapsResponse,
  PublicPluginTapsResponse,
  RankNewResponse,
  RankTrendingResponse,
  SearchHistoryPageResponse,
  SearchResponse,
  SitePayload,
  TagListResponse,
} from './rest-contracts.generated'

const BASE = '/api/hub'

/**
 * 读请求超时：中枢「TCP 连上但不回包」时，没有超时的 fetch 会永远挂起，
 * 按钮一直转圈，用户既看不到错误也没有重试入口。30s 与 Next 代理侧默认超时
 * 对齐；写请求（尤其是 AI 生成）可能合法地跑更久，因此只约束 GET。
 */
const READ_TIMEOUT_MS = 30_000

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

/**
 * 站点在契约里的形状。
 * 生成物里 SitePayload 是独立组件（列表/搜索/榜单/详情共用同一份 schema），
 * 直接引用它，不再借道某个具体响应的内联展开。
 */
type ContractSite = SitePayload

/**
 * UI 展示形态。
 *
 * 字段类型不手抄：核心字段逐个从契约生成物取（`ContractSite['x']`），契约改名、
 * 改类型或放宽可空性，这里会直接编译失败——而手抄接口只会静默漂移成运行时
 * undefined。展示层**额外**的字段（relations/actions/liveMetrics）由 UI 自己
 * 补齐，服务端默认不返回，所以单独列出。
 */
export interface HubSite {
  id: ContractSite['id']
  url: ContractSite['url']
  title: ContractSite['title']
  titleEn?: ContractSite['titleEn']
  // 契约里 description/iconKey 是可选可空的：本地快照与老版本中枢都真的不带，
  // UI 必须按「可能缺失」渲染，所以这里跟随契约而不是声称恒有值。
  description?: ContractSite['description']
  descriptionEn?: ContractSite['descriptionEn']
  iconKey?: ContractSite['iconKey']
  tags: ContractSite['tags']
  categoryId: ContractSite['categoryId']
  status: ContractSite['status']
  visitCount?: ContractSite['visitCount']
  trendScore?: ContractSite['trendScore']
  health?: ContractSite['health']
  source?: ContractSite['source']
  facets?: ContractSite['facets']
  relations?: HubSiteRelation[]
  actions?: Array<{ id: string; label: string; urlTemplate: string; placeholder?: string; icon?: string }>
  liveMetrics?: { githubStars?: number; latestVersion?: string; openSource?: boolean; license?: string; latencyMs?: number }
  createdAt?: ContractSite['createdAt']
  updatedAt?: ContractSite['updatedAt']
}

export interface HubSearchHit {
  siteId: string
  score: number
  contributions: Record<string, { rank: number; value: number }>
  site: HubSite | null
}

/**
 * 检索响应（前端视图）。
 *
 * 标量字段直接继承中枢契约（Pick 出来的形状与 /api/openapi.json 同源），
 * 只把命中形态换成本地的 HubSearchHit：契约里 hit.site 是完整的 SitePayload，
 * 而 UI 用的是更宽的展示形态 HubSite（多了 relations/actions/liveMetrics，
 * health 允许整块缺席）。这层差异是展示需要，不是契约漂移——
 * 契约一旦改名/改类型，Pick 这里的字段会立刻编译失败。
 *
 * 分页语义：offset = 本次分页偏移（0 = 第一页）；hasMore = 召回池内还有余量
 * （不是全库总数），据它渲染「加载更多」。fallback 只在零结果放宽时出现。
 */
export interface HubSearchResult
  extends Pick<
    SearchResponse,
    | 'channelsUsed'
    | 'semanticAvailable'
    | 'tookMs'
    | 'offset'
    | 'hasMore'
    | 'fallback'
    | 'suggestions'
    | 'popular'
    | 'inferredFacets'
    | 'inferredTag'
    | 'inferredCategory'
    | 'excludedTerms'
    | 'didYouMean'
    | 'queryExpansion'
  > {
  hits: HubSearchHit[]
  /** 客户端标记：true 表示请求失败走了降级 */
  degraded?: boolean
  /** 知识图谱对标方案与实体关联命中（如搜 "figma" 命中其开源平替 "Penpot"） */
  relationHits?: HubSiteRelation[]
}

export interface HubTag {
  id: string
  name: string
  slug: string
  count: number
}

function readSignal(signal?: AbortSignal): AbortSignal | undefined {
  if (signal) return signal
  // 老浏览器没有 AbortSignal.timeout 时不强行制造超时（保持旧行为，而不是直接抛错）
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(READ_TIMEOUT_MS)
    : undefined
}

async function getJson<T>(path: string, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(hubUrl(path), {
    signal: readSignal(signal),
    headers: { Accept: 'application/json', ...authHeaders(), ...(extraHeaders || {}) },
  })
  if (!res.ok) {
    const detail = await hubServerMessage(res)
    throw hubError(res.status, detail.message, detail.payload)
  }
  const text = await res.text()
  return (text.trim() ? JSON.parse(text) : {}) as T
}

/**
 * 状态码 → 可读中文信息。
 *
 * 曾经这里只有 'hub ' + status（如 "hub 502"）——用户看到这串代号完全
 * 无法行动（502 是中枢没起、被防火墙挡了、还是崩了？）。现在的策略：
 *   1. 优先透出服务端的 `message`（人话），没有才回退 `error`（机器码）；
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
  502: '山羊胡中枢不可用（连接失败）：请确认 API 服务已启动（默认 :8787）',
  503: '山羊胡中枢暂时不可用，请稍后再试',
  // 504 由 /api/hub 代理自己发出（等上游到上限主动掐断）：说「慢」而不是说「坏」
  504: '山羊胡中枢响应超时（代理已等到上限主动中断，这次请求确实算得久，可直接重试）',
}

function hubError(
  status: number,
  serverMessage?: string,
  payload?: Record<string, unknown>,
): Error & { status: number; payload?: Record<string, unknown> } {
  const msg = serverMessage && serverMessage.trim()
    ? serverMessage.trim()
    : HUB_STATUS_HINT[status] ?? ('山羊胡中枢返回 HTTP ' + status)
  const err = new Error(msg) as Error & { status: number; payload?: Record<string, unknown> }
  err.status = status
  /**
   * 保留响应体原文。
   *
   * 存在的理由：中枢有些错误**刻意只回类别、不回原始报错**——例如备份恢复的
   * 409 带 `reason: "duplicate_key"`（原始报错里可能含重复的 URL，属用户数据）。
   * 旧实现丢掉了 body，于是调用方只能拿到一句笼统文案，那个 reason 等于白设计。
   * 挂在这里不影响既有调用方（多了一个可选属性），也不改变错误消息本身。
   */
  if (payload) err.payload = payload
  return err
}

/**
 * 从错误响应体提取服务端的可读消息**与原始载荷**。
 *
 * 中枢错误体统一为 { error: string, detail?: unknown }，另有若干端点附带结构化
 * 字段（如备份恢复 409 的 `reason`）。提取顺序有意为之：
 *   1. 先看 zod detail——中枢 400 时 error 是笼统的「参数无效」，detail 首条
 *      才能拼出「参数无效（字段 name）：Required」这种可定位到字段的描述；
 *   2. detail 不存在或不可用时回退 error——409 撞名 / scopes 非法等自定义
 *      校验只带 error（中文可读原因），没有 detail，不受本顺序影响。
 *
 * 返回值同时带 payload：调用方需要结构化字段时不必再读一次 body（body 只能读一次）。
 */
interface HubServerErrorDetail {
  message?: string
  payload?: Record<string, unknown>
}

async function hubServerMessage(res: Response): Promise<HubServerErrorDetail> {
  try {
    const text = await res.text()
    if (!text.trim()) return {}
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown; [key: string]: unknown }
    const payload = parsed as Record<string, unknown>
    if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
      const first = parsed.detail[0] as { path?: unknown; message?: unknown }
      const where = Array.isArray(first.path) && first.path.length > 0 ? '（字段 ' + first.path.join('.') + '）' : ''
      if (typeof first.message === 'string') {
        return { message: '参数无效' + where + '：' + first.message, payload }
      }
    }
    /**
     * 优先 `message`（人话）再 `error`（机器码）。
     *
     * 中枢的错误体约定是 `{ error: "SOME_CODE", message: "中文原因" }`。
     * 只取 `error` 时，用户看到的是 `CONFLICT_RESTORE_RUNNING` 这种字符串——
     * 信息量为零，而且容易被当成系统故障而不是「等一会儿再来」。
     * 老接口里有直接把中文写进 `error` 的，靠下面的回退仍然命中。
     */
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return { message: parsed.message.trim(), payload }
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return { message: parsed.error, payload }
    }
    return { payload }
  } catch {
    return {}
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
  if (!res.ok) {
    const detail = await hubServerMessage(res)
    throw hubError(res.status, detail.message, detail.payload)
  }
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
 * 匿名身份传递：只走 `X-Navhub-Anon-Id` header。
 *
 * `?anonId=` query 已于 T1 全量下线：它会残留在浏览器历史、代理/网关访问日志
 * 与 Referer 中，且易被分享 URL 意外扩散。中枢侧仍保留 query 读取一个版本
 * （identity-signature.ts 的 header 优先逻辑），仅为兼容尚未升级的旧客户端。
 */
export function anonHeaders(identity?: string): Record<string, string> {
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
  /** 站点状态过滤（可选）；分类/标签浏览页用 active，避免 broken/pending 占分页名额 */
  status?: 'active' | 'pending' | 'broken' | 'archived'
  /** 身份标识（匿名 anonId 或登录 userId），用于个性化与历史 */
  identity?: string
}

export async function searchSites(params: SearchParams, signal?: AbortSignal): Promise<HubSearchResult> {
  const query = new URLSearchParams({ q: params.q })
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))
  if (params.categoryId) query.set('categoryId', params.categoryId)
  if (params.tag) query.set('tag', params.tag)
  if (params.status) query.set('status', params.status)
  // 兼容旧中枢：query 保留 anonId；新中枢优先读 X-Navhub-Anon-Id header（防日志泄漏）
  if (params.identity) query.set('anonId', params.identity)
  try {
    return await getJson<HubSearchResult>('/api/search?' + query.toString(), signal, anonHeaders(params.identity))
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    return { hits: [], channelsUsed: [], semanticAvailable: false, tookMs: 0, degraded: true }
  }
}

export interface ClickReportContext {
  /** 触发这次点击的搜索词；带上后服务端的 LinUCB 反馈回路才会更新通道权重 */
  query?: string
  /** 该结果真正由哪一路召回（exact/fts/pinyin/semantic/personal） */
  channel?: string
  /** 结果在列表中的名次（1 起） */
  position?: number
  /** 页面停留秒数（由调用方在离开时补报时使用） */
  dwellSeconds?: number
}

const CLICK_CHANNELS = new Set(['exact', 'fts', 'pinyin', 'semantic', 'personal'])

/** 纯函数：把点击上下文收敛成 /api/events 能接受且长度有界的 payload */
export function buildClickEventBody(
  siteId: string,
  context?: ClickReportContext,
): Record<string, unknown> {
  const body: Record<string, unknown> = { kind: 'click', siteId }
  const query = context?.query?.trim().slice(0, 200)
  if (query) body.query = query
  if (context?.channel && CLICK_CHANNELS.has(context.channel)) body.channel = context.channel
  if (typeof context?.position === 'number' && Number.isFinite(context.position) && context.position >= 1) {
    body.position = Math.min(200, Math.floor(context.position))
  }
  if (typeof context?.dwellSeconds === 'number' && Number.isFinite(context.dwellSeconds) && context.dwellSeconds >= 0) {
    body.dwellSeconds = Math.min(3600, context.dwellSeconds)
  }
  return body
}

/** 点击上报（fire-and-forget，失败静默） */
export function reportClick(siteId: string, identity?: string, context?: ClickReportContext): void {
  void sendJson('/api/events', 'POST', buildClickEventBody(siteId, context), undefined, anonHeaders(identity)).catch(() => {
    // 点击上报是 fire-and-forget：离线、被拦截、匿名模式都算正常，不该冒泡到页面逻辑
  })
}

/* ------------------------------ 标签 ------------------------------ */

export async function fetchTags(onDegraded?: DegradedHandler): Promise<HubTag[]> {
  // 读契约类型（而不是手写的 HubTag）：中枢若改名 name/slug/count，
  // 这里的返回值就无法赋给 HubTag[]，编译期直接红。
  return degrade([], () => getJson<TagListResponse>('/api/tags?minCount=1&limit=100'), onDegraded)
}

/* ------------------------------ 类目 ------------------------------ */

/**
 * 类目行的客户端视图。
 *
 * 与 `lib/server/categories.ts` 的 `HubCategory` 是同一份中枢数据的两个形状，
 * 这里刻意只留展示需要的字段：服务端模块 import 了只有 node 能用的 `hubGet`，
 * 客户端组件把它拖进浏览器包会直接构建失败。
 */
export interface HubCategoryLite {
  id: string
  title: string
  titleEn?: string | null
  slug?: string | null
  parentId?: string | null
  icon?: string | null
  enabled?: boolean
  sort?: number
}

/**
 * 全量类目树（公开）。
 *
 * 返回 `null` 表示中枢取数失败——调用方必须把它和「类目表真的为空」分开，
 * 否则故障会被渲染成「暂无分类」（同类缺陷见文件顶部的 `degrade` 注释）。
 */
export async function fetchCategories(onDegraded?: DegradedHandler): Promise<HubCategoryLite[] | null> {
  return degrade(
    null,
    async () => {
      // 契约类型 -> 展示类型的赋值本身就是门禁：中枢改了 title/parentId 的形状，
      // 这行会编译失败，而不是让类目树在运行时静默变成「暂无分类」。
      const data: CategoryListResponse = await getJson<CategoryListResponse>('/api/categories')
      // 非数组（中枢异常时可能返回错误对象）按故障处理，不能让 .filter 抛给 UI
      if (!Array.isArray(data)) throw new Error('类目响应格式异常')
      return data
    },
    onDegraded,
  )
}

/**
 * 类目 → 存活站点数（`categoryId` 为类目 **id**，不是 slug）。
 *
 * 口径是单个类目自身：站点只挂叶子，一级根恒为 0。
 * 返回 `null` 同样表示取数失败（此时调用方不该把全部类目当 0 站）。
 */
export async function fetchCategoryCounts(onDegraded?: DegradedHandler): Promise<Map<string, number> | null> {
  return degrade(
    null,
    async () => {
      const res = await getJson<CategoryCountsResponse>('/api/categories/counts')
      if (!res || !Array.isArray(res.counts)) throw new Error('类目计数响应格式异常')
      const map = new Map<string, number>()
      for (const row of res.counts) {
        const id = typeof row?.categoryId === 'string' ? row.categoryId.trim() : ''
        if (id) map.set(id, Number(row?.sites) || 0)
      }
      return map
    },
    onDegraded,
  )
}

/* ------------------------------ 榜单 ------------------------------ */

export async function fetchTrending(limit = 20, onDegraded?: DegradedHandler): Promise<HubSite[]> {
  return degrade(
    [],
    async () => {
      // 响应形状由契约生成物定型：中枢给榜单换壳（比如把 hits 改名）会在编译期红
      const data = await getJson<RankTrendingResponse>('/api/rank/trending?limit=' + limit)
      return data.hits.map((h) => h.site).filter(Boolean)
    },
    onDegraded,
  )
}

export async function fetchNewSites(limit = 20, onDegraded?: DegradedHandler): Promise<HubSite[]> {
  return degrade(
    [],
    async () => {
      const data = await getJson<RankNewResponse>('/api/rank/new?limit=' + limit)
      return data.hits.map((h) => h.site).filter(Boolean)
    },
    onDegraded,
  )
}

/** 双曲平替推理的单条命中 */
export interface HubHyperbolicHit {
  site: HubSite
  /** 洛伦兹双曲面上的测地距离（越大越不像平替） */
  geodesicDistance: number
  /** 同层级平替得分 */
  alternativeScore: number
  sameCategory: boolean
}

export interface HubHyperbolicPayload {
  hits: HubHyperbolicHit[]
  /**
   * 口径声明，不是装饰：
   *   `lorentz-hyperboloid` = 真实 BGE 向量投到双曲球后算的测地距离
   *   `lorentz-heuristic`   = 没有向量，按同分类 + 标签 Jaccard 构造投影坐标（估算）
   *   `none` / `missing_site` = 端点内部异常 / 站点已不存在
   * 把启发式估算得分显示成语义结论，等于把未知当已知，所以调用方必须原样呈现。
   */
  manifold: string
  semanticAvailable: boolean
}

/**
 * 双曲空间平替推理（`/api/rank/alternatives/:siteId`）。
 * 返回 `null` 表示中枢不可用（与「算得出但一个候选都没有」区分开）。
 */
export async function fetchHyperbolicAlternatives(
  siteId: string,
  limit = 6,
  onDegraded?: DegradedHandler,
): Promise<HubHyperbolicPayload | null> {
  try {
    const data = await getJson<HubHyperbolicPayload>(
      '/api/rank/alternatives/' + encodeURIComponent(siteId) + '?limit=' + limit,
    )
    if (!data || !Array.isArray(data.hits)) throw new Error('双曲平替响应格式异常')
    return {
      hits: data.hits,
      manifold: typeof data.manifold === 'string' ? data.manifold : 'none',
      semanticAvailable: data.semanticAvailable === true,
    }
  } catch (error) {
    if (isNotFound(error)) return { hits: [], manifold: 'missing_site', semanticAvailable: false }
    notifyDegraded(onDegraded, error)
    return null
  }
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
    // 否则斜杠会被切成多段导致 404（实测：编码后 200，不编码 404）。
    // 形状取自生成契约「GET /api/sites/{id}」，与列表共用同一份 SitePayload。
    return await getJson<ContractSite>('/api/sites/' + encodeURIComponent(idOrUrl))
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
  /** 标签（T22）：服务端已归一（≤8 个、各 ≤24 字符）；null = 未打标签 */
  tags?: string[] | null
  createdAt: number
  site: HubSite | null
}

/** 云端收藏接口的返回形状（listFavorites / 同步结果共用） */
export interface HubFavoriteFolder {
  id: string
  name: string
  sort?: number
  createdAt?: number
}

export interface HubFavoritesPayload {
  items: HubFavorite[]
  folders: HubFavoriteFolder[]
}

export async function listFavorites(identity: string, onDegraded?: DegradedHandler): Promise<HubFavoritesPayload> {
  return degrade<HubFavoritesPayload>(
    { items: [], folders: [] },
    () =>
      getJson<HubFavoritesPayload>(
        '/api/favorites',
        undefined,
        anonHeaders(identity),
      ),
    onDegraded,
  )
}

export interface HubFavoriteSyncItem extends HubFavorite {
  /** 行最后更新时间（服务端时钟） */
  updatedAt?: number
  /** 非空表示墓碑：该 siteId 已被删除，本地必须一并移除 */
  deletedAt?: number | null
}

export interface HubFavoritesSyncPayload {
  ok: boolean
  applied: number
  version: number
  items: HubFavoriteSyncItem[]
  folders: HubFavoriteFolder[]
}

export interface FavoriteSyncOp {
  op: 'add' | 'update' | 'remove'
  siteId: string
  folderId?: string | null
  note?: string | null
  /** 标签（T22）：add 全量覆盖；update 显式传入才写；null = 清除 */
  tags?: string[] | null
  /** 客户端发生时间；省略则由服务端取当前时间（LWW 依据） */
  at?: number
}

/**
 * 批量同步（M1）：一次请求提交 ops 并取回 since 之后的增量（含墓碑）。
 *
 * 走 BFF `/api/me/favorites/sync`（会话派生身份）——匿名身份不适用，
 * 匿名分支仍走旧的逐条端点（见 useFavorites 的 syncFavoritesToCloud）。
 */
export async function syncFavoritesBatch(
  ops: FavoriteSyncOp[],
  since: number,
  onDegraded?: DegradedHandler,
): Promise<HubFavoritesSyncPayload | null> {
  return degrade<HubFavoritesSyncPayload | null>(
    null,
    async () => {
      const res = await fetch('/api/me/favorites/sync', {
        method: 'POST',
        signal: readSignal(undefined),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops, since }),
      })
        if (!res.ok) {
          const detail = await hubServerMessage(res)
          throw hubError(res.status, detail.message, detail.payload)
        }
        const text = await res.text()
        return (text ? JSON.parse(text) : {}) as HubFavoritesSyncPayload
    },
    onDegraded,
  )
}

export async function addFavorite(identity: string, siteId: string, onDegraded?: DegradedHandler): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson('/api/favorites', 'POST', { siteId }, undefined, anonHeaders(identity))
      return true
    },
    onDegraded,
  )
}

export async function removeFavorite(identity: string, siteId: string, onDegraded?: DegradedHandler): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson('/api/favorites/' + encodeURIComponent(siteId), 'DELETE', undefined, undefined, anonHeaders(identity))
      return true
    },
    onDegraded,
  )
}

/** 收藏管理：移动到文件夹 / 改备注（folderId=null 表示移出文件夹） */
export async function updateFavoriteMeta(
  identity: string,
  siteId: string,
  patch: { folderId?: string | null; note?: string | null; tags?: string[] | null },
  onDegraded?: DegradedHandler,
): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson(
        '/api/favorites/' + encodeURIComponent(siteId),
        'PATCH',
        patch,
        undefined,
        anonHeaders(identity),
      )
      return true
    },
    onDegraded,
  )
}

/** 清空云端收藏 */
export async function clearCloudFavorites(identity: string, onDegraded?: DegradedHandler): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson('/api/favorites', 'DELETE', undefined, undefined, anonHeaders(identity))
      return true
    },
    onDegraded,
  )
}

export async function createFavoriteFolder(identity: string, name: string, onDegraded?: DegradedHandler): Promise<HubFavoriteFolder | null> {
  return degrade<HubFavoriteFolder | null>(null, () =>
    sendJson<HubFavoriteFolder>(
      '/api/favorites/folders',
      'POST',
      { name },
      undefined,
      anonHeaders(identity),
    ), onDegraded)
}

export async function updateFavoriteFolder(
  identity: string,
  folderId: string,
  patch: { name?: string; sort?: number },
  onDegraded?: DegradedHandler,
): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson(
        '/api/favorites/folders/' + encodeURIComponent(folderId),
        'PATCH',
        patch,
        undefined,
        anonHeaders(identity),
      )
      return true
    },
    onDegraded,
  )
}

export async function deleteFavoriteFolder(identity: string, folderId: string, onDegraded?: DegradedHandler): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson(
        '/api/favorites/folders/' + encodeURIComponent(folderId),
        'DELETE',
        undefined,
        undefined,
        anonHeaders(identity),
      )
      return true
    },
    onDegraded,
  )
}

/* ------------------------------ 搜索历史 ------------------------------ */

export async function fetchSearchHistory(identity: string, limit = 8, onDegraded?: DegradedHandler): Promise<string[]> {
  return degrade([], async () => {
    const data = await getJson<SearchHistoryPageResponse>(
      '/api/search-history?limit=' + limit,
      undefined,
      anonHeaders(identity),
    )
    return data.items.map((i) => i.query)
  }, onDegraded)
}

/** 历史记录条目：形状直接取生成契约（GET /api/search-history） */
export type HubSearchHistoryItem = SearchHistoryPageResponse['items'][number]

export async function fetchSearchHistoryPage(
  identity: string,
  options: { limit?: number; offset?: number } = {},
  onDegraded?: DegradedHandler,
): Promise<SearchHistoryPageResponse> {
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  return degrade(
    { items: [], hasMore: false, nextOffset: offset },
    () =>
      getJson<SearchHistoryPageResponse>(
        '/api/search-history?limit=' + limit + '&offset=' + offset,
        undefined,
        anonHeaders(identity),
      ),
    onDegraded,
  )
}

export async function deleteSearchHistoryItem(identity: string, id: number, onDegraded?: DegradedHandler): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson(
        '/api/search-history/' + id,
        'DELETE',
        undefined,
        undefined,
        anonHeaders(identity),
      )
      return true
    },
    onDegraded,
  )
}

export async function clearCloudSearchHistory(identity: string, onDegraded?: DegradedHandler): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson('/api/search-history', 'DELETE', undefined, undefined, anonHeaders(identity))
      return true
    },
    onDegraded,
  )
}

/**
 * 批量清理零结果记录（T4）：服务端一次往返完成筛选与删除，
 * 替代此前「逐条 DELETE 串行循环」。返回实际删除条数；失败返回 null。
 */
export async function batchCleanZeroResultSearchHistory(
  identity: string,
  onDegraded?: DegradedHandler,
): Promise<number | null> {
  return degrade<number | null>(
    null,
    async () => {
      const res = await sendJson(
        '/api/search-history/batch-delete',
        'POST',
        { filter: 'zero_results' },
        undefined,
        anonHeaders(identity),
      ) as { removed?: number }
      return typeof res?.removed === 'number' ? res.removed : null
    },
    onDegraded,
  )
}

/* --------------------------- 访问历史（T23） --------------------------- */

export interface HubVisitItem {
  id: number
  siteId: string
  at: number
  site: { id: string; title: string; url: string; description: string | null } | null
}

/**
 * 访问历史分页（/api/me/visits 走 BFF 会话身份，不需要自报 anonId）。
 * 降级返回 null：调用方据此区分「确实没有访问记录」与「云端取不到」。
 */
export async function fetchVisitsPage(
  options: { limit?: number; offset?: number } = {},
  onDegraded?: DegradedHandler,
): Promise<{ items: HubVisitItem[]; total: number; hasMore: boolean; nextOffset: number } | null> {
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  return degrade(
    null,
    async () => {
      const data = await getJson<{ items?: HubVisitItem[]; total?: number; hasMore?: boolean; nextOffset?: number }>(
        '/api/me/visits?limit=' + limit + '&offset=' + offset,
      )
      return {
        items: Array.isArray(data.items) ? data.items : [],
        total: Number(data.total ?? 0),
        hasMore: Boolean(data.hasMore),
        nextOffset: Number(data.nextOffset ?? offset),
      }
    },
    onDegraded,
  )
}

/* ------------------------------ 画像 ------------------------------ */

export interface HubProfileExplain {
  profile: {
    topCategories: string[]
    topTags: string[]
    visitedSiteIds: string[]
    favoriteSiteIds: string[]
    searchCount: number
    updatedAt: number
  } | null
  explain: {
    windowDays: number
    personalizationEnabled: boolean
    favoriteSignalCutoff: number
    signalCounts: { click: number; favorite: number; searches: number }
    generatedAt: number
  }
}

export async function fetchProfileExplain(identity: string, onDegraded?: DegradedHandler): Promise<HubProfileExplain | null> {
  return degrade<HubProfileExplain | null>(null, () =>
    getJson<HubProfileExplain>(
      '/api/profile?explain=1',
      undefined,
      anonHeaders(identity),
    ), onDegraded)
}

/** 清理某一类画像信号（click / search / favorite），服务端会立即重建画像 */
export async function clearProfileSignals(
  identity: string,
  kind: 'click' | 'search' | 'favorite',
  onDegraded?: DegradedHandler,
): Promise<boolean> {
  return degrade(
    false,
    async () => {
      await sendJson(
        '/api/profile/signals/' + kind,
        'DELETE',
        undefined,
        undefined,
        anonHeaders(identity),
      )
      return true
    },
    onDegraded,
  )
}

/* ------------------------ E2EE 零知识云端金库 ------------------------ */

export interface CloudVaultData {
  userId: string
  payload: string
  version: number
  updatedAt: number
}

export async function fetchCloudVault(identity: string, onDegraded?: DegradedHandler): Promise<CloudVaultData | null> {
  return degrade<CloudVaultData | null>(null, async () => {
    const data = await getJson<{ ok: boolean; vault: CloudVaultData | null }>(
      '/api/vault/sync',
      undefined,
      anonHeaders(identity),
    )
    return data.vault ?? null
  }, onDegraded)
}

/**
 * 服务端 PUT /api/vault/sync 在 409 里给的机读码。
 *
 * 两种成因的纠正动作相反，不能合并成一句「被其它设备更新」：
 *  - VAULT_CLEARED：云端那份已被清除（或在别处注销），本机版本号指向不存在的备份 → 拉取是空循环，正确动作是以 version=0 重建；
 *  - VERSION_CONFLICT：云端仍有内容且版本被推进 → 正确动作是先拉取再合并推送。
 */
export type VaultConflictCode = 'VAULT_CLEARED' | 'VERSION_CONFLICT'

export interface VaultSaveOutcome {
  ok: boolean
  version?: number
  updatedAt?: number
  /** 云端版本与 expectedVersion 不一致（409） */
  conflict?: boolean
  /** 409 的成因；旧中枢不给 code 时缺省，由调用方按 current 回退判别 */
  code?: VaultConflictCode
  current?: { version: number; updatedAt: number } | null
  /** 服务端原文的纠正建议（WCAG 3.3.3：知道怎么纠正就必须给出做法） */
  hint?: string
  error?: string
}

/**
 * 推送金库密文。
 *
 * expectedVersion 为空时保持旧行为（无条件覆盖）；带上时只有云端仍是该版本才写入，
 * 否则返回 conflict —— 多端同时编辑时，覆盖别人的密文等于静默丢数据。
 */
export async function saveCloudVault(
  identity: string,
  payload: string,
  expectedVersion?: number,
  onDegraded?: DegradedHandler,
): Promise<VaultSaveOutcome> {
  try {
    const body: Record<string, unknown> = { payload }
    if (typeof expectedVersion === 'number') body.version = expectedVersion
    const res = await fetch(hubUrl('/api/vault/sync'), {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeaders(), ...anonHeaders(identity) },
      body: JSON.stringify(body),
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(READ_TIMEOUT_MS)
        : undefined,
    })
    const text = await res.text()
    const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>
    if (res.status === 409) {
      const rawCode = typeof parsed.code === 'string' ? parsed.code : undefined
      return {
        ok: false,
        conflict: true,
        // 只认这两个字面量：中枢将来新增码时宁可退回「按 current 判别」，
        // 也不能把未知原因硬塞进已知话术分支。
        code: rawCode === 'VAULT_CLEARED' || rawCode === 'VERSION_CONFLICT' ? rawCode : undefined,
        current: (parsed.current as { version: number; updatedAt: number } | null | undefined) ?? null,
        hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
        error: typeof parsed.error === 'string' ? parsed.error : '云端金库版本冲突',
      }
    }
    if (!res.ok) throw hubError(res.status, typeof parsed.error === 'string' ? parsed.error : undefined)
    return {
      ok: true,
      version: typeof parsed.version === 'number' ? parsed.version : undefined,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
    }
  } catch (error) {
    notifyDegraded(onDegraded, error)
    return { ok: false, error: error instanceof Error ? error.message : '云端金库同步失败' }
  }
}

/**
 * 删除云端金库的回执。
 *
 * 服务端（DELETE /api/vault/sync）已经区分「真删掉一份」与「云端本来就没有」，
 * 旧实现把任何 2xx 一律折成 true，于是 UI 能对从未存在过的备份宣称「已删除」——
 * 用户会以为自己拥有一份其实没有的备份。这里把事实原样穿上来。
 */
export type CloudVaultDeleteOutcome =
  | { ok: true; deleted: boolean }
  | { ok: false; status?: number; error: string }

export async function deleteCloudVault(
  identity: string,
  onDegraded?: DegradedHandler,
): Promise<CloudVaultDeleteOutcome> {
  try {
    const body = await sendJson<{ ok?: boolean; deleted?: boolean }>(
      '/api/vault/sync',
      'DELETE',
      undefined,
      undefined,
      anonHeaders(identity),
    )
    return { ok: true, deleted: body.deleted === true }
  } catch (error) {
    notifyDegraded(onDegraded, error)
    const status = (error as { status?: number })?.status
    return {
      ok: false,
      status,
      error: error instanceof Error ? error.message : '删除云端金库失败',
    }
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
export interface HubCollectionDetailSite extends HubSite {
  collectionNote?: string | null
  collectionSort?: number
}

/** 专题详情：404 = 专题确实不存在（不触发降级回调）；5xx / 网络失败触发 */
export async function fetchCollectionDetail(
  slug: string,
  onDegraded?: DegradedHandler,
): Promise<{ collection: HubCollection; sites: HubCollectionDetailSite[] } | null> {
  try {
    return await getJson<{ collection: HubCollection; sites: HubCollectionDetailSite[] }>('/api/collections/' + encodeURIComponent(slug))
  } catch (error) {
    if (!isNotFound(error)) notifyDegraded(onDegraded, error)
    return null
  }
}

/** 站点所属精选专题列表 */
export async function fetchSiteCollections(
  siteId: string,
  onDegraded?: DegradedHandler,
): Promise<Array<HubCollection & { collectionNote: string | null }>> {
  return degrade([], () => getJson<Array<HubCollection & { collectionNote: string | null }>>('/api/sites/' + encodeURIComponent(siteId) + '/collections'), onDegraded)
}

/* ------------------------------ 实体关系与知识图谱 ------------------------------ */

export async function fetchSiteRelations(siteId: string, onDegraded?: DegradedHandler): Promise<HubSiteRelationsPayload | null> {
  return degrade<HubSiteRelationsPayload | null>(
    null,
    () => getJson<HubSiteRelationsPayload>('/api/sites/' + encodeURIComponent(siteId) + '/relations'),
    onDegraded,
  )
}

/* ------------------------------ 插件市场 (Plugin Marketplace) ------------------------------ */

/** 版本升级变动明细（已安装版本 → 市场最新版本；与核心 diffPluginManifests 的 PluginDiffResult 对齐，缺省表示无可对比数据） */
export type PluginUpgradeDiff = PluginDiffResult

/** 插件生态大盘遥测（服务端 GET /api/admin/plugins/metrics） */
export interface HubPluginTelemetryMetrics {
  totalPlugins: number
  publishedCount: number
  pendingCount: number
  rejectedCount: number
  delistedCount: number
  quarantinedCount?: number
  totalInstalls: number
  activeInstalls: number
  totalStars: number
  totalReports: number
  kindDistribution: { sitePack: number; workspacePreset: number; theme: number; searchPack?: number; bundle?: number }
  topInstalled: Array<{
    id: string
    slug: string
    name: string
    kind: string
    version: string
    installCount: number
    starCount: number
  }>
}

/** 拉取大盘遥测；失败降级为 null（管理页隐藏面板，不打断插件列表渲染） */
export async function fetchPluginTelemetry(): Promise<HubPluginTelemetryMetrics | null> {
  return degrade<HubPluginTelemetryMetrics | null>(null, () =>
    getJson<HubPluginTelemetryMetrics>('/api/admin/plugins/metrics'),
  )
}

export interface HubPluginBundleMember {
  slug: string
  kind: string
  name: string | null
  icon: string | null
  version: string | null
  status: string
  available: boolean
  reason?: string
  summary?: {
    siteCount?: number
    categoryCount?: number
    engineCount?: number
    themeTokenCount?: number
    boardCount?: number
    bundleItemCount?: number
    bundleKinds?: string[]
  } | null
}

export interface HubPluginItem {
  id: string
  slug: string
  kind: 'site-pack' | 'workspace-preset' | 'theme' | 'search-pack' | 'bundle'
  name: string
  description: string
  icon?: string | null
  author?: string | null
  authorKind?: string | null
  /** 作者公开页 key（身份不可逆哈希） */
  ownerKey?: string | null
  version: string
  tags?: string[]
  homepage?: string | null
  license?: string | null
  manifest: any
  summary?: any
  source: string
  status: 'pending' | 'published' | 'rejected' | 'delisted' | 'quarantined'
  installCount: number
  starCount: number
  reportCount: number
  featured?: boolean
  featuredRank?: number
  ratingAvg?: number
  reviewCount?: number
  /** 待审版本的变更说明（仅作者中心/作者本人可见） */
  pendingChangelog?: string | null
  reviewNote?: string | null
  reviewedAt?: number | null
  publishedAt?: number | null
  createdAt: number
  updatedAt: number
  installed?: boolean
  starred?: boolean
  installedVersion?: string | null
  installedAt?: number | null
  upgradeDiff?: PluginUpgradeDiff | null
  /** 组合包成员解析结果（仅 kind=bundle 的详情响应返回） */
  bundleItems?: HubPluginBundleMember[]
  /** 组合包全部成员可用时为 true；任一成员失效则安装 fail closed */
  bundleReady?: boolean
  isOwner?: boolean
  authorVerified?: boolean
  forkedFromSlug?: string | null
  remixCount?: number
  pendingVersion?: string | null
  aiAudit?: {
    score: number
    level: string
    auditedAt: number
  } | null
  reviewStats?: {
    avgRating: number
    reviewCount: number
    ratingDistribution: Record<number, number>
  } | null
  myReview?: HubPluginReviewItem | null
}

export interface HubPluginsResponse {
  items: HubPluginItem[]
  total: number
  pending?: number
  limit: number
  offset: number
}

/** 已装插件条目：形状直接取生成契约（GET /api/plugins/installed） */
export type HubPluginInstalledItem = InstalledPluginsResponse['items'][number]

export async function fetchPlugins(
  params: { kind?: string; q?: string; sort?: string; featured?: boolean; ownerKey?: string; limit?: number; offset?: number } = {},
  onDegraded?: DegradedHandler,
): Promise<HubPluginsResponse> {
  const sp = new URLSearchParams()
  if (params.kind) sp.set('kind', params.kind)
  if (params.q) sp.set('q', params.q)
  if (params.sort) sp.set('sort', params.sort)
  if (params.featured !== undefined) sp.set('featured', String(params.featured))
  if (params.ownerKey) sp.set('ownerKey', params.ownerKey)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset))
  const qs = sp.toString()
  const path = '/api/plugins' + (qs ? `?${qs}` : '')
  return degrade<HubPluginsResponse>(
    { items: [], total: 0, limit: params.limit ?? 24, offset: params.offset ?? 0 },
    () => getJson<HubPluginsResponse>(path),
    onDegraded,
  )
}

export async function fetchAdminPlugins(
  params: { status?: string; kind?: string; q?: string; sort?: string; limit?: number; offset?: number } = {},
  onDegraded?: DegradedHandler,
): Promise<HubPluginsResponse> {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.kind) sp.set('kind', params.kind)
  if (params.q) sp.set('q', params.q)
  if (params.sort) sp.set('sort', params.sort)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset))
  const qs = sp.toString()
  const path = '/api/admin/plugins' + (qs ? `?${qs}` : '')
  return degrade<HubPluginsResponse>(
    { items: [], total: 0, limit: params.limit ?? 24, offset: params.offset ?? 0 },
    () => getJson<HubPluginsResponse>(path),
    onDegraded,
  )
}

export async function fetchInstalledPlugins(
  identity?: string,
  onDegraded?: DegradedHandler,
): Promise<InstalledPluginsResponse> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return degrade<InstalledPluginsResponse>(
    { items: [], total: 0 },
    () =>
      getJson<InstalledPluginsResponse>(
        `/api/plugins/installed`,
        undefined,
        effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
      ),
    onDegraded,
  )
}

export async function fetchPluginDetail(
  slug: string,
  identity?: string,
  onDegraded?: DegradedHandler,
): Promise<{ plugin: HubPluginItem; summary: any } | null> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  try {
    return await getJson<{ plugin: HubPluginItem; summary: any }>(
      `/api/plugins/${encodeURIComponent(slug)}`,
      undefined,
      effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
    )
  } catch (error) {
    if (!isNotFound(error)) notifyDegraded(onDegraded, error)
    return null
  }
}

export interface HubPluginSearchResponse {
  items: HubPluginItem[]
  total: number
  mode: 'semantic' | 'keyword'
  degraded: boolean
}

/**
 * 语义优先的插件检索（描述需求即可找到）。
 *
 * 服务端在模型不可用时自动关键词回退并用 degraded 标注；这里不再二次兜底，
 * 请求失败才走 degrade 的兜底值（mode 标 keyword + degraded，等价于"什么都没找到"）。
 */
export async function searchPlugins(
  params: { q: string; kind?: string; limit?: number },
  onDegraded?: DegradedHandler,
): Promise<HubPluginSearchResponse> {
  const sp = new URLSearchParams()
  sp.set('q', params.q)
  if (params.kind) sp.set('kind', params.kind)
  if (params.limit) sp.set('limit', String(params.limit))
  return degrade<HubPluginSearchResponse>(
    { items: [], total: 0, mode: 'keyword', degraded: true },
    () => getJson<HubPluginSearchResponse>(`/api/plugins/search?${sp.toString()}`),
    onDegraded,
  )
}

/** 相似插件（详情页发现回路，语义近邻） */
export async function fetchSimilarPlugins(
  slug: string,
  limit = 6,
  onDegraded?: DegradedHandler,
): Promise<{ items: HubPluginItem[]; total: number; degraded: boolean }> {
  return degrade<{ items: HubPluginItem[]; total: number; degraded: boolean }>(
    { items: [], total: 0, degraded: true },
    () =>
      getJson<{ items: HubPluginItem[]; total: number; degraded: boolean }>(
        `/api/plugins/${encodeURIComponent(slug)}/similar?limit=${limit}`,
      ),
    onDegraded,
  )
}

export async function validatePlugin(
  manifest: unknown,
): Promise<{ ok: boolean; manifest?: any; summary?: any; error?: string; errors?: string[] }> {
  return sendJson('/api/plugins/validate', 'POST', { manifest })
}

export async function publishPlugin(
  manifest: unknown,
  identity?: string,
  options?: { autoAudit?: boolean }
): Promise<HubPluginItem & { audit?: HubPluginAuditReport }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  // API 合约：默认进入 pending 待审队列，只有显式 autoAudit=true 才自动上架。
  // 手动投稿页/导出弹窗都承诺“已提交审核”，别让这句文案变成已上架。
  const shouldAutoAudit = options?.autoAudit === true
  const params = new URLSearchParams()
  if (effectiveIdentity) params.set('anonId', effectiveIdentity)
  if (shouldAutoAudit) params.set('autoAudit', 'true')
  const qs = params.toString() ? `?${params.toString()}` : ''
  return sendJson<HubPluginItem & { audit?: HubPluginAuditReport }>(
    `/api/plugins`,
    'POST',
    { manifest, autoAudit: shouldAutoAudit },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

/** 对指定插件发起 AI 智能自动审查与即时审批 */
export async function runAiPluginAudit(
  slug: string,
  identity?: string
): Promise<{ success: boolean; plugin: HubPluginItem; audit: HubPluginAuditReport }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson<{ success: boolean; plugin: HubPluginItem; audit: HubPluginAuditReport }>(
    `/api/plugins/${encodeURIComponent(slug)}/ai-audit`,
    'POST',
    {},
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

/** 我的插件（作者中心）：全部状态 + 待审说明 */
export async function fetchMyPlugins(
  params: { limit?: number; offset?: number; identity?: string } = {},
  onDegraded?: DegradedHandler,
): Promise<HubPluginsResponse> {
  const effectiveIdentity = params.identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  const sp = new URLSearchParams()
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset))
  const qs = sp.toString() ? `?${sp.toString()}` : ''
  return degrade<HubPluginsResponse>(
    { items: [], total: 0, limit: params.limit ?? 24, offset: params.offset ?? 0 },
    () =>
      getJson<HubPluginsResponse>(
        `/api/plugins/mine${qs}`,
        undefined,
        effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
      ),
    onDegraded,
  )
}

export interface HubPluginAuthorResponse {
  ownerKey: string
  author: string
  authorKind?: string | null
  stats: { plugins: number; installs: number; stars: number }
  items: HubPluginItem[]
  total: number
  limit: number
  offset: number
}

/** 公开作者页 */
export async function fetchAuthorPlugins(
  ownerKey: string,
  params: { limit?: number; offset?: number } = {},
  onDegraded?: DegradedHandler,
): Promise<HubPluginAuthorResponse | null> {
  const sp = new URLSearchParams()
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset))
  const qs = sp.toString() ? `?${sp.toString()}` : ''
  return degrade<HubPluginAuthorResponse | null>(
    null,
    () => getJson<HubPluginAuthorResponse>(`/api/plugins/author/${encodeURIComponent(ownerKey)}${qs}`),
    onDegraded,
  )
}

/** 作者自助提交新版本（支持 autoAudit 自动严审即时上架） */
export async function submitPluginVersion(
  slug: string,
  manifest: unknown,
  changelog: string,
  identity?: string,
  options?: { autoAudit?: boolean }
): Promise<HubPluginItem & { audit?: HubPluginAuditReport }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  // 同 publishPlugin：版本提交默认也进人工审核队列，AI 工坊显式传 true。
  const shouldAutoAudit = options?.autoAudit === true
  const params = new URLSearchParams()
  if (effectiveIdentity) params.set('anonId', effectiveIdentity)
  if (shouldAutoAudit) params.set('autoAudit', 'true')
  const qs = params.toString() ? `?${params.toString()}` : ''
  return sendJson<HubPluginItem & { audit?: HubPluginAuditReport }>(
    `/api/plugins/${encodeURIComponent(slug)}/versions`,
    'POST',
    { manifest, changelog, autoAudit: shouldAutoAudit },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

/** 插件清单提交前 AI 预检 (Pre-flight Audit) */
export async function preAuditPlugin(
  manifest: unknown,
  identity?: string
): Promise<{ ok: boolean; audit: HubPluginAuditReport; summary: any }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson<{ ok: boolean; audit: HubPluginAuditReport; summary: any }>(
    `/api/plugins/pre-audit`,
    'POST',
    { manifest },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

/** 插件清单 AI 自动深度修复与规范化 (Auto-Remediate) */
export async function autoFixPlugin(
  manifest: unknown,
  identity?: string
): Promise<{ ok: boolean; manifest: any; changes: string[]; audit: HubPluginAuditReport; summary: any }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson<{ ok: boolean; manifest: any; changes: string[]; audit: HubPluginAuditReport; summary: any }>(
    `/api/plugins/auto-fix`,
    'POST',
    { manifest },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

export async function importPlugin(
  manifest: unknown,
  explicitSlug?: string,
  identity?: string,
): Promise<{ success: boolean; plugin: HubPluginItem; alreadyExisted: boolean }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson(
    '/api/plugins/import',
    'POST',
    { manifest, slug: explicitSlug },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

export async function updatePlugin(
  slug: string,
  manifest: unknown,
  identity?: string,
): Promise<{ success: boolean; plugin: HubPluginItem }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson(
    `/api/plugins/${encodeURIComponent(slug)}`,
    'PUT',
    { manifest },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

export async function reviewPlugin(
  slug: string,
  action: 'approve' | 'reject' | 'delist',
  note?: string,
): Promise<{ success: boolean; plugin: HubPluginItem; action: string }> {
  return sendJson(`/api/plugins/${encodeURIComponent(slug)}/review`, 'POST', { action, note })
}

export async function installPlugin(
  slug: string,
  identity?: string,
  options?: { version?: string; selectedSites?: string[] },
): Promise<{ success: boolean; alreadyInstalled: boolean; plugin: HubPluginItem; applied: any }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  trackPluginEvent('plugin_install_click', slug, effectiveIdentity)
  const qs = new URLSearchParams()
  if (options?.version) qs.set('version', options.version)
  const qsStr = qs.toString() ? `?${qs.toString()}` : ''
  return sendJson(
    `/api/plugins/${encodeURIComponent(slug)}/install${qsStr}`,
    'POST',
    options?.selectedSites ? { selectedSites: options.selectedSites } : {},
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

export async function uninstallPlugin(
  slug: string,
  identity?: string,
  removeSites = true,
): Promise<{ success: boolean; uninstalled: boolean; sitesRemoved: number; categoriesRemoved?: number }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  trackPluginEvent('plugin_uninstall_click', slug, effectiveIdentity)
  const qs = new URLSearchParams()
  if (effectiveIdentity) qs.set('anonId', effectiveIdentity)
  if (removeSites) qs.set('removeSites', 'true')
  const qsStr = qs.toString() ? `?${qs.toString()}` : ''
  return sendJson(
    `/api/plugins/${encodeURIComponent(slug)}/uninstall${qsStr}`,
    'POST',
    { removeSites },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

export async function starPlugin(
  slug: string,
  identity?: string,
): Promise<{ success: boolean; starred: boolean; starCount: number }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson(
    `/api/plugins/${encodeURIComponent(slug)}/star`,
    'POST',
    {},
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

export async function unstarPlugin(
  slug: string,
  identity?: string,
): Promise<{ success: boolean; starred: boolean; starCount: number }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson(
    `/api/plugins/${encodeURIComponent(slug)}/star`,
    'DELETE',
    undefined,
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

export async function reportPlugin(
  slug: string,
  reason: string,
  identity?: string,
): Promise<{ success: boolean; reportCount: number }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson(
    `/api/plugins/${encodeURIComponent(slug)}/report`,
    'POST',
    { reason },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

/* ------------------------------ 多版本历史与清单对比 ------------------------------ */

export interface HubPluginVersionItem {
  id: string
  version: string
  changelog?: string | null
  checksum: string
  publishedAt: number
  createdAt: number
}

export interface HubPluginVersionDetail {
  slug: string
  version: string
  manifest: any
  changelog?: string | null
  checksum: string
  publishedAt: number
  diffAgainstCurrent: any
}

/** 查询插件版本时间轴历史 */
export async function fetchPluginVersions(
  slug: string,
  onDegraded?: DegradedHandler,
): Promise<{ slug: string; versions: HubPluginVersionItem[] }> {
  return degrade<{ slug: string; versions: HubPluginVersionItem[] }>(
    { slug, versions: [] },
    () => getJson(`/api/plugins/${encodeURIComponent(slug)}/versions`),
    onDegraded,
  )
}

/** 查询特定历史版本的清单快照与对比 */
export async function fetchPluginVersionDetail(
  slug: string,
  version: string,
  onDegraded?: DegradedHandler,
): Promise<HubPluginVersionDetail | null> {
  return degrade<HubPluginVersionDetail | null>(
    null,
    () => getJson(`/api/plugins/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`),
    onDegraded,
  )
}

/* ------------------------------ 真实安装用户评价与评分 ------------------------------ */

export interface HubPluginReviewItem {
  id: string
  pluginId: string
  identity: string
  rating: number
  title?: string | null
  content?: string | null
  installedVersion: string
  status?: 'visible' | 'hidden' | string
  reportCount?: number
  moderationNote?: string | null
  moderatedAt?: number | null
  moderatedBy?: string | null
  /** 作者官方回复（仅插件作者可写；服务端按作者身份校验） */
  authorReply?: string | null
  authorRepliedAt?: number | null
  createdAt: number
  updatedAt: number
}

export interface HubPluginReviewsResponse {
  slug: string
  stats: {
    avgRating: number
    reviewCount: number
    ratingDistribution: Record<number, number>
  }
  myReview: HubPluginReviewItem | null
  items: HubPluginReviewItem[]
  total: number
  limit: number
  offset: number
}

/** 获取插件评价列表与大盘统计 */
export async function fetchPluginReviews(
  slug: string,
  params: { limit?: number; offset?: number; identity?: string } = {},
  onDegraded?: DegradedHandler,
): Promise<HubPluginReviewsResponse> {
  const effectiveIdentity = params.identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  const sp = new URLSearchParams()
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset))
  if (effectiveIdentity) sp.set('identity', effectiveIdentity)
  const qs = sp.toString() ? `?${sp.toString()}` : ''
  return degrade<HubPluginReviewsResponse>(
    {
      slug,
      stats: { avgRating: 0, reviewCount: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      myReview: null,
      items: [],
      total: 0,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
    },
    () => getJson(`/api/plugins/${encodeURIComponent(slug)}/reviews`),
    onDegraded,
  )
}

/** 提交或修改评价（需活跃安装） */
export async function submitPluginReview(
  slug: string,
  input: { rating: number; title?: string; content?: string },
  identity?: string,
): Promise<{ success: boolean; review: HubPluginReviewItem; stats: any }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson(
    `/api/plugins/${encodeURIComponent(slug)}/reviews`,
    'POST',
    { ...input, identity: effectiveIdentity },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

/** 举报评价（进入治理队列，不自动隐藏） */
/** 作者官方回复评价 */
export async function replyPluginReview(
  reviewId: string,
  reply: string,
  identity?: string,
): Promise<{ ok: boolean; review: HubPluginReviewItem }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson<{ ok: boolean; review: HubPluginReviewItem }>(
    `/api/plugins/reviews/${encodeURIComponent(reviewId)}/reply`,
    'POST',
    { reply },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

export async function reportPluginReview(
  slug: string,
  reviewId: string,
  reason: string,
  identity?: string,
): Promise<{ ok: boolean; reportCount: number }> {
  const effectiveIdentity = identity || (typeof window !== 'undefined' ? getIdentity() : undefined)
  return sendJson(
    `/api/plugins/${encodeURIComponent(slug)}/reviews/${encodeURIComponent(reviewId)}/report`,
    'POST',
    { reason },
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

/* ------------------------------ 治理 / 漏斗 / 短链 ------------------------------ */

export interface HubPluginFunnelDay {
  date: string
  views: number
  installClicks: number
  installs: number
  uninstalls: number
  reports: number
}

export interface HubPluginFunnel {
  days: number
  totals: { views: number; installClicks: number; installs: number; uninstalls: number; reports: number }
  conversion: { viewToClick: number; clickToInstall: number; viewToInstall: number }
  series: HubPluginFunnelDay[]
  topInstalled: Array<{ slug: string; name: string; installCount: number }>
}

export async function fetchPluginFunnel(
  days = 30,
  onDegraded?: DegradedHandler,
): Promise<HubPluginFunnel | null> {
  return degrade<HubPluginFunnel | null>(
    null,
    () => getJson(`/api/admin/plugins/funnel?days=${days}`),
    onDegraded,
  )
}

export interface HubPluginGovernanceAlert {
  kind: 'pending_sla' | 'reported' | 'review_reported'
  slug: string
  name: string
  status: string
  detail: string
  value: number
  createdAt: number
}

export async function fetchPluginGovernance(
  onDegraded?: DegradedHandler,
): Promise<{ alerts: HubPluginGovernanceAlert[]; generatedAt: number }> {
  return degrade(
    { alerts: [] as HubPluginGovernanceAlert[], generatedAt: 0 },
    () => getJson('/api/admin/plugins/governance'),
    onDegraded,
  )
}

export interface HubAdminPluginReview extends HubPluginReviewItem {
  pluginSlug: string
  pluginName: string
  pluginKind: string
}

export async function fetchAdminPluginReviews(
  params: { status?: 'visible' | 'hidden'; limit?: number; offset?: number } = {},
  onDegraded?: DegradedHandler,
): Promise<{ items: HubAdminPluginReview[]; total: number; limit: number; offset: number }> {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.offset) sp.set('offset', String(params.offset))
  const qs = sp.toString() ? `?${sp.toString()}` : ''
  return degrade(
    { items: [] as HubAdminPluginReview[], total: 0, limit: params.limit ?? 30, offset: params.offset ?? 0 },
    () => getJson(`/api/admin/plugin-reviews`),
    onDegraded,
  )
}

export async function moderatePluginReview(
  reviewId: string,
  action: 'hide' | 'restore',
  note?: string,
): Promise<{ ok: boolean; review: HubPluginReviewItem }> {
  return sendJson(`/api/admin/plugin-reviews/${encodeURIComponent(reviewId)}`, 'PATCH', { action, note })
}

export async function setPluginFeatured(
  slug: string,
  featured: boolean,
  rank = 0,
): Promise<{ ok: boolean; plugin: HubPluginItem }> {
  return sendJson(`/api/plugins/${encodeURIComponent(slug)}/featured`, 'PATCH', { featured, rank })
}

/** 创建分享短链（只允许 /marketplace/ 目标） */
export async function createPluginShortLink(
  slug: string,
  options: { install?: boolean } = {},
): Promise<{ success: boolean; code: string; path: string; target: string }> {
  return sendJson('/api/shortlinks', 'POST', { slug, install: options.install === true })
}

/** 插件漏斗埋点：浏览 / 安装点击 / 卸载点击 / 分享（fire-and-forget，不阻塞 UI） */
export function trackPluginEvent(
  kind: 'plugin_view' | 'plugin_install_click' | 'plugin_uninstall_click' | 'plugin_share',
  slug: string,
  identity?: string,
): void {
  if (typeof window === 'undefined') return
  const body = JSON.stringify({ kind, pluginSlug: slug, anonId: identity || getIdentity() })
  // 必须走同源代理前缀 /api/hub/*；裸 /api/events 在 Next 应用里没有对应路由
  const url = hubUrl('/api/events')
  try {
    if (navigator.sendBeacon) {
      // 返回 false 表示载荷被浏览器丢弃（配额/大小），不能当成功；落到下面的 fetch 兜底。
      if (navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return
    }
  } catch {
    // 落到 fetch 兜底
  }
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // 埋点数据上报失败静默忽略，绝不阻塞或影响主流程体验
    return undefined
  })
}

/**
 * 云端金库漏斗（首页 DIY）埋点的事件字典。
 *
 * 数组是唯一的声明处，类型从它派生 —— 这样守卫测试既能在运行期跟服务端白名单逐字对，
 * 也不会有「类型加了一个值、数组忘了加」这种两边各自漂移的空间。
 *
 * kind / outcome 必须与 telemetry.ts 的 EVENT_KINDS / EVENT_OUTCOMES 逐字一致：
 * 那里是白名单（不在名单里的 kind 直接 400），分支不拆成多个 kind，
 * 同一行为的不同结局用 outcome + code 表达，漏斗才连得上。
 *
 * code 有界且不含任何内容信息 —— 金库是端侧零知识加密，
 * 任何「顺手带上的字段」都会把隐私承诺变成口头承诺；服务端只限长度（max 32），
 * 这里的联合类型才是编译期那道闸。
 */
export const VAULT_TELEMETRY_KINDS = ['vault_status', 'vault_sync', 'vault_pull', 'vault_delete'] as const

export const VAULT_TELEMETRY_OUTCOMES = [
  'success',
  'failed',
  'conflict',
  'empty',
  'deleted',
  'absent',
  'no_identity',
] as const

export const VAULT_RESULT_CODES = [
  'has_vault',
  'no_vault',
  'check_failed',
  'vault_cleared',
  'version_conflict',
  'hub_error',
  'encrypt_failed',
  'decrypt_failed',
  'passphrase_rejected',
  'invalid_cipher_package',
  'validation_failed',
  'invalid_json',
  'no_identity',
  'version_unknown',
] as const

export type VaultTelemetryKind = (typeof VAULT_TELEMETRY_KINDS)[number]
export type VaultTelemetryOutcome = (typeof VAULT_TELEMETRY_OUTCOMES)[number]
export type VaultResultCode = (typeof VAULT_RESULT_CODES)[number]

/** 运行期词表视图，供守卫测试逐项与服务端白名单比对 */
export const vaultTelemetryVocabulary = {
  kinds: VAULT_TELEMETRY_KINDS,
  outcomes: VAULT_TELEMETRY_OUTCOMES,
  codes: VAULT_RESULT_CODES,
}

export function trackVaultEvent(
  kind: VaultTelemetryKind,
  outcome: VaultTelemetryOutcome,
  code?: VaultResultCode,
): void {
  if (typeof window === 'undefined') return
  const identity = getIdentity()
  const body = JSON.stringify({ kind, outcome, ...(code ? { code } : {}), anonId: identity })
  try {
    // 身份优先走 header（shared.ts 的 identityOf 是 Header 优先、body 回退）；
    // 金库动作不是页面卸载，用 fetch(keepalive) 比 sendBeacon 更能带上 header。
    void fetch(hubUrl('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...anonHeaders(identity) },
      body,
      keepalive: true,
    }).catch(() => {
      // 埋点失败绝不冒泡：金库操作本身已经成功/失败，这一层不改变任何事实
    })
  } catch {
    // 构造请求即失败（极端环境）：静默，与 reportClick / trackPluginEvent 同口径
  }
}

/**
 * 「本机偏好 → 云端」交接的埋点字典（run45）。
 *
 * 只有被尝试过的交接才上报：云端已经有行是正常运行时，每次都发会把漏斗
 * 分母灌成噪声、也违反自己的遥测最小化承诺。
 * kind / outcome 同样必须与 telemetry.ts 的白名单逐字一致（不在名单里的 kind 直接 400）。
 */
export const SETTINGS_HANDOFF_TELEMETRY_KINDS = ['settings_handoff'] as const

export const SETTINGS_HANDOFF_TELEMETRY_OUTCOMES = ['success', 'failed'] as const

/** 失败成因：断网（请求没发出去）与中枢非 2xx 是两种纠正动作，不能同形 */
export const SETTINGS_HANDOFF_CODES = ['network_unavailable', 'hub_error'] as const

export type SettingsHandoffTelemetryKind = (typeof SETTINGS_HANDOFF_TELEMETRY_KINDS)[number]
export type SettingsHandoffTelemetryOutcome = (typeof SETTINGS_HANDOFF_TELEMETRY_OUTCOMES)[number]
export type SettingsHandoffCode = (typeof SETTINGS_HANDOFF_CODES)[number]

/** 运行期词表视图，供守卫测试与服务端白名单逐项比对 */
export const settingsHandoffTelemetryVocabulary = {
  kinds: SETTINGS_HANDOFF_TELEMETRY_KINDS,
  outcomes: SETTINGS_HANDOFF_TELEMETRY_OUTCOMES,
  codes: SETTINGS_HANDOFF_CODES,
}

export function trackSettingsHandoffEvent(
  outcome: SettingsHandoffTelemetryOutcome,
  code?: SettingsHandoffCode,
): void {
  if (typeof window === 'undefined') return
  const identity = getIdentity()
  const body = JSON.stringify({
    kind: 'settings_handoff' as SettingsHandoffTelemetryKind,
    outcome,
    ...(code ? { code } : {}),
    anonId: identity,
  })
  try {
    void fetch(hubUrl('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...anonHeaders(identity) },
      body,
      keepalive: true,
    }).catch(() => {
      // 埋点失败不改变交接事实（同 trackVaultEvent 口径）
    })
  } catch {
    // 静默
  }
}

/** 任意清单比对接口 */
export async function diffPluginManifestsApi(
  baseManifest: unknown,
  targetManifest: unknown,
): Promise<{ ok: boolean; diff: any }> {
  return sendJson('/api/plugins/diff', 'POST', { baseManifest, targetManifest })
}

/** 插件链接健康度并发体检 */
export async function checkPluginUrls(
  urls: string[],
): Promise<{
  success: boolean
  total: number
  okCount: number
  failedCount: number
  results: Array<{ url: string; ok: boolean; status: number; error?: string }>
}> {
  return sendJson('/api/plugins/check-urls', 'POST', { urls })
}

/* ------------------------------ AI 模型配置 ------------------------------ */

export type HubJsonMode = 'auto' | 'response_format' | 'prompt'

/** 备用模型视图（密钥只回显掩码） */
export interface HubLlmFallbackView {
  id: string
  enabled: boolean
  name: string
  baseUrl: string
  model: string
  hasApiKey: boolean
  apiKeyMasked: string
  timeoutMs: number
  temperature: number
  maxTokens: number
  jsonMode: HubJsonMode
  allowPrivateNetwork: boolean
  thinking?: boolean
}

/** 系统级模型配置视图（密钥只回显掩码） */
export interface HubLlmConfigView {
  configured: boolean
  source: 'db' | 'env' | 'default'
  enabled: boolean
  name: string
  baseUrl: string
  model: string
  hasApiKey: boolean
  apiKeyMasked: string
  timeoutMs: number
  temperature: number
  maxTokens: number
  jsonMode: HubJsonMode
  allowPrivateNetwork: boolean
  thinking?: boolean
  /** 观测大盘折算花费的单价（¥/1K token）；0 = 未配置，大盘写「未配置单价」 */
  costPer1kTokensRmb?: number
  fallbacks: HubLlmFallbackView[]
  updatedAt: number | null
  updatedBy: string | null
  effective?: { source: 'system' | 'env' | 'default'; name: string; model: string; baseUrl: string }
}

/** 用户级模型配置视图 */
export interface HubUserLlmConfigView {
  configured: boolean
  enabled: boolean
  name: string
  baseUrl: string
  model: string
  hasApiKey: boolean
  apiKeyMasked: string
  timeoutMs: number
  temperature: number
  maxTokens: number
  jsonMode: HubJsonMode
  thinking?: boolean
  updatedAt: number | null
  system: { source: 'db' | 'env' | 'default'; name: string; model: string }
  effective?: { source: 'user' | 'system' | 'env' | 'default'; name: string; model: string; baseUrl: string }
}

export interface HubLlmFallbackInput {
  /** 沿用已存密钥时必传（与后端 fallbacks[].id 对应） */
  id?: string
  enabled?: boolean
  name?: string
  baseUrl: string
  model: string
  apiKey?: string
  timeoutMs?: number
  temperature?: number
  maxTokens?: number
  jsonMode?: HubJsonMode
  allowPrivateNetwork?: boolean
}

export interface HubLlmConfigInput {
  enabled?: boolean
  name?: string
  baseUrl: string
  model: string
  /** 省略 = 保持原密钥；空串 = 清除；非空 = 覆盖 */
  apiKey?: string
  timeoutMs?: number
  temperature?: number
  maxTokens?: number
  jsonMode?: HubJsonMode
  allowPrivateNetwork?: boolean
  /** 观测大盘折算花费的单价（¥/1K token）；填 0 = 清除，大盘回落到「未配置单价」 */
  costPer1kTokensRmb?: number
  /** 备用模型池（整表替换；最多 3 个） */
  fallbacks?: HubLlmFallbackInput[]
}

export interface HubLlmTestResult {
  ok: boolean
  latencyMs: number
  model: string
  replyPreview: string
  error?: string
  code?: string
  status?: number
}

export interface HubAdminLlmConfigResponse {
  config: HubLlmConfigView
  effective: { source: 'user' | 'system' | 'env' | 'default'; name?: string; model: string; hasApiKey: boolean }
}

export async function fetchAdminLlmConfig(): Promise<HubAdminLlmConfigResponse> {
  return getJson('/api/admin/ai/config')
}

export async function saveAdminLlmConfig(input: HubLlmConfigInput): Promise<{ config: HubLlmConfigView }> {
  return sendJson('/api/admin/ai/config', 'PUT', input)
}

export async function resetAdminLlmConfig(): Promise<{ config: HubLlmConfigView }> {
  return sendJson('/api/admin/ai/config/reset', 'POST', {})
}

export async function testAdminLlmConfig(input: HubLlmConfigInput): Promise<{ result: HubLlmTestResult }> {
  return sendJson('/api/admin/ai/config/test', 'POST', input)
}

function identityHeaders(identity: string): Record<string, string> {
  return { 'X-Navhub-Anon-Id': identity }
}

export async function fetchUserLlmConfig(identity: string): Promise<{ config: HubUserLlmConfigView }> {
  return getJson(
    '/api/user/ai/config',
    undefined,
    identityHeaders(identity),
  )
}

export async function saveUserLlmConfig(
  identity: string,
  input: HubLlmConfigInput,
): Promise<{ config: HubUserLlmConfigView }> {
  return sendJson(
    '/api/user/ai/config',
    'PUT',
    input,
    undefined,
    identityHeaders(identity),
  )
}

export async function deleteUserLlmConfig(identity: string): Promise<{ config: HubUserLlmConfigView }> {
  return sendJson(
    '/api/user/ai/config',
    'DELETE',
    undefined,
    undefined,
    identityHeaders(identity),
  )
}

export async function testUserLlmConfig(
  identity: string,
  input: HubLlmConfigInput,
): Promise<{ result: HubLlmTestResult }> {
  return sendJson(
    '/api/user/ai/config/test',
    'POST',
    input,
    undefined,
    identityHeaders(identity),
  )
}

export interface HubAiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface HubAiChatResult {
  reply: string
  reasoningContent?: string
  model: string
  source: 'user' | 'system' | 'env' | 'default'
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
}

/** 个人试聊与 Copilot 问答：按解析链（个人 → 系统 → 环境，含备用池）调用模型 */
export async function chatWithUserLlm(
  identity: string,
  messages: HubAiChatMessage[],
  maxTokens?: number,
  context?: { activeTab?: string; categories?: string[] },
  thinking?: boolean,
): Promise<HubAiChatResult> {
  return sendJson(
    '/api/user/ai/chat',
    'POST',
    {
      messages,
      ...(maxTokens ? { maxTokens } : {}),
      ...(context ? { context } : {}),
      ...(thinking !== undefined ? { thinking } : {}),
    },
    undefined,
    identityHeaders(identity),
  )
}

export interface HubAiCanvasGenerateResult {
  success: boolean
  layout: {
    version: number
    updatedAt: number
    title: string
    description?: string
    rationale?: string
    widgets: Array<{
      id: string
      type: string
      customTitle?: string
      colSpan: number
      rowSpan: number
      config: Record<string, unknown>
      createdAt: number
    }>
  }
  model: string
  latencyMs: number
  /**
   * 模型规划了但本部署没有对应卡片的模块类型（已丢弃、不会出现在 layout.widgets 里）。
   * 后端只返回这个字段时前端必须说出来：否则用户只会觉得「AI 少给我排了几张卡」。
   */
  droppedTypes?: string[]
}

/** 一句话自然语言规划并生成模块化工作台画布 */
export async function generateAiCanvas(
  identity: string,
  prompt: string,
  categories?: string[],
): Promise<HubAiCanvasGenerateResult> {
  return sendJson(
    '/api/user/ai/canvas/generate',
    'POST',
    { prompt, ...(categories ? { categories } : {}) },
    undefined,
    identityHeaders(identity),
  )
}

/* ------------------------------ Wayback 时间机器自愈 ------------------------------ */

export interface HubWaybackInfo {
  ok: boolean
  siteId: string
  url: string
  snapshot: {
    available: boolean
    url?: string
    timestamp?: string
    status?: number
  }
  recoveryUrl: string
  saveUrl: string
  error?: string
}

export interface HubWaybackHealResult {
  ok: boolean
  healed: boolean
  site?: HubSite
  recoveryUrl?: string
  saveUrl?: string
  snapshot?: {
    available: boolean
    url?: string
    timestamp?: string
    status?: number
  }
  message?: string
  error?: string
}

/** 查询站点的 Wayback 历史归档快照 */
export async function fetchSiteWayback(siteId: string): Promise<HubWaybackInfo> {
  return getJson<HubWaybackInfo>(`/api/sites/${encodeURIComponent(siteId)}/wayback`)
}

/** 一键自愈死链站点为 Wayback Machine 历史快照镜像 */
export async function healSiteWayback(
  siteId: string,
  options: { replaceUrl?: boolean; markActive?: boolean } = { replaceUrl: true, markActive: true }
): Promise<HubWaybackHealResult> {
  return sendJson<HubWaybackHealResult>(`/api/sites/${encodeURIComponent(siteId)}/wayback/heal`, 'POST', options)
}

/* ------------------------------ 开放生态 2.0: Taps 远程订阅源 & 安全审计 ------------------------------ */

/** 管理面订阅源条目：形状取生成契约（GET /api/plugins/taps） */
export type HubPluginTap = PluginTapsResponse['items'][number]
/** 公开面订阅源条目：没有 url（凭据不外发），不能与管理面条目混为一谈 */
export type HubPublicPluginTap = PublicPluginTapsResponse['items'][number]

export interface HubPluginAuditReport {
  slug: string
  score: number
  level: 'safe' | 'low_risk' | 'medium_risk' | 'high_risk'
  verifiedAuthor: boolean
  checks: Array<{
    name: string
    passed: boolean
    detail: string
    /** 这一项本次根本没跑：不等于通过，也不等于失败 */
    skipped?: boolean
  }>
  auditedAt: number
  decision?: 'approve' | 'reject' | 'pending_review'
  aiRationale?: string
  /**
   * null = 该维度未测量；0 = 测了且不及格。渲染时两者必须分开，
   * 否则「AI 没审」会被显示成「合规 0 分」这种更吓人的假信息。
   */
  dimensionScores?: {
    security: number
    availability: number | null
    compliance: number | null
    relevance: number | null
  }
  linkSurvivalRate?: number | null
  suggestions?: string[]
  model?: string
  /** 模型是否真的给出了合规/相关性结论 */
  llmReviewed?: boolean
  /** 模型审理被跳过的原因；not_audited = 这份报告只有静态清单 */
  reviewSkipped?: 'quota' | 'unconfigured' | 'error' | 'not_audited' | null
  /** 分数口径：full=四维齐全；static_plus_probe=模型缺席；static_only=连探活也没跑 */
  scoreBasis?: 'full' | 'static_plus_probe' | 'static_only'
  quota?: {
    scope: string
    metric: string
    limit: number
    used: number
    retryAfterSeconds: number
  } | null
}

/** 精选推荐源条目：形状取生成契约的 featuredTaps */
export type HubFeaturedTapItem = PluginTapsResponse['featuredTaps'][number]

export interface HubSeedCatalogStatus {
  ok: boolean
  catalogVersion: string
  totalCatalog: number
  missingCount: number
  needUpdateCount: number
  upToDateCount: number
  hasAvailableUpdates: boolean
}

export interface HubSeedSyncResult {
  ok: boolean
  summary: {
    total: number
    added: number
    updated: number
    upToDate: number
    failed: number
  }
  details: Array<{
    slug: string
    action: "added" | "updated" | "up_to_date" | "failed"
    version: string
    error?: string
  }>
  syncedAt: number
}

/** 获取已配置的远程插件市场订阅源列表（附带官方推荐源；管理面才带 url） */
export async function fetchPluginTaps(): Promise<PluginTapsResponse> {
  return getJson<PluginTapsResponse>('/api/plugins/taps')
}

/** 公开获取可读的 Taps 与官方推荐精选源（不依赖管理员权限；条目不含 url） */
export async function fetchPublicPluginTaps(): Promise<PublicPluginTapsResponse> {
  return getJson<PublicPluginTapsResponse>('/api/plugins/taps/public')
}

/** 获取官方插件资源库同步状态 */
export async function fetchOfficialSeedStatus(): Promise<HubSeedCatalogStatus> {
  return getJson<HubSeedCatalogStatus>('/api/admin/plugins/seed-status')
}

/** 一键增量无损同步官方最新插件资源库 */
export async function syncOfficialSeedCatalog(): Promise<HubSeedSyncResult> {
  return sendJson<HubSeedSyncResult>('/api/admin/plugins/seed-sync', 'POST')
}

/** 添加远程插件市场订阅源 */
export async function addPluginTap(data: {
  name: string
  url: string
  description?: string
}): Promise<{ ok: boolean; tap: HubPluginTap }> {
  return sendJson<{ ok: boolean; tap: HubPluginTap }>('/api/plugins/taps', 'POST', data)
}

/** 删除指定的远程插件市场订阅源 */
export async function deletePluginTap(id: string): Promise<{ ok: boolean }> {
  return sendJson<{ ok: boolean }>(`/api/plugins/taps/${encodeURIComponent(id)}`, 'DELETE')
}

/** 同步指定的远程插件市场订阅源 */
export interface PluginTapSyncResult {
  ok: boolean
  /** 订阅源清单里的条目总数 */
  fetchedCount: number
  /** 真正进入处理流程的条数（被 importCap 截断时小于 fetchedCount） */
  processedCount: number
  importedCount: number
  /** 远程版本更新同步条数 */
  updatedCount?: number
  /** 市场里已有同名插件：本源这次没有新增 */
  skippedDuplicate: number
  /** 清单校验不通过被拒收 */
  rejectedInvalid: number
  /** 校验通过但写库失败 */
  failedWrite: number
  truncated: boolean
  importCap: number
  tap: HubPluginTap
}

export async function syncPluginTap(id: string): Promise<PluginTapSyncResult> {
  return sendJson<PluginTapSyncResult>(`/api/plugins/taps/${encodeURIComponent(id)}/sync`, 'POST')
}

/** 获取插件的全自动代码与外链安全扫描报告 */
export async function fetchPluginAudit(slug: string): Promise<{ ok: boolean; report: HubPluginAuditReport }> {
  return getJson<{ ok: boolean; report: HubPluginAuditReport }>(`/api/plugins/${encodeURIComponent(slug)}/audit`)
}

/* ------------------------------------------------------------------ *
 * Phase 4: AI 效能与 Token 遥测大盘 (AI Observability)
 * ------------------------------------------------------------------ */

export interface HubAiScenarioStat {
  scenario: string
  name: string
  count: number
  tokens: number
  avgLatencyMs: number
}

export interface HubAiHourlyTrendPoint {
  time: string
  calls: number
  tokens: number
  latencyMs: number
}

export interface HubAiInvocationLog {
  id: string
  timestamp: number
  scenario: string
  model: string
  source: string
  latencyMs: number
  tokens: number
  promptTokens?: number
  completionTokens?: number
  status: 'success' | 'error'
  error?: string
}

/** 额度档位的一根计量条：limit=0 表示该档未启用 */
export interface HubAiQuotaMeter {
  limit: number
  /** null = 这一档整体用量测不出来（单身份档是按人分别限的，合并总数无意义） */
  used: number | null
}

/** 24 小时滚动额度闸门的实时状态，来自主中枢配置与 llm_usage 明细 */
export interface HubAiQuotaSnapshot {
  windowHours: number
  identity: { calls: HubAiQuotaMeter; tokens: HubAiQuotaMeter }
  anonymous: { calls: HubAiQuotaMeter; tokens: HubAiQuotaMeter }
  system: { calls: HubAiQuotaMeter; tokens: HubAiQuotaMeter }
}

export interface HubAiObservabilityResponse {
  hasData?: boolean
  window: string
  totalCalls: number
  successCalls: number
  errorCalls: number
  thinkingCalls?: number
  successRate: number
  avgLatencyMs: number
  p95LatencyMs: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  /**
   * 只有在管理端显式配了 `NAVHUB_LLM_COST_PER_1K_TOKENS` 时才有数值。
   * 以前这里无条件按一个凭空写的单价折算，面板上的 ¥ 数不可信也不可变。
   */
  estimatedCostRmb: number | null
  costUnitPriceRmb?: number | null
  /** 当前真正生效的模型名；没配到就回 null，由界面写「未采集到模型名」 */
  activeModel: string | null
  quota?: HubAiQuotaSnapshot | null
  byScenario: HubAiScenarioStat[]
  hourlyTrend: HubAiHourlyTrendPoint[]
  recentLogs: HubAiInvocationLog[]
}

export async function fetchAdminAiObservability(window = '24h'): Promise<HubAiObservabilityResponse> {
  return getJson<HubAiObservabilityResponse>(`/api/admin/ai/observability?window=${encodeURIComponent(window)}`)
}

/* ------------------------------------------------------------------ *
 * Phase 4: 多租户团队空间与 RBAC 权限规范 (Workspaces & RBAC)
 * ------------------------------------------------------------------ */

export type HubWorkspaceRole = 'owner' | 'maintainer' | 'member' | 'viewer'
export type HubWorkspaceType = 'personal' | 'team'

export interface HubWorkspace {
  id: string
  name: string
  slug: string
  description?: string
  type: HubWorkspaceType
  role: HubWorkspaceRole
  icon?: string
  memberCount: number
  isDefault?: boolean
  createdAt: number
  updatedAt: number
}

export interface HubWorkspaceMember {
  userId: string
  username: string
  role: HubWorkspaceRole
  joinedAt: number
  avatar?: string
  email?: string
}

export async function fetchWorkspaces(): Promise<{ ok: boolean; items: HubWorkspace[] }> {
  return getJson<{ ok: boolean; items: HubWorkspace[] }>('/api/workspaces')
}

export async function createWorkspace(data: {
  name: string
  slug?: string
  description?: string
  type?: 'personal' | 'team'
}): Promise<{ ok: boolean; workspace: HubWorkspace }> {
  return sendJson<{ ok: boolean; workspace: HubWorkspace }>('/api/workspaces', 'POST', data)
}

export async function fetchWorkspaceMembers(id: string): Promise<{
  ok: boolean
  workspaceId: string
  members: HubWorkspaceMember[]
  permissions: Record<string, boolean>
}> {
  return getJson<{
    ok: boolean
    workspaceId: string
    members: HubWorkspaceMember[]
    permissions: Record<string, boolean>
  }>(`/api/workspaces/${encodeURIComponent(id)}/members`)
}

export async function addWorkspaceMember(
  id: string,
  data: { username: string; role: HubWorkspaceRole; email?: string }
): Promise<{ ok: boolean; members: HubWorkspaceMember[] }> {
  return sendJson<{ ok: boolean; members: HubWorkspaceMember[] }>(
    `/api/workspaces/${encodeURIComponent(id)}/members`,
    'POST',
    data
  )
}

export async function removeWorkspaceMember(
  id: string,
  userId: string
): Promise<{ ok: boolean; members: HubWorkspaceMember[] }> {
  return sendJson<{ ok: boolean; members: HubWorkspaceMember[] }>(
    `/api/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    'DELETE'
  )
}

/* ------------------------------------------------------------------ *
 * Phase 4: CRDT 多端协同漫游 (CRDT Sync)
 * ------------------------------------------------------------------ */

export async function fetchCrdtSync(identity?: string): Promise<{ ok: boolean; operations: any[]; state: any }> {
  const url = identity ? `/api/crdt/sync?userId=${encodeURIComponent(identity)}` : '/api/crdt/sync'
  return getJson<{ ok: boolean; operations: any[]; state: any }>(url)
}

export async function pushCrdtSync(
  operations: any[],
  identity?: string
): Promise<{ ok: boolean; operations: any[]; state: any; mergedCount?: number }> {
  const url = identity ? `/api/crdt/sync?userId=${encodeURIComponent(identity)}` : '/api/crdt/sync'
  return sendJson<{ ok: boolean; operations: any[]; state: any; mergedCount?: number }>(url, 'POST', { operations })
}

/* ------------------------------------------------------------------ *
 * 站点自治巡检与无感自愈 (Autonomous Health Audit & Self-Healing)
 * ------------------------------------------------------------------ */

export interface HubSiteHealthIssue {
  siteId: string
  url: string
  title: string
  status: 'broken' | 'pending' | 'archived' | 'active'
  statusCode?: number
  cause: string
  severity: 'critical' | 'warning' | 'temporary'
  description: string
  diagnosedAt: number
  waybackRecoveryUrl?: string
  suggestedReplacements?: Array<{
    id: string
    title: string
    url: string
    reason: string
    matchScore: number
  }>
  recommendedAction: 'wayback_fallback' | 'redirect_to_alternative' | 'archive_and_notify'
  autoResolvable: boolean
}

export interface HubSiteHealthSummary {
  scannedAt: number
  totalSites: number
  activeCount: number
  brokenCount: number
  healthScore: number
  issues: HubSiteHealthIssue[]
}

export async function fetchSiteHealthAuditReport(): Promise<{ ok: boolean; summary: HubSiteHealthSummary }> {
  return getJson<{ ok: boolean; summary: HubSiteHealthSummary }>('/api/admin/audit/report')
}

export async function runSiteHealthScan(): Promise<{ ok: boolean; scanned: number; summary: HubSiteHealthSummary }> {
  return sendJson<{ ok: boolean; scanned: number; summary: HubSiteHealthSummary }>('/api/admin/audit/scan', 'POST', {})
}

export async function applySiteHealingAction(data: {
  siteId: string
  action: 'wayback' | 'replacement' | 'dismiss'
  targetUrl?: string
  targetTitle?: string
}): Promise<{ ok: boolean; action: string; site?: any }> {
  return sendJson<{ ok: boolean; action: string; site?: any }>('/api/admin/audit/apply', 'POST', data)
}

export async function recommendSiteAlternatives(siteId: string): Promise<{
  ok: boolean
  siteId: string
  /** 真实模型名，或哨兵 `fallback-heuristics`（本次是同类活跃站点兜底，没有模型参与） */
  model: string
  recommendations: Array<{ title: string; url: string; reason: string }>
  aiDegraded?: 'quota' | 'error'
  degradedReason?: string
  quota?: {
    scope: string
    metric: string
    limit: number
    used: number
    retryAfterSeconds: number
  } | null
}> {
  return sendJson<{
    ok: boolean
    siteId: string
    model: string
    recommendations: Array<{ title: string; url: string; reason: string }>
    aiDegraded?: 'quota' | 'error'
    degradedReason?: string
    quota?: {
      scope: string
      metric: string
      limit: number
      used: number
      retryAfterSeconds: number
    } | null
  }>(`/api/sites/${encodeURIComponent(siteId)}/recommend-alternative`, 'POST', {})
}

export interface SiteKnowledgeNode {
  id: string
  label: string
  type: 'category' | 'site' | 'tag'
  category?: string
  url?: string
  size?: number
  importance?: number
}

export interface SiteKnowledgeEdge {
  source: string
  target: string
  type: 'belongs_to' | 'tagged_with' | 'alternative_to' | 'complements' | 'cross_link'
  weight?: number
}

export interface SiteKnowledgeMesh {
  nodes: SiteKnowledgeNode[]
  edges: SiteKnowledgeEdge[]
  stats: {
    totalNodes: number
    totalEdges: number
    categoryCount: number
    siteCount: number
  }
}

export interface TechGraphStep {
  from: string
  to: string
  relation: string
  direction: 'outgoing' | 'incoming'
  description?: string
}

export interface TechGraphPath {
  from: string
  to: string
  found: boolean
  steps: TechGraphStep[]
  distance: number
}

export interface SiteDuplicatePair {
  siteA: { id: string; title: string; url: string; categoryId?: string }
  siteB: { id: string; title: string; url: string; categoryId?: string }
  similarity: number
  reason: string
  suggestedAction: 'merge_tags' | 'remove_redundant' | 'keep_both'
}

export interface SiteDuplicateReport {
  scannedCount: number
  duplicatePairs: SiteDuplicatePair[]
  highConfidenceCount: number
}

export interface SiteOfflineArchive {
  siteId: string
  url: string
  title: string
  capturedAt: number
  contentLength: number
  readTimeMinutes: number
  htmlContent: string
  plainText: string
  meta: {
    author?: string
    description?: string
    favicon?: string
    keywords?: string[]
  }
}

export async function fetchKnowledgeMesh(): Promise<{ ok: boolean; mesh: SiteKnowledgeMesh }> {
  const raw = await getJson<any>('/api/graph/mesh')
  if (raw && raw.mesh && Array.isArray(raw.mesh.nodes)) {
    return { ok: true, mesh: raw.mesh }
  }
  if (raw && Array.isArray(raw.nodes)) {
    return {
      ok: true,
      mesh: {
        nodes: raw.nodes.map((n: any) => ({
          ...n,
          label: n.label || n.name || n.id,
          category: n.category || (n.categoryId ? `cat_${n.categoryId}` : undefined),
        })),
        edges: raw.edges || [],
        stats: raw.stats || { totalNodes: raw.nodes.length, totalEdges: (raw.edges || []).length, categoryCount: 0, siteCount: 0 },
      },
    }
  }
  return { ok: false, mesh: { nodes: [], edges: [], stats: { totalNodes: 0, totalEdges: 0, categoryCount: 0, siteCount: 0 } } }
}

export async function findTechGraphPath(start: string, target: string): Promise<{ ok: boolean; path: TechGraphPath; result: TechGraphPath }> {
  const raw = await getJson<any>(
    `/api/graph/path?start=${encodeURIComponent(start)}&target=${encodeURIComponent(target)}`
  )
  const payload = raw?.path || raw?.result || raw
  const normalized: TechGraphPath = {
    found: Boolean(payload?.found),
    from: String(payload?.from || payload?.startId || start),
    to: String(payload?.to || payload?.targetId || target),
    distance: typeof payload?.distance === 'number' ? payload.distance : 0,
    steps: Array.isArray(payload?.steps)
      ? payload.steps.map((s: any) => ({
          from: String(s.from || s.fromNode?.name || s.fromNode?.id || ''),
          to: String(s.to || s.toNode?.name || s.toNode?.id || ''),
          relation: String(s.relation || ''),
          direction: s.direction === 'incoming' ? 'incoming' : 'outgoing',
          description: s.description,
        }))
      : [],
  }
  return { ok: Boolean(raw?.ok ?? true), path: normalized, result: normalized }
}

export async function fetchSiteDuplicates(): Promise<{ ok: boolean; report: SiteDuplicateReport }> {
  const raw = await getJson<any>('/api/sites/duplicates')
  const base = raw?.report || raw
  if (base && Array.isArray(base.duplicatePairs)) {
    const pairs: SiteDuplicatePair[] = base.duplicatePairs.map((p: any) => ({
      siteA: p.siteA || { id: p.idA, title: p.titleA, url: p.urlA, categoryId: p.categoryA },
      siteB: p.siteB || { id: p.idB, title: p.titleB, url: p.urlB, categoryId: p.categoryB },
      similarity: Number(p.similarity) || 0,
      reason: String(p.reason || ''),
      suggestedAction:
        p.suggestedAction ||
        (p.recommendation === 'merge' ? 'merge_tags' : p.recommendation === 'archive_b' ? 'remove_redundant' : 'keep_both'),
    }))
    return {
      ok: true,
      report: {
        scannedCount: Number(base.scannedCount) || 0,
        duplicatePairs: pairs,
        highConfidenceCount:
          typeof base.highConfidenceCount === 'number'
            ? base.highConfidenceCount
            : pairs.filter((x) => x.similarity >= 0.85).length,
      },
    }
  }
  return { ok: false, report: { scannedCount: 0, duplicatePairs: [], highConfidenceCount: 0 } }
}

function normalizeArchivePayload(raw: any): { ok: boolean; archive: SiteOfflineArchive } {
  const base = raw?.archive || raw
  if (!base || typeof base !== 'object' || !base.siteId) {
    return { ok: false, archive: null as unknown as SiteOfflineArchive }
  }
  const htmlContent = String(base.htmlContent || '')
  const plainText =
    typeof base.plainText === 'string' && base.plainText.trim()
      ? base.plainText
      : String(base.excerpt || htmlContent.replace(/<[^>]+>/g, ' ').trim())
  return {
    ok: true,
    archive: {
      siteId: String(base.siteId),
      url: String(base.url || ''),
      title: String(base.title || ''),
      capturedAt: Number(base.capturedAt) || Date.now(),
      contentLength: Number(base.contentLength) || Number(base.byteSize) || plainText.length || htmlContent.length,
      readTimeMinutes: Number(base.readTimeMinutes) || 1,
      htmlContent,
      plainText,
      meta: base.meta || {
        description: base.excerpt || undefined,
        keywords: Array.isArray(base.tags) ? base.tags : [],
      },
    },
  }
}

export async function fetchSiteArchive(siteId: string): Promise<{ ok: boolean; archive: SiteOfflineArchive }> {
  const raw = await getJson<any>(`/api/sites/${encodeURIComponent(siteId)}/archive`)
  return normalizeArchivePayload(raw)
}

export async function createSiteArchive(siteId: string): Promise<{ ok: boolean; archive: SiteOfflineArchive }> {
  const raw = await sendJson<any>(`/api/sites/${encodeURIComponent(siteId)}/archive`, 'POST', {})
  return normalizeArchivePayload(raw)
}

export interface CopilotChatResponse {
  ok: boolean
  reply: string
  reasoningContent?: string
  /**
   * 真实模型名，或哨兵 `local-heuristic-match`（本次由站内关键词匹配兜底，
   * 没有模型参与）。UI 显示来源时必须用它，不能再配一句「AI 已回答」。
   */
  model: string
  suggestions: string[]
  error?: string
  /**
   * 降级原因：quota=今日额度用尽 / unconfigured=未配置模型 / error=模型调用失败。
   * 有值时 `model` 必为 local-heuristic-match。
   */
  degraded?: 'quota' | 'unconfigured' | 'error'
  /** degraded=quota 时的额度明细（恢复时间来自后端窗口，不是前端猜） */
  quota?: {
    scope: 'identity' | 'anonymous' | 'system'
    metric: 'calls' | 'tokens'
    limit: number
    used: number
    retryAfterSeconds: number
  } | null
}

/**
 * 上游网关的「取消」哨兵（兜底用）。
 *
 * 后端 `packages/ai` 已在模型边界把这类整段输出判成 cancelled；这里再挡一次，
 * 是为了兼容旧版中枢 / 第三方网关：它们可能直接回 200 + content="用户已取消"。
 * 只认整段相等，避免把「解释用户已取消是什么意思」的长回答误判。
 */
const CANCEL_NOTICE_RE =
  /^(用户已取消|用户取消|请求已取消|本次请求已取消|user cancelled|user canceled|cancelled by user|canceled by user|request cancelled|request canceled|operation cancelled|operation canceled)[。.!！?？]?$/i

function isUpstreamCancelNotice(text: string): boolean {
  return CANCEL_NOTICE_RE.test(text.trim())
}

export async function sendCopilotChat(
  message: string,
  history?: Array<{ role: string; content: string }>,
  options?: { thinking?: boolean; signal?: AbortSignal },
): Promise<CopilotChatResponse> {
  // signal 是给「用户中途停止」用的：sendJson 早已支持（:254），此前这里没透传，
  // 抽屉只能干等到底。中枢侧是否随之断开见 copilot 取消链路（run82 只做到前端）。
  const res = await sendJson<CopilotChatResponse>(
    '/api/copilot/chat',
    'POST',
    {
      message,
      history,
      ...(options?.thinking !== undefined ? { thinking: options.thinking } : {}),
    },
    options?.signal,
  )
  // 不把「用户已取消」渲染成模型的回答：转成可重试的失败提示。
  if (res.ok && typeof res.reply === 'string' && isUpstreamCancelNotice(res.reply)) {
    return {
      ...res,
      ok: false,
      reply: '',
      error: '上游模型中断了本次回答（不是你的操作），可直接重试。',
    }
  }
  return res
}

export interface AiPluginGenerateParams {
  prompt: string
  kind?: PluginKind | 'auto'
  thinking?: boolean
  existingManifest?: any
  changelogNote?: string
}

export interface AiPluginGenerateResponse {
  success: boolean
  manifest?: PluginManifest
  summary?: any
  rationale?: string
  reasoningContent?: string
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  latencyMs?: number
  error?: string
  errors?: string[]
}

export async function generateAiPlugin(params: AiPluginGenerateParams): Promise<AiPluginGenerateResponse> {
  const effectiveIdentity = typeof window !== 'undefined' ? getIdentity() : undefined
  return sendJson<AiPluginGenerateResponse>(
    `/api/user/ai/plugin/generate`,
    'POST',
    params,
    undefined,
    effectiveIdentity ? anonHeaders(effectiveIdentity) : undefined,
  )
}

