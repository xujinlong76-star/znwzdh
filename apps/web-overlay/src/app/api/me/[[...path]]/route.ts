import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { hubIdentitySecret, signIdentity } from '@/lib/identity-signature'
import { ANON_COOKIE, encodeAnonCookie, parseAnonCookie } from '@/lib/hub-identity-guard'
import { canonicalUserId, isAnonId } from '@/lib/me-identity'

/**
 * 用户中心 BFF：/api/me 与 /api/me/*
 *
 * 为什么用可选 catch-all（[[...path]]）：概览页请求的正是 `/api/me` 本身，
 * 必选 catch-all（[...path]）只匹配 `/api/me/` 之后还有段落的路径，
 * 会让 `/api/me` 直接落到 404 —— 页面永远停在「用户中心加载失败」。
 *
 * 为什么需要这一层：中枢（Fastify）不持有 NextAuth 会话，无法自己判断「当前是谁」。
 * 这里在服务端读取会话，派生 canonical identity，再带 HMAC 签名转发给中枢。
 *
 * 安全约束：
 *  - 客户端传入的 `x-navhub-user-id` / 签名头一律不转发（避免伪造）；
 *  - anonId 合并额外要求 `x-navhub-anon-signature`（证明对匿名身份的所有权）；
 *  - 中枢 `/api/me` 只信任这里注入的签名身份。
 */
const HUB_BASE = (
  process.env.NAVHUB_STORAGE_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787'
).replace(/\/+$/, '')

const TIMEOUT_MS = 15_000
/** body 上限 ~1MB，防止代理被超大请求体耗尽进程内存 */
const MAX_BODY_BYTES = 1024 * 1024

/** 服务间调用凭据：鉴权模式下 /api/users/sync 及无签名密钥时的 /api/me 需要 Bearer token */
function serviceToken(): string | undefined {
  return (
    process.env.NAVHUB_ADMIN_TOKEN ||
    process.env.NAVHUB_BOOTSTRAP_TOKEN ||
    process.env.NAVHUB_STORAGE_TOKEN ||
    process.env.NAVHUB_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    undefined
  )
}

type Ctx = { params: Promise<{ path?: string[] }> }

/** 会话治理（T8）：库与列表只认 sid 的 sha256，原始 sid 不出 Web 服务端 */
async function hashSid(sid: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(sid).digest('hex')
}

async function currentUser() {
  const session = await auth()
  const user = session?.user as
    | { id?: string; provider?: string; name?: string | null; email?: string | null; image?: string | null }
    | undefined
  // 会话治理（T8）：sid 用于设备吊销核对与会话活跃登记（只留在服务端）
  const sessionSid = (session as { sessionSid?: string } | null)?.sessionSid
  const expires = Date.parse(String(session?.expires ?? ''))
  return {
    user,
    identity: canonicalUserId(user),
    sessionSid: typeof sessionSid === 'string' ? sessionSid : undefined,
    sessionExpiresAt: Number.isFinite(expires) && expires > 0 ? expires : undefined,
  }
}

