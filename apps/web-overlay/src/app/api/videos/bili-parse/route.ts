import { NextRequest, NextResponse } from 'next/server'
import { resolveBilibiliHdStream, type BilibiliHdParseInput } from '@/lib/video-bilibili-hd-parser'
import { envPositiveInt, StreamBudget } from '@/lib/stream-budget'

export const dynamic = 'force-dynamic'

/**
 * 出站预算（与 /api/videos/bili-stream 同一套原语）。
 *
 * 这是一条**匿名可访问的出站通道**：一次解析最多顺序打 6 个上游
 * （星之阁 / 米人 / B 站 WBI / 免登录 / PC / Android）。没有闸门时，任何人
 * 都能把本站当免费解析代理，而**出口 IP 被目标站拉黑的是我们**——
 * 真实用户随后看到的是「全都解析失败」。
 * 并发额度同时也在保护进程：每个在飞的解析都占着一个 Node 连接与上游配额。
 */
const PARSE_BUDGET = new StreamBudget({
  maxConcurrent: envPositiveInt('NAVHUB_BILI_PARSE_MAX_CONCURRENT', 8),
  maxPerWindow: envPositiveInt(
    'NAVHUB_BILI_PARSE_MAX_PER_MIN',
    // 测试进程放宽，避免同套件用例互吃额度（要测拒绝分支时显式用环境变量收紧）
    process.env.NODE_ENV === 'test' ? 10_000 : 12
  ),
  windowMs: 60_000,
})

/** 尽力而为的调用方标记：只用于分桶限流，不作为身份判断 */
function callerKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'unknown'
}

function denied(denial: 'rate_limited' | 'saturated'): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code: denial,
      error:
        denial === 'rate_limited'
          ? 'B 站解析请求过于频繁，请稍后再试'
          : '同时进行的解析已满，请稍后再试',
    },
    { status: denial === 'rate_limited' ? 429 : 503, headers: { 'Retry-After': '10' } },
  )
}

function parsePositiveInt(val: unknown, fallback: number = 1): number {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 1) {
    return Math.floor(val)
  }
  if (typeof val === 'string' && val.trim()) {
    const parsed = Number.parseInt(val.trim(), 10)
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed
    }
  }
  return fallback
}

/**
 * GET /api/videos/bili-parse?bvid=BV1MmUSB5Efw&p=1
 *
 * **不接受 access_key**：URL 会留在浏览器历史、反代与服务端访问日志、
 * 以及任何一层的错误上报里。B 站登录凭据只能走 POST body（见下）。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  if (searchParams.has('access_key') || searchParams.has('accessKey')) {
    return NextResponse.json(
      {
        ok: false,
        code: 'credential_in_query',
        error: 'access_key 不再通过 URL 传递（会留在访问日志与浏览器历史里），请改用 POST /api/videos/bili-parse 的请求体',
      },
      { status: 400 },
    )
  }

  const denial = PARSE_BUDGET.tryAcquire(callerKey(request))
  if (denial) return denied(denial)

  try {
    const url = searchParams.get('url') || undefined
    const bvid = searchParams.get('bvid') || undefined
    const aid = searchParams.get('aid') || undefined
    const cid = searchParams.get('cid') || undefined
    const p = parsePositiveInt(searchParams.get('p'), 1)
    const preferredEngine = (searchParams.get('engine') || searchParams.get('preferredEngine') || undefined) as any
    const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('forceRefresh') === 'true'

    if (!url && !bvid && !aid) {
      return NextResponse.json(
        { ok: false, code: 'missing_target', error: '请提供有效的 B 站视频参数（bvid、aid 或 url）' },
        { status: 400 }
      )
    }

    const result = await resolveBilibiliHdStream({
      url,
      bvid,
      aid,
      cid,
      p,
      preferredEngine,
      forceRefresh,
    })

    return NextResponse.json(result, {
      status: 200,
      headers: {
        // 解析结果按「真正出站的凭据档」分桶，但响应仍可能被不同调用方共享：
        // 只要调用方带了 key 就一律 no-store。GET 现在收不到 key，保留判据是
        // 防止将来有人又把它塞回 query。
        'Cache-Control': result.ok ? 'private, max-age=300, stale-while-revalidate=300' : 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'B 站高清视频解析失败'
    return NextResponse.json(
      { ok: false, code: 'parse_failed', error: message },
      { status: 400 }
    )
  } finally {
    PARSE_BUDGET.release()
  }
}

/**
 * POST /api/videos/bili-parse
 * Body: { url?: string, bvid?: string, aid?: string, cid?: string, p?: number, accessKey?: string, forceRefresh?: boolean }
 *
 * `accessKey` 走请求体。注意：**默认不会把它交给第三方解析站**
 * （`resolveOutboundAccessKey`），需要部署显式 `NAVHUB_BILI_FORWARD_USER_KEY=1`；
 * 被拦下时结果带 `accessKeyIgnored: true`，界面据此如实提示。
 */
export async function POST(request: NextRequest) {
  const denial = PARSE_BUDGET.tryAcquire(callerKey(request))
  if (denial) return denied(denial)

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const input: BilibiliHdParseInput = {
      url: typeof body.url === 'string' ? body.url : undefined,
      bvid: typeof body.bvid === 'string' ? body.bvid : undefined,
      aid: typeof body.aid === 'string' || typeof body.aid === 'number' ? body.aid : undefined,
      cid: typeof body.cid === 'string' || typeof body.cid === 'number' ? body.cid : undefined,
      p: parsePositiveInt(body.p, 1),
      accessKey:
        typeof body.access_key === 'string'
          ? body.access_key
          : typeof body.accessKey === 'string'
            ? body.accessKey
            : undefined,
      preferredEngine:
        typeof body.preferredEngine === 'string'
          ? (body.preferredEngine as any)
          : typeof body.engine === 'string'
            ? (body.engine as any)
            : undefined,
      forceRefresh: Boolean(body.forceRefresh),
    }

    if (!input.url && !input.bvid && !input.aid) {
      return NextResponse.json(
        { ok: false, code: 'missing_target', error: '请提供有效的 B 站视频参数（bvid、aid 或 url）' },
        { status: 400 }
      )
    }

    const result = await resolveBilibiliHdStream(input)
    return NextResponse.json(result, {
      status: 200,
      // 带凭据的请求（以及结果被缓存分桶共享的场合）绝不进任何共享缓存
      headers: {
        'Cache-Control':
          result.ok && !input.accessKey ? 'private, max-age=300, stale-while-revalidate=300' : 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'B 站高清视频解析失败'
    return NextResponse.json(
      { ok: false, code: 'parse_failed', error: message },
      { status: 400 }
    )
  } finally {
    PARSE_BUDGET.release()
  }
}
