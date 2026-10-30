import { NextRequest, NextResponse } from 'next/server'
import { ensureHttpsUrl, isAllowedBilivideoStreamHost } from '@/lib/video-bilibili-hd-parser'
import {
  clampRangeHeader,
  envPositiveInt,
  readWithIdleTimeout,
  StreamBudget,
} from '@/lib/stream-budget'

export const dynamic = 'force-dynamic'

const UPSTREAM_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com',
}

/**
 * 资源上限（P0-5）。
 *
 * 修复前这个代理没有任何闸门：`fetch` 不带 signal（上游挂着就一直占 socket）、
 * 响应体原样透传（无长度上限）、公开无鉴权也无限流。
 * 默认值面向公网；慢链路/压测可以用环境变量收紧或放宽。
 */
const HEADER_TIMEOUT_MS = envPositiveInt('NAVHUB_BILI_STREAM_HEADER_TIMEOUT_MS', 8_000)
const IDLE_TIMEOUT_MS = envPositiveInt('NAVHUB_BILI_STREAM_IDLE_TIMEOUT_MS', 30_000)
const MAX_RANGE_BYTES = envPositiveInt('NAVHUB_BILI_STREAM_MAX_RANGE_BYTES', 8 * 1024 * 1024)
const STREAM_BUDGET = new StreamBudget({
  maxConcurrent: envPositiveInt('NAVHUB_BILI_STREAM_MAX_CONCURRENT', 32),
  // 测试进程放宽，避免同一套件内的用例互相吃掉额度（仍可用环境变量显式收紧来测拒绝分支）
  maxPerWindow: envPositiveInt(
    'NAVHUB_BILI_STREAM_MAX_PER_MIN',
    process.env.NODE_ENV === 'test' ? 10_000 : 60
  ),
  windowMs: 60_000,
})

/** 尽力而为的标记：播放器看到它就知道失败时该回退直链，而不是死等代理 */
const STREAM_MODE_HEADER = 'X-NavHub-Stream-Mode'

function callerKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'unknown'
}

/**
 * 只给「响应头阶段」套超时。
 *
 * 不能用一个 `AbortSignal.timeout(8000)` 贯穿全程：定时器在 8 秒后会照样掐断正在
 * 播放的响应体。头到位就 clearTimeout，之后由空闲超时逐块把关。
 */
