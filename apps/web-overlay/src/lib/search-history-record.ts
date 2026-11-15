/**
 * 页内即时筛选的查询记录（轻量版发送端）。
 *
 * 从 lib/navhub-api.ts 拆出：/sites 首屏经 lib/local-search-record.ts
 * 只需要 `recordLocalSearchHistory` 这一条记录入口，却因此把 134KB 的
 * navhub-api.ts 整个值 import 进首屏 chunk（CI /sites 与 /sites/p/[n]
 * 各超预算 57KB）。本模块只依赖 fetch + 轻量开关读取
 *（`./user-settings` 的 import 链只有零依赖的 favorites-storage /
 * identity-keys / hub-identity-guard，见模块底注释），不碰 navhub-api。
 *
 * 语义与原实现一字不改：同一查询 5 分钟内重复只刷新（服务端去重）、
 * fire-and-forget（失败只返回 false，不抛错、不弹提示）。
 */

import type { DegradedHandler } from './degrade'
import { readLocalUserSettings } from './user-settings'

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
 * 时，收藏/金库/画像/历史强制绑定 "token:<id>" 身份并忽略自报 anonId；不带时
 * 回退匿名行为。token 存 localStorage 只存本机，永不进 URL。
 *
 * 安全提示：
 * - localStorage 无过期机制：token 长期有效，泄漏即长期失守；建议服务端定期轮换、
 *   用户登出/换机时调用 setApiToken(null) 清除；隐私模式写失败时静默回退匿名。
 * - 切勿把 token 拼进 URL query（会进浏览器历史/服务端访问日志/Referer）。
 */
const API_TOKEN_KEY = 'navhub_api_token'

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
function anonHeaders(identity?: string): Record<string, string> {
  return identity ? { 'X-Navhub-Anon-Id': identity } : {}
}

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

/**
 * 页内即时筛选的查询记录。
 *
 * 分类/热榜/标签/目录/合集页的筛选框是本机过滤、从不走 /api/search——
 * 不经这里记一次，用户在里面搜的词就永远进不了搜索历史。调用方传「当时
 * 实际展示的命中数」（本页筛选后的匹配数），服务端只记历史、不跑检索、
 * 不写 search 事件；同一查询 5 分钟内重复只刷新（服务端去重）。
 *
 * fire-and-forget：失败（云端不可用、开关关了）只返回 false，不抛错、
 * 不弹提示——记录历史是附带行为，不能打断用户正在做的筛选。
 */
export async function recordLocalSearchHistory(
  identity: string,
  query: string,
  resultCount: number,
  onDegraded?: DegradedHandler,
): Promise<boolean> {
  const q = query.trim()
  if (!q || !identity) return false
  return degrade(
    false,
    async () => {
      const res = await sendJson(
        '/api/search-history',
        'POST',
        {
          q,
          resultCount: Math.max(0, Math.trunc(resultCount)),
          searchHistoryEnabled: readLocalUserSettings().searchHistoryEnabled,
        },
        undefined,
        anonHeaders(identity),
      ) as { ok?: boolean; recorded?: boolean }
      return res?.ok === true && res?.recorded === true
    },
    onDegraded,
  )
}
