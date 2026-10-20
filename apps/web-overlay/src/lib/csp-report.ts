/**
 * CSP 违规上报的纯逻辑（解析 / 脱敏 / 限流）。
 *
 * 为什么要自建收集端点：CSP 收敛必须先在预发跑 report-only 观察真实违规，
 * 但很多自托管部署没有外部上报服务。收集端点必须「有界」：
 * 请求体有上限、单 IP 有速率限制、全局有速率上限，且日志里不落
 * 带 query 的完整 URL（query 里可能带 token）。
 */

export const MAX_REPORT_BODY_BYTES = 64 * 1024
export const PER_IP_PER_MINUTE = 60
export const GLOBAL_PER_MINUTE = 600
export const RATE_WINDOW_MS = 60_000

export interface CspViolationSummary {
  blockedUri: string
  violatedDirective: string
  documentUri: string
  sourceFile: string
  lineNumber: number | null
  disposition: string
}

/** 去掉 query/hash 并截断，避免把 URL 里的 token 写进日志。 */
export function sanitizeUri(value: unknown, max = 200): string {
  if (typeof value !== 'string' || value === '') return ''
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '')
  const withoutQuery = cleaned.split('#')[0]!.split('?')[0]!
  return withoutQuery.length > max ? withoutQuery.slice(0, max) + '…' : withoutQuery
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asLineNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 同时兼容两种上报格式：
 *  - report-uri：`{"csp-report": {...}}`
 *  - report-to：`{"type":"csp-violation","body":{...}}`
 */
export function parseCspReport(raw: string): CspViolationSummary | null {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  const root = payload as Record<string, unknown>
  const envelope = root['csp-report']
  const body =
    envelope && typeof envelope === 'object'
      ? (envelope as Record<string, unknown>)
      : root.type === 'csp-violation' && root.body && typeof root.body === 'object'
        ? (root.body as Record<string, unknown>)
        : null
  if (!body) return null

  return {
    blockedUri: sanitizeUri(body['blocked-uri'] ?? body.blockedURL),
    violatedDirective: asString(body['violated-directive'] ?? body.effectiveDirective),
    documentUri: sanitizeUri(body['document-uri'] ?? body.documentURL),
    sourceFile: sanitizeUri(body['source-file'] ?? body.sourceFile),
    lineNumber: asLineNumber(body['line-number'] ?? body.lineNumber),
    disposition: asString(body.disposition),
  }
}

/** 极简滑动窗口限流：单 IP + 全局双闸，超限返回 false。 */
export class RateLimiter {
  private hits = new Map<string, number[]>()
  private global: number[] = []

  constructor(
    private readonly perKeyLimit: number = PER_IP_PER_MINUTE,
    private readonly globalLimit: number = GLOBAL_PER_MINUTE,
    private readonly windowMs: number = RATE_WINDOW_MS,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs
    this.global = this.global.filter((t) => t > cutoff)
    if (this.global.length >= this.globalLimit) return false

    const bucket = (this.hits.get(key) ?? []).filter((t) => t > cutoff)
    if (bucket.length >= this.perKeyLimit) {
      this.hits.set(key, bucket)
      return false
    }
    bucket.push(now)
    this.hits.set(key, bucket)

    // 控制内存占用：只保留最近有命中的 key
    if (this.hits.size > 10_000) {
      for (const [k, times] of this.hits) {
        if (times.every((t) => t <= cutoff)) this.hits.delete(k)
      }
    }
    this.global.push(now)
    return true
  }

  reset(): void {
    this.hits.clear()
    this.global = []
  }
}

/** 读取请求体，超过上限立即截断并标记越界。 */
export async function readCappedBody(
  request: Request,
  maxBytes: number = MAX_REPORT_BODY_BYTES,
): Promise<{ text: string; tooLarge: boolean }> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { text: '', tooLarge: true }
  }
  const body = request.body
  if (!body) {
    const text = await request.text()
    return { text, tooLarge: text.length > maxBytes }
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let tooLarge = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      tooLarge = true
      await reader.cancel().catch(() => {
        // 取消失败不影响结论：正文已超限，直接按 413 处理
      })
      break
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(merged), tooLarge }
}
