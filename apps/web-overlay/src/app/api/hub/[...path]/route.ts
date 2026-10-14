import { NextResponse, type NextRequest } from 'next/server'

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
 */

const HUB_BASE = (
  process.env.NAVHUB_STORAGE_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787'
).replace(/\/$/, '')

const FORWARD_HEADERS = ['content-type', 'accept', 'authorization'] as const

async function forward(request: NextRequest, path: string[]): Promise<Response> {
  const url = new URL(request.url)
  const cleanPath = path[0] === 'api' ? path.slice(1) : path
  const normalizedBase = HUB_BASE.endsWith('/api') ? HUB_BASE.slice(0, -4) : HUB_BASE
  const target = normalizedBase + '/api/' + cleanPath.join('/') + url.search

  const headers: Record<string, string> = { Accept: 'application/json' }
  for (const h of FORWARD_HEADERS) {
    const v = request.headers.get(h)
    if (v) headers[h] = v
  }
  // 服务端代理鉴权补全：若客户端未传 Authorization 头，而环境变量配置了存储/中枢 Token，
  // 自动注入 Bearer Token，保证开启 NAVHUB_AUTH_REQUIRED 后管理端路由访问通畅
  if (!headers['authorization']) {
    const serverToken = process.env.NAVHUB_STORAGE_TOKEN || process.env.NAVHUB_MCP_TOKEN || process.env.NAVHUB_BOOTSTRAP_TOKEN;
    if (serverToken) {
      headers['authorization'] = 'Bearer ' + serverToken;
    }
  }
  // 透传客户端 IP：中枢的限流按 req.ip 分桶，若不传，所有访客共享同一个桶
  // （投稿 5 次/小时后，第 6 位访客就被 429 挡住）。
  // 前提：前端前面有反向代理（nginx/caddy/traefik）写入 X-Forwarded-For；
  // Next 15 已移除 NextRequest.ip，路由处理器拿不到 socket IP，
  // 因此无 XFF 时只能退回"中枢看到的对端地址"（= 前端进程，仍是共享桶）。
  // 中枢需 trustProxy 才会读取该头（默认开，NAVHUB_TRUST_PROXY=0 关闭）。
  const xff = request.headers.get('x-forwarded-for')
  if (xff) headers['x-forwarded-for'] = xff

  const method = request.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? await request.text() : undefined
  if (hasBody && body && !headers['content-type']) headers['content-type'] = 'application/json'

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: body || undefined,
      cache: 'no-store',
    })
    const text = await upstream.text()
    // 透传状态码与内容类型；中枢返回空体时给 {}，避免前端 JSON.parse 炸裂
    return new NextResponse(text || '{}', {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'NavHub 中枢不可用', details: String(error) },
      { status: 502 },
    )
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
