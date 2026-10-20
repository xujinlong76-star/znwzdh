/**
 * CSP 违规上报收集端点（report-only 阶段的落点）。
 *
 * 用法：构建时设置
 *   NAVHUB_CSP_REPORT_ONLY=1
 *   NAVHUB_CSP_REPORT_URI=/api/csp-report
 * 浏览器会把违规以 POST（application/csp-report 或 application/json）送到这里。
 *
 * 安全约束：
 *  - 只接收 POST，GET 直接 405；
 *  - 请求体上限 64 KB，超限 413；
 *  - 单 IP 60 次/分钟、全局 600 次/分钟，超限 429；
 *  - 日志只落脱敏后的字段（去掉 query/hash），不回显请求内容；
 *  - 不做任何持久化，避免端点变成可写的数据仓库。
 */
import {
  MAX_REPORT_BODY_BYTES,
  RateLimiter,
  parseCspReport,
  readCappedBody,
} from '@/lib/csp-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = new RateLimiter()

/** 尽力而为的来源识别：仅用于限流分桶，不作为安全边界。 */
function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'unknown'
}

/** 仅供测试重置限流状态。 */
export function __resetCspRateLimiter(): void {
  limiter.reset()
}

export async function POST(request: Request): Promise<Response> {
  if (!limiter.allow(clientKey(request))) {
    return new Response(null, {
      status: 429,
      headers: { 'retry-after': '60', 'cache-control': 'no-store' },
    })
  }

  const { text, tooLarge } = await readCappedBody(request, MAX_REPORT_BODY_BYTES)
  if (tooLarge) {
    return new Response(null, { status: 413, headers: { 'cache-control': 'no-store' } })
  }

  const summary = parseCspReport(text)
  if (!summary) {
    return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } })
  }

  console.warn('[csp-report] ' + JSON.stringify(summary))
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}
