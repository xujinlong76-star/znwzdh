import { NextResponse, type NextRequest } from 'next/server'
import { isInternalShortLinkTarget } from '@/lib/shortlink-target'

/**
 * 站内短链：/s/<code> → /marketplace/<slug>
 *
 * 解析走中枢 GET /api/shortlinks/:code（同时累计点击数）；目标在入库与
 * 解析两处都强制校验为 /marketplace/ 内部路径，这里再校验一次，
 * 防止脏数据造成开放重定向。
 */

const HUB_BASE = (
  process.env.NAVHUB_STORAGE_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787'
).replace(/\/$/, '')

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params
  const invalid = NextResponse.redirect(new URL('/marketplace?shortlink=invalid', request.url), 302)

  if (!/^[a-zA-Z0-9]{1,32}$/.test(code)) return invalid

  try {
    const res = await fetch(`${HUB_BASE}/api/shortlinks/${encodeURIComponent(code)}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return invalid
    const data = (await res.json()) as { target?: unknown }
    const target = typeof data.target === 'string' ? data.target : ''
    if (!isInternalShortLinkTarget(target)) return invalid
    return NextResponse.redirect(new URL(target, request.url), 302)
  } catch {
    return invalid
  }
}
