import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { hubIdentitySecret, signIdentity } from '@/lib/identity-signature'
import { canonicalUserId, isAnonId } from '@/lib/me-identity'

/**
 * 用户中心 BFF：/api/me/*
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

/** 服务间调用凭据：鉴权模式下 /api/users/sync 需要 Bearer token */
function serviceToken(): string | undefined {
  return (
    process.env.NAVHUB_BOOTSTRAP_TOKEN ||
    process.env.NAVHUB_STORAGE_TOKEN ||
    process.env.NAVHUB_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    undefined
  )
}

type Ctx = { params: Promise<{ path: string[] }> }

async function currentUser() {
  const session = await auth()
  const user = session?.user as
    | { id?: string; provider?: string; name?: string | null; email?: string | null; image?: string | null }
    | undefined
  return { user, identity: canonicalUserId(user) }
}

async function forward(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { user, identity } = await currentUser()
  if (!user || !identity) {
    return NextResponse.json({ error: '未登录' }, { status: 401, headers: { 'cache-control': 'no-store' } })
  }

  const path = (await ctx.params).path.filter((p) => p && p !== '.' && p !== '..')
  const method = request.method.toUpperCase()

  // 登录后把用户 upsert 进 users 表，返回 canonical userId
  if (path[0] === 'sync') {
    if (method !== 'POST') {
      return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 })
    }
    const [provider, ...rest] = identity.split(':')
    const providerId = identity.includes(':') ? rest.join(':') : identity
    const token = serviceToken()
    try {
      const res = await fetch(HUB_BASE + '/api/users/sync', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: 'Bearer ' + token } : {}),
        },
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

  // 合并请求：除登录身份签名外，匿名 id 也要单独签名
  const rawBody = method === 'GET' || method === 'HEAD' ? undefined : await request.text()
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-navhub-user-id': identity,
  }
  if (rawBody !== undefined) headers['content-type'] = 'application/json'

  const secret = hubIdentitySecret()
  if (secret) {
    headers['x-navhub-identity-signature'] = await signIdentity(secret, identity)
    if (path[0] === 'merge' && rawBody) {
      try {
        const parsed = JSON.parse(rawBody) as { anonId?: unknown }
        if (isAnonId(parsed.anonId)) {
          headers['x-navhub-anon-signature'] = await signIdentity(secret, parsed.anonId)
        }
      } catch {
        // body 不是 JSON 时交给中枢返回 400
      }
    }
  }

  const search = request.nextUrl.search || ''
  const target = HUB_BASE + '/api/me/' + path.join('/') + search

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
    return new NextResponse(text || '{}', {
      status: upstream.status,
      headers: { 'content-type': contentType, 'cache-control': 'no-store' },
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
