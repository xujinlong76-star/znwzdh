import { NextRequest, NextResponse } from 'next/server'
import { resolveBilibiliHdStream, type BilibiliHdParseInput } from '@/lib/video-bilibili-hd-parser'

export const dynamic = 'force-dynamic'

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
 * 或 ?url=https://www.bilibili.com/video/BV1MmUSB5Efw&access_key=...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url') || undefined
    const bvid = searchParams.get('bvid') || undefined
    const aid = searchParams.get('aid') || undefined
    const cid = searchParams.get('cid') || undefined
    const p = parsePositiveInt(searchParams.get('p'), 1)
    const accessKey =
      searchParams.get('access_key') ||
      searchParams.get('accessKey') ||
      undefined
    const preferredEngine = (searchParams.get('engine') || searchParams.get('preferredEngine') || undefined) as any
    const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('forceRefresh') === 'true'

    if (!url && !bvid && !aid) {
      return NextResponse.json(
        { ok: false, error: '请提供有效的 B 站视频参数（bvid、aid 或 url）' },
        { status: 400 }
      )
    }

    const result = await resolveBilibiliHdStream({
      url,
      bvid,
      aid,
      cid,
      p,
      accessKey,
      preferredEngine,
      forceRefresh,
    })

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': result.ok && !accessKey
          ? 'private, max-age=300, stale-while-revalidate=300'
          : 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'B 站高清视频解析失败'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400 }
    )
  }
}

/**
 * POST /api/videos/bili-parse
 * Body: { url?: string, bvid?: string, aid?: string, cid?: string, p?: number, accessKey?: string, forceRefresh?: boolean }
 */
export async function POST(request: NextRequest) {
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
        { ok: false, error: '请提供有效的 B 站视频参数（bvid、aid 或 url）' },
        { status: 400 }
      )
    }

    const result = await resolveBilibiliHdStream(input)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'B 站高清视频解析失败'
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400 }
    )
  }
}