async function forward(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { user, identity, sessionSid, sessionExpiresAt } = await currentUser()
  if (!user || !identity) {
    return NextResponse.json({ error: '未登录' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  }

  const path = ((await ctx.params).path ?? []).filter((p) => p && p !== '.' && p !== '..')
  const method = request.method.toUpperCase()

  // 登录后把用户 upsert 进 users 表，返回 canonical userId
  if (path[0] === 'sync') {
    if (method !== 'POST') {
      return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 })
    }
    const [provider, ...rest] = identity.split(':')
    const providerId = identity.includes(':') ? rest.join(':') : identity
    const token = serviceToken()
    const secret = hubIdentitySecret()
    const targetUserId = `${provider || 'github'}:${providerId}`
    const syncHeaders: Record<string, string> = {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      'x-navhub-user-id': targetUserId,
    }
    if (secret) {
      syncHeaders['x-navhub-identity-signature'] = await signIdentity(secret, targetUserId)
    }
    try {
      const res = await fetch(HUB_BASE + '/api/users/sync', {
        method: 'POST',
        headers: syncHeaders,
        body: JSON.stringify({
          provider: provider || 'github',
          providerId,
          username: user.name || user.email || providerId,
          email: user.email ?? null,
          avatar: user.image ?? null,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok) {
        return NextResponse.json(
          { error: data.error || '身份同步失败' },
          { status: res.status, headers: { 'cache-control': 'no-store' } },
        )
      }
      return NextResponse.json(
        { ok: true, identity: data.id || identity, user: data },
        { headers: { 'cache-control': 'no-store' } },
      )
    } catch {
      return NextResponse.json(
        { error: '中枢不可用' },
        { status: 502, headers: { 'cache-control': 'no-store' } },
      )
    }
  }

  const hasBody = method !== 'GET' && method !== 'HEAD'
  if (hasBody) {
    const declared = Number(request.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: '请求体过大（上限 1MB）' },
        { status: 413, headers: { 'cache-control': 'no-store' } },
      )
    }
  }

  // 合并请求：除登录身份签名外，匿名 id 也要单独签名
  const rawBody = hasBody ? await request.text() : undefined
  if (rawBody && rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: '请求体过大（上限 1MB）' },
      { status: 413, headers: { 'cache-control': 'no-store' } },
    )
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-navhub-user-id': identity,
  }
  // 协商缓存（T18）：把浏览器的 If-None-Match 透传给中枢，304 才有发生的可能
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch
  if (rawBody !== undefined) headers['content-type'] = 'application/json'

  const secret = hubIdentitySecret()
  let pendingAnonCookie: string | null = null
  if (secret) {
    headers['x-navhub-identity-signature'] = await signIdentity(secret, identity)
    if (path[0] === 'merge' && rawBody) {
      try {
        const parsed = JSON.parse(rawBody) as { anonId?: unknown }
        if (isAnonId(parsed.anonId)) {
          // 匿名所有权校验：浏览器绑定的 HttpOnly cookie 必须与 body.anonId 一致。
          // 没 cookie（老用户首次合并）按 TOFU 绑定；有 cookie 但不一致 → 401，
          // 防共享设备/多账号把别人的匿名数据并进当前账号。
          const bound = parseAnonCookie(request.cookies.get(ANON_COOKIE)?.value)
          if (bound) {
            const expectedMac = await signIdentity(secret, bound.anonId)
            if (bound.mac !== expectedMac || bound.anonId !== parsed.anonId) {
              return NextResponse.json(
                { error: '匿名身份与当前浏览器不一致，已拒绝合并' },
                { status: 401, headers: { 'cache-control': 'no-store' } },
              )
            }
          } else {
            pendingAnonCookie = encodeAnonCookie(
              parsed.anonId,
              await signIdentity(secret, parsed.anonId),
            )
          }
          headers['x-navhub-anon-signature'] = await signIdentity(secret, parsed.anonId)
        }
      } catch {
        // body 不是 JSON 时交给中枢返回 400
      }
    }
  } else {
    const token = serviceToken()
    if (token) {
      headers['authorization'] = 'Bearer ' + token
    }
  }

  // 会话治理（T8）：登记活跃 + 核对吊销（一次往返）。
  // - revoked → 401：被踢出的设备从下一个请求起失去 /api/me/* 全部能力；
  // - 核对失败（中枢抖动）fail-open：无法确认 ≠ 已吊销，可用性优先；
  // - 没有 sid（老会话 / 非会话身份）跳过。
  if (sessionSid) {
    try {
      const checkRes = await fetch(HUB_BASE + '/api/me/sessions/check', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sid: sessionSid,
          userAgent: request.headers.get('user-agent') ?? null,
          ...(sessionExpiresAt ? { expiresAt: sessionExpiresAt } : {}),
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, 5000)),
      })
      if (checkRes.ok) {
        const verdict = (await checkRes.json()) as { revoked?: boolean }
        if (verdict.revoked) {
          return NextResponse.json(
            { error: '会话已被踢出，请重新登录' },
            { status: 401, headers: { 'cache-control': 'no-store' } },
          )
        }
      }
    } catch {
      // fail-open：核对通道故障不阻断主请求
    }
  }

  // 设备列表特判（T8）：hub 只认 sidHash，由 BFF 标记「当前设备」
  if (path[0] === 'sessions' && method === 'GET' && path.length === 1) {
    const upstreamList = await fetch(HUB_BASE + '/api/me/sessions', {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const listText = await upstreamList.text()
    if (!upstreamList.ok) {
      return new NextResponse(listText || '{}', {
        status: upstreamList.status,
        headers: { 'content-type': upstreamList.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
      })
    }
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(listText) as Record<string, unknown> } catch { body = {} }
    return NextResponse.json(
      { ...body, currentSidHash: sessionSid ? await hashSid(sessionSid) : null },
      { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    )
  }

  const search = request.nextUrl.search || ''
  const suffix = path.length > 0 ? '/' + path.join('/') : ''
  const target = HUB_BASE + '/api/me' + suffix + search

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: rawBody === undefined ? undefined : rawBody,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await upstream.text()
    const contentType = upstream.headers.get('content-type') ?? 'application/json'
    // 协商缓存（T18）：中枢声明了 etag 的 GET 响应，透传 etag 并以
    // private, no-cache 取代一刀切的 no-store——浏览器可存但每次再验证，
    // 304 时省掉整份概览聚合与传输。未声明 etag 的响应维持 no-store 安全默认。
    const upstreamEtag = upstream.headers.get('etag')
    const responseHeaders: Record<string, string> = {
      'content-type': contentType,
      'cache-control': upstreamEtag ? 'private, no-cache' : 'no-store',
    }
    if (upstreamEtag) responseHeaders['etag'] = upstreamEtag
    const contentDisposition = upstream.headers.get('content-disposition')
    if (contentDisposition) {
      responseHeaders['content-disposition'] = contentDisposition
    }
    if (pendingAnonCookie) {
      responseHeaders['set-cookie'] =
        `${ANON_COOKIE}=${pendingAnonCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` +
        (process.env.NODE_ENV === 'production' ? '; Secure' : '')
    }
    // 304 不能带 body：原样回传状态与 etag，浏览器用自己的缓存副本
    if (upstream.status === 304) {
      return new NextResponse(null, { status: 304, headers: responseHeaders })
    }
    return new NextResponse(text || '{}', {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    return NextResponse.json(
      { error: timedOut ? '用户中心响应超时' : '用户中心不可用' },
      { status: timedOut ? 504 : 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}

export async function GET(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx)
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx)
}
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx)
}
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx)
}
