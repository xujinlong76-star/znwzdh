import { NextResponse, type NextRequest } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import {
  FORWARD_REQUEST_HEADERS,
  createDeadline,
  isNullBodyStatus,
  isStreamingContentType,
  isTextContentType,
  pickResponseHeaders,
  sanitizeForwardedFor,
  upstreamTimeoutMs,
} from '@/lib/hub-proxy'
import { hubIdentitySecret, identityFromRequest, signIdentity } from '@/lib/identity-signature'

/**
 * /api/hub/* 代理：把请求转发到 NavHub 中枢。
 *
 * 为什么用路由而不是 next.config.js 的 rewrite：
 *   rewrite 的目标地址在**构建期**求值并固化——改了中枢地址必须重新构建前端。
 *   本路由在**运行时**读 NAVHUB_STORAGE_BASE_URL，中枢换地址只需重启前端进程。
 *   （Docker 里该变量由 compose 注入，构建与运行一致；本地开发指向 localhost:8787。）
 *
 * 与浏览器通信走同源相对路径，因此没有 CORS 问题，
 * 也兼容 docker 内部主机名（api:8787 浏览器解析不了，但服务端能）。
 *
 * HTTP 语义（超时 / 缓存头 / 空体状态码）的判定在 @/lib/hub-proxy，那里有单测。
 */

const HUB_BASE = (
  process.env.NAVHUB_STORAGE_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787'
).replace(/\/$/, '')

/** body 上限 ~1MB，防止代理被大体拖死 */
const MAX_BODY_BYTES = 1024 * 1024

async function forward(request: NextRequest, path: string[]): Promise<Response> {
  const url = new URL(request.url)
  const cleanPath = path[0] === 'api' ? path.slice(1) : path
  const normalizedBase = HUB_BASE.endsWith('/api') ? HUB_BASE.slice(0, -4) : HUB_BASE
  const target = normalizedBase + '/api/' + cleanPath.join('/') + url.search

  const headers: Record<string, string> = { Accept: 'application/json' }
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(h)
    if (v) headers[h] = v
  }

  // 会话信任委托：客户端未显式携带 Authorization 时，检查是否存在已通过 NextAuth 登录的合法管理员。
  // 若身份校验通过，自动注入服务端管理凭据转发至中枢，避免管理后台因无本地 Token 而遭遇鉴权死锁。
  if (!headers['authorization']) {
    try {
      const adminCheck = await verifyAdminSession()
      if (adminCheck.ok) {
        const delegated =
          process.env.NAVHUB_BOOTSTRAP_TOKEN ||
          process.env.NAVHUB_STORAGE_TOKEN ||
          process.env.NAVHUB_SESSION_SECRET ||
          process.env.AUTH_SECRET
        if (delegated) {
          headers['authorization'] = 'Bearer ' + delegated
        }
      }
    } catch {
      // 匿名访客或校验异常时不注入任何凭据，保持严格安全边界
    }
  }
  // 透传客户端 IP：中枢的限流按 req.ip 分桶，若不传，所有访客共享同一个桶
  // （投稿 5 次/小时后，第 6 位访客就被 429 挡住）。
  // 前提：前端前面有反向代理（nginx/caddy/traefik）写入 X-Forwarded-For；
  // Next 15 已移除 NextRequest.ip，路由处理器拿不到 socket IP，
  // 因此无 XFF 时只能退回"中枢看到的对端地址"（= 前端进程，仍是共享桶）。
  // 中枢需 trustProxy 才会读取该头（默认关，经代理部署时设 NAVHUB_TRUST_PROXY=1 开启）。
  const xff = sanitizeForwardedFor(request.headers.get('x-forwarded-for'))
  if (xff) headers['x-forwarded-for'] = xff

  const method = request.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const rawBody = hasBody ? await request.text() : undefined
  const hasValidBody = hasBody && typeof rawBody === 'string' && rawBody.trim().length > 0
  const body = hasValidBody ? rawBody : undefined

  if (hasValidBody) {
    if (!headers['content-type']) headers['content-type'] = 'application/json'
  } else {
    delete headers['content-type']
  }

  // 身份签名：中枢配置 NAVHUB_IDENTITY_SECRET 后，带身份的请求必须带对签名，
  // 否则任何持票人（开放模式下甚至匿名）都能自称任意 userId 读写他人数据。
  // 未配置密钥时不加任何头，中枢也不校验（行为与历史版本一致）。
  const identitySecret = hubIdentitySecret()
  if (identitySecret) {
    const identity = identityFromRequest(url, hasValidBody ? rawBody : undefined, request.headers)
    if (identity) headers['x-navhub-identity-signature'] = await signIdentity(identitySecret, identity)
  }

  if (body && body.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: '请求体过大（上限 1MB）' },
      { status: 413, headers: { 'cache-control': 'no-store' } },
    )
  }

  // 上游必须有上限：卡死的中枢不能把前端请求无限期挂住（SSE 在拿到响应头后解除，见下）
  const deadline = createDeadline(upstreamTimeoutMs())

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
      signal: deadline.signal,
    })
    const contentType = upstream.headers.get('content-type') ?? 'application/json'
    // 流式响应透传（如 SSE 实时推流）：不可调用 .text() 阻塞缓冲，直接透传 body 流
    if (isStreamingContentType(contentType)) {
      // 长连接：立刻解除定时器，否则推流会在超时后被 abort 掐断
      deadline.clear()
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...pickResponseHeaders(upstream.headers),
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
        },
      })
    }

    const responseHeaders = pickResponseHeaders(upstream.headers)

    // 304/204/205 按 HTTP 规定不能带 body：给 '{}' 会直接抛 TypeError
    if (isNullBodyStatus(upstream.status)) {
      return new NextResponse(null, { status: upstream.status, headers: responseHeaders })
    }

    // 二进制响应按字节透传：走 .text() 会按 UTF-8 解码把内容解码坏
    if (!isTextContentType(contentType)) {
      return new NextResponse(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders })
    }

    const text = await upstream.text()
    // 中枢返回空体时给 {}，避免前端 JSON.parse 炸裂
    return new NextResponse(text || '{}', { status: upstream.status, headers: responseHeaders })
  } catch (error) {
    // 超时与"中枢没起来"要能分辨：前者是 504（外部依赖慢），后者是 502（连不上）
    const timedOut = deadline.signal.aborted
    console.error('[hub proxy] upstream ' + (timedOut ? 'timeout' : 'unavailable') + ':', error)
    return NextResponse.json(
      { error: timedOut ? 'NavHub 中枢响应超时' : 'NavHub 中枢不可用' },
      { status: timedOut ? 504 : 502, headers: { 'cache-control': 'no-store' } },
    )
  } finally {
    deadline.clear()
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path)
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path)
}
export async function PUT(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path)
}
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path)
}
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path)
}
