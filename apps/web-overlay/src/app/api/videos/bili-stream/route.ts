import { NextRequest, NextResponse } from 'next/server'
import { ensureHttpsUrl, isAllowedBilivideoStreamHost } from '@/lib/video-bilibili-hd-parser'

export const dynamic = 'force-dynamic'

const UPSTREAM_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com',
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

  const fetchHeaders = new Headers(UPSTREAM_HEADERS)
  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    fetchHeaders.set('Range', rangeHeader)
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method,
      headers: fetchHeaders,
      redirect: 'follow',
    })

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      return NextResponse.json(
        { error: `上游视频流节点返回 HTTP ${upstreamRes.status}` },
        { status: upstreamRes.status }
      )
    }

    const responseHeaders = new Headers()
    const contentType = upstreamRes.headers.get('content-type') || 'video/mp4'
    responseHeaders.set('Content-Type', contentType)
    responseHeaders.set('Accept-Ranges', upstreamRes.headers.get('accept-ranges') || 'bytes')
    responseHeaders.set('Cache-Control', 'private, max-age=3600')

    const contentLength = upstreamRes.headers.get('content-length')
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength)
    }

    const contentRange = upstreamRes.headers.get('content-range')
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange)
    }

    return new NextResponse(method === 'HEAD' ? null : upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '视频流代理连接失败' },
      { status: 502 }
    )
  }
}

export async function GET(request: NextRequest) {
  return handleStreamProxy(request, 'GET')
}

export async function HEAD(request: NextRequest) {
  return handleStreamProxy(request, 'HEAD')
}
