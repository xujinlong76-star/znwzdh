/**
 * `/api/hub/*` 反向代理的纯逻辑。
 *
 * 与 `app/api/hub/[...path]/route.ts` 分开的原因：路由文件 import 了 `@/lib/auth`
 * （next-auth），在单测里拉起整套鉴权栈既慢又脆。这里只放"给定输入返回输出"的判定，
 * 路由负责 I/O，单测直接覆盖判定 —— 这几条判定恰恰是**用户能感知正确性**的地方：
 *
 *  1. **上游超时**：没有上限的 `fetch` 会让一个卡死的中枢（SQLite 锁等待、慢查询、
 *     挂住的 embedding 请求）把前端请求无限期挂住 —— 用户看到永远转圈，
 *     Node 侧每条悬挂请求还占着连接。仓库既有约定就是"网络调用必须有上限"
 *     （scripts/vendor-web.mjs 的 AbortSignal.timeout、Dockerfile 的 curl --max-time）。
 *     上限分两档：默认 30 秒，`isLongRunningPath` 列出的大模型/探活端点 120 秒。
 *     SSE 例外：事件流是**长连接**，拿到响应头后必须解除定时器，否则推流会被掐断。
 *  2. **缓存语义**：中枢的只读路由声明了 `cache: { maxAge, etag }` 并据此发
 *     `cache-control` / `etag`，但代理此前只透传 `content-type` —— 浏览器既拿不到
 *     ETag 做条件请求，也看不到 `no-store`，只能对 JSON 响应走启发式缓存
 *     （正是中枢 onSend 注释里点名的那类"静默正确性风险"）。
 *  3. **空体状态码**：`304/204/205` 不允许带 body。此前代理无条件回 `text || '{}'`，
 *     一旦上游真的返回 304（条件请求生效时就会发生），构造 Response 会直接抛错。
 *     修复后按 RFC 必须返回 null body。
 */

/** 可以转发给上游的请求头白名单（其余一律丢弃，避免把宿主头带进中枢） */
export const FORWARD_REQUEST_HEADERS = [
  'content-type',
  'accept',
  // 条件请求：透传 ETag 校验值，上游才能回 304 省掉重复传输
  'if-none-match',
  'authorization',
  // 终端身份头：由 proxy 统一签名后转发（此前 header-only 身份会被丢弃，
  // 导致 publish 等只带头的调用在开了 NAVHUB_IDENTITY_SECRET 后丢失归属）
  'x-navhub-user-id',
  'x-user-id',
  'x-navhub-anon-id',
  'x-anon-id',
] as const

/** 可以回传给浏览器的响应头白名单（中枢会给出缓存/校验语义） */
export const FORWARD_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'vary'] as const

/** 代理不带缓存头时的兜底值：宁可少缓存，也不要启发式缓存管理面数据 */
export const DEFAULT_RESPONSE_CACHE_CONTROL = 'no-store'

/** 上游响应上限，可用 NAVHUB_HUB_TIMEOUT_MS 覆盖（毫秒） */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000

/** 复杂 AI 规划/生成场景响应上限，可用 NAVHUB_AI_TIMEOUT_MS 覆盖（毫秒） */
export const DEFAULT_AI_UPSTREAM_TIMEOUT_MS = 120_000

/**
 * 长耗时端点白名单 —— **逐段精确匹配**。
 *
 * 上一版的判据是 `pathStr.includes('ai')`，两处都错：
 *  - 放宽错了地方：任何单词里含 `ai` 的路径（`sites/detail`、`plugins/validate`…）
 *    都被放到 120 秒，等于把卡死的普通查询也一起挂两分钟；
 *  - 收紧了真正需要时间的地方：真正的对话入口 `copilot/chat` 一个 `ai` 都不含，
 *    仍按 30 秒掐断 —— 用户问一句话只看到「中枢无响应」，而那其实是代理提前 abort。
 * 所以这里按**路径段**列举已知会打大模型 / 并发探活的端点，宁可漏列（走默认 30 秒）
 * 也不要靠子串猜。
 */
const LONG_RUNNING_ROOTS = new Set(['copilot', 'enrich'])
const LONG_RUNNING_PLUGIN_ACTIONS = new Set(['ai-audit', 'pre-audit', 'auto-fix', 'check-urls'])

