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
] as const

/** 可以回传给浏览器的响应头白名单（中枢会给出缓存/校验语义） */
export const FORWARD_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'vary'] as const

/** 代理不带缓存头时的兜底值：宁可少缓存，也不要启发式缓存管理面数据 */
export const DEFAULT_RESPONSE_CACHE_CONTROL = 'no-store'

/** 上游响应上限，可用 NAVHUB_HUB_TIMEOUT_MS 覆盖（毫秒） */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000

/** 解析超时配置：非法/缺省时回落到默认值，不放大也不缩小到 0 */
export function upstreamTimeoutMs(raw: string | undefined = process.env.NAVHUB_HUB_TIMEOUT_MS): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_UPSTREAM_TIMEOUT_MS
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