async function fetchWithHeaderTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function handleStreamProxy(request: NextRequest, method: 'GET' | 'HEAD') {
  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get('url')?.trim()

  if (!rawUrl) {
    return NextResponse.json(
      { error: '缺少视频流地址参数 url' },
      { status: 400 }
    )
  }

  const targetUrl = ensureHttpsUrl(rawUrl) || rawUrl
  if (!isAllowedBilivideoStreamHost(targetUrl)) {
    return NextResponse.json(
      { error: '非法的视频流域名，仅允许 B 站官方 CDN 节点 (*.bilivideo.com / *.hdslb.com)' },
      { status: 403 }
    )
  }

  // 预算：先按调用方限流，再看进程并发。GET 的槽位交给流自身在结束/断开时归还，
  // 其余出口统一在 finally 里归还（漏还等于把并发额度永久吃掉）。
  const denial = STREAM_BUDGET.tryAcquire(callerKey(request))
  if (denial) {
    return NextResponse.json(
      {
        error:
          denial === 'rate_limited'
            ? '请求过于频繁，请稍后重试或改用直链'
            : '视频流代理并发已满，请稍后重试或改用直链',
      },
      { status: denial === 'rate_limited' ? 429 : 503, headers: { 'Retry-After': '5' } }
    )
  }

  let handedOff = false
  try {
    const fetchHeaders = new Headers(UPSTREAM_HEADERS)
    // 单次 Range 转发封顶：`bytes=0-` 这种「整条流」的请求会被夹到 MAX_RANGE_BYTES
    const clampedRange = clampRangeHeader(request.headers.get('range'), MAX_RANGE_BYTES)
    if (clampedRange) {
      fetchHeaders.set('Range', clampedRange)
    }

    let currentUrl = targetUrl
    let upstreamRes: Response | null = null

    // 手动逐跳校验重定向，防范通过开放重定向发起的内网 SSRF 探测
    for (let hop = 0; hop < 3; hop++) {
      if (!isAllowedBilivideoStreamHost(currentUrl)) {
        return NextResponse.json(
          { error: '重定向跳转目标域名不在 B 站官方 CDN 白名单中' },
          { status: 403 }
        )
      }

      upstreamRes = await fetchWithHeaderTimeout(currentUrl, {
        method,
        headers: fetchHeaders,
        redirect: 'manual',
      }, HEADER_TIMEOUT_MS)

      if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
        const location = upstreamRes.headers.get('location')
        if (!location) break
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }
      break
    }

    if (!upstreamRes || (!upstreamRes.ok && upstreamRes.status !== 206)) {
      return NextResponse.json(
        { error: `上游视频流节点返回 HTTP ${upstreamRes?.status || 502}` },
        { status: upstreamRes?.status || 502 }
      )
    }

    const responseHeaders = new Headers()
    const contentType = upstreamRes.headers.get('content-type') || 'video/mp4'
    responseHeaders.set('Content-Type', contentType)
    responseHeaders.set('Accept-Ranges', upstreamRes.headers.get('accept-ranges') || 'bytes')
    responseHeaders.set('Cache-Control', 'private, max-age=3600')
    responseHeaders.set(STREAM_MODE_HEADER, 'best-effort')

    const contentLength = upstreamRes.headers.get('content-length')
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength)
    }

    const contentRange = upstreamRes.headers.get('content-range')
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange)
    }

    if (method === 'HEAD' || !upstreamRes.body) {
      return new NextResponse(null, { status: upstreamRes.status, headers: responseHeaders })
    }

    // 首块在响应头发出之前等待：这一步超时还能如实回 504
    const reader = upstreamRes.body.getReader()
    let first: ReadableStreamReadResult<Uint8Array>
    try {
      first = await readWithIdleTimeout(() => reader.read(), IDLE_TIMEOUT_MS)
    } catch {
      await reader.cancel().catch(() => { /* cancel 失败可忽略：这条路径本来就在放弃流（超限/类型不符），没人在等它完成 */ })
      return NextResponse.json(
        { error: '上游视频流空闲超时，未产生任何数据，请回退直链' },
        { status: 504 }
      )
    }

    handedOff = true
    let released = false
    const release = () => {
      if (released) return
      released = true
      STREAM_BUDGET.release()
    }

    let pending: ReadableStreamReadResult<Uint8Array> | null = first
    // pull 驱动：客户端读得慢就自然背压，不会把整条流缓存在内存里
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = pending ?? (await readWithIdleTimeout(() => reader.read(), IDLE_TIMEOUT_MS))
          pending = null
          if (chunk.done) {
            controller.close()
            release()
            return
          }
          if (chunk.value) controller.enqueue(chunk.value)
        } catch (err) {
          await reader.cancel().catch(() => { /* cancel 失败可忽略：这条路径本来就在放弃流（超限/类型不符），没人在等它完成 */ })
          release()
          controller.error(err instanceof Error ? err : new Error('视频流转发失败'))
        }
      },
      cancel() {
        reader.cancel().catch(() => { /* cancel 失败可忽略：这条路径本来就在放弃流（超限/类型不符），没人在等它完成 */ })
        release()
      },
    })

    return new NextResponse(stream, { status: upstreamRes.status, headers: responseHeaders })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '视频流代理连接失败' },
      { status: 502 }
    )
  } finally {
    if (!handedOff) STREAM_BUDGET.release()
  }
}

export async function GET(request: NextRequest) {
  return handleStreamProxy(request, 'GET')
}

export async function HEAD(request: NextRequest) {
  return handleStreamProxy(request, 'HEAD')
}