export function isLongRunningPath(path: string[] | string): boolean {
  const segments = (Array.isArray(path) ? path : path.split('/')).filter(Boolean)
  if (segments.length === 0) return false
  if (LONG_RUNNING_ROOTS.has(segments[0])) return true
  if (segments[0] === 'sites' && segments[1] === 'auto') return true
  // `/plugins/:slug/ai-audit` 的动作在末段，`/plugins/pre-audit` 在第二段 → 统一看是否命中动作名
  if (segments[0] === 'plugins' && LONG_RUNNING_PLUGIN_ACTIONS.has(segments[segments.length - 1])) return true
  // 精确的 `ai` 段：/user/ai/config、/admin/ai/config、/user/ai/plugin/generate
  return segments.includes('ai')
}

/** 解析超时配置：非法/缺省时回落到默认值，不放大也不缩小到 0。长耗时端点自动放宽超时 */
export function upstreamTimeoutMs(
  raw: string | undefined = process.env.NAVHUB_HUB_TIMEOUT_MS,
  path?: string[] | string,
): number {
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return n

  if (path !== undefined && isLongRunningPath(path)) {
    const aiTimeout = Number(process.env.NAVHUB_AI_TIMEOUT_MS)
    return Number.isFinite(aiTimeout) && aiTimeout > 0 ? aiTimeout : DEFAULT_AI_UPSTREAM_TIMEOUT_MS
  }

  return DEFAULT_UPSTREAM_TIMEOUT_MS
}

/**
 * 创建一个带期限的中断信号。
 * 调用 `clear()` 解除定时器（拿到响应头之后必须调用，否则长连接会被掐断）。
 */
export function createDeadline(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

/** SSE 等长连接响应：必须流式透传，不能 `.text()` 缓冲 */
export function isStreamingContentType(contentType: string | null | undefined): boolean {
  return (contentType ?? '').includes('text/event-stream')
}

/**
 * 是否按文本读取再做 JSON 兜底。
 * 二进制响应（图片/字体等）走 `arrayBuffer`，否则 `.text()` 会按 UTF-8 解码把内容解码坏。
 */
export function isTextContentType(contentType: string | null | undefined): boolean {
  const ct = (contentType ?? '').toLowerCase()
  return (
    ct.includes('json') ||
    ct.includes('text/') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('urlencoded')
  )
}

/** HTTP 规定不允许携带响应体的状态码 */
export function isNullBodyStatus(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}

/** 转发给中枢的 X-Forwarded-For 最多保留几个条目（防头部膨胀） */
export const MAX_FORWARDED_FOR_ENTRIES = 8

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6_RE = /^[0-9a-fA-F:]+$/

/**
 * 规范化客户端传来的 `X-Forwarded-For` 之后再转给中枢。
 *
 * 为什么不能原样透传（此前就是原样透传）：该头由客户端可控。
 *  1. 可以塞任意字符串/超长内容进中枢的日志与限流键；
 *  2. 「按 IP 分桶」的限流可被伪造值直接绕过（换个假 IP 就换一个桶）。
 *
 * 这里只做**规范与瘦身**：逐个校验形状（IPv4 / IPv4:port / 裸 IPv6 / unknown），
 * 上限 8 个条目，其余一律丢弃。
 *
 * ⚠️ 诚实边界：这**不能**阻止伪造 —— 没有可信边缘时无法区分来源真假。
 * 要真正防伪造必须同时满足：前置反向代理**覆写**该头，且中枢按跳数正确配置
 * `NAVHUB_TRUST_PROXY`（见 docs/security-notes.md）。
 */
export function sanitizeForwardedFor(raw: string | null | undefined): string | null {
  if (!raw) return null
  const out: string[] = []
  for (const part of raw.split(',')) {
    const value = part.trim()
    if (!value) continue

    let host: string | null = null
    if (value === 'unknown') {
      host = 'unknown'
    } else if (IPV4_RE.test(value)) {
      host = value
    } else if (value.includes('.')) {
      // 带端口/杂质的 IPv4：仅当去掉 `:port` 后是合法 IPv4 才接受
      const stripped = value.replace(/:\d+$/, '')
      if (IPV4_RE.test(stripped)) host = stripped
    } else if (value.includes(':') && IPV6_RE.test(value)) {
      // 裸 IPv6 原样保留；`[v6]:port` 这类形式无法与内容区分，保守丢弃
      host = value
    }

    if (host) {
      out.push(host)
      if (out.length >= MAX_FORWARDED_FOR_ENTRIES) break
    }
  }
  return out.length > 0 ? out.join(', ') : null
}

/**
 * 挑出要回传给浏览器的响应头。
 * 缺 `cache-control` 时补 `no-store`：代理层不做启发式缓存的赌注。
 */
export function pickResponseHeaders(upstream: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.get(name)
    if (value) out[name] = value
  }
  if (!out['cache-control']) out['cache-control'] = DEFAULT_RESPONSE_CACHE_CONTROL
  return out
}
