import { NextResponse, type NextRequest } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { HUB_CACHE_TAG } from '@/lib/server/hub-cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * P1-3 按需再验证入口：
 * 供后台脚本或中枢写库完成后主动触发首页与分类缓存失效，
 * 配合 page.tsx 的长兜底 revalidate=3600 实现「平时零轮询、变更秒级生效」。
 *
 * 鉴权：必须配置环境变量 `NAVHUB_REVALIDATE_SECRET`，请求头带 `x-revalidate-secret` 匹配。
 */
export async function POST(req: NextRequest) {
  const secret = (process.env.NAVHUB_REVALIDATE_SECRET || '').trim()
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'NAVHUB_REVALIDATE_SECRET 未配置' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const provided = req.headers.get('x-revalidate-secret') || ''
  if (provided !== secret) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let body: { paths?: string[]; tags?: string[] } = {}
  try {
    body = (await req.json()) as { paths?: string[]; tags?: string[] }
  } catch {
    // 空 body 时默认刷新首页与 hub tag
  }

  const tags = Array.isArray(body.tags) && body.tags.length > 0 ? body.tags : [HUB_CACHE_TAG]
  const paths = Array.isArray(body.paths) && body.paths.length > 0 ? body.paths : ['/']

  for (const tag of tags) {
    if (typeof tag === 'string' && tag.length > 0 && tag.length <= 64) {
      revalidateTag(tag, 'max')
    }
  }
  for (const p of paths) {
    if (typeof p === 'string' && p.startsWith('/') && p.length <= 128) {
      revalidatePath(p)
    }
  }

  return NextResponse.json(
    { ok: true, revalidatedTags: tags, revalidatedPaths: paths, at: Date.now() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
