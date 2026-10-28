import { NextResponse } from 'next/server'
import { isSafeMediaHost, verifyMediaSignature } from '@/lib/media-proxy'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'

interface CachedMedia {
  buffer: Buffer
  contentType: string
  etag: string
  cachedAt: number
}

// 内存 LRU 缓存，最多缓存 120 张常用封面
const MEDIA_CACHE = new Map<string, CachedMedia>()
const MAX_CACHE_SIZE = 120
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const rawUrl = searchParams.get('url')
    const sig = searchParams.get('sig')

    if (!rawUrl || !sig) {
      return new Response('Missing url or signature parameter', { status: 400 })
    }

    // 1. 签名校验（防止开放代理被利用扫描内网或滥用流量）
    if (!verifyMediaSignature(rawUrl, sig)) {
      return new Response('Invalid media proxy signature', { status: 403 })
    }

    // 2. 目标域名合法性及 SSRF 检查
    let parsedUrl: URL
    try {
      parsedUrl = new URL(rawUrl)
    } catch {
      return new Response('Malformed URL', { status: 400 })
    }

    if (!isSafeMediaHost(parsedUrl.hostname)) {
      return new Response('Target host is not permitted', { status: 403 })
    }

    const cacheKey = rawUrl
    const now = Date.now()

    // 3. 命中本地内存缓存
    const cached = MEDIA_CACHE.get(cacheKey)
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
      const clientEtag = request.headers.get('if-none-match')
      if (clientEtag === cached.etag) {
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': cached.etag,
            'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400'
          }
        })
      }

      return new Response(new Uint8Array(cached.buffer), {
        status: 200,
        headers: {
          'Content-Type': cached.contentType,
          'Content-Length': String(cached.buffer.length),
          'ETag': cached.etag,
          'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
          'X-Media-Cache': 'HIT'
        }
      })
    }

    // 4. 发起上游抓取并伪造来源以绕过防盗链
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }

    if (parsedUrl.hostname.includes('hdslb.com') || parsedUrl.hostname.includes('bilibili.com')) {
      upstreamHeaders['Referer'] = 'https://www.bilibili.com/'
      upstreamHeaders['Origin'] = 'https://www.bilibili.com'
    } else if (parsedUrl.hostname.includes('ytimg.com') || parsedUrl.hostname.includes('youtube.com')) {
      upstreamHeaders['Referer'] = 'https://www.youtube.com/'
    }

    const upstreamRes = await fetch(rawUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(8000)
    })

    if (!upstreamRes.ok) {
      return new Response(`Upstream returned HTTP ${upstreamRes.status}`, { status: 502 })
    }

    const arrayBuffer = await upstreamRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg'
    const etag = `"${createHash('md5').update(buffer).digest('hex')}"`

    // 写入内存缓存
    if (MEDIA_CACHE.size >= MAX_CACHE_SIZE) {
      const oldestKey = MEDIA_CACHE.keys().next().value
      if (oldestKey) MEDIA_CACHE.delete(oldestKey)
    }
    MEDIA_CACHE.set(cacheKey, {
      buffer,
      contentType,
      etag,
      cachedAt: now
    })

    const clientEtag = request.headers.get('if-none-match')
    if (clientEtag === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400'
        }
      })
    }

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'ETag': etag,
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
        'X-Media-Cache': 'MISS'
      }
    })
  } catch (error) {
    console.error('[MediaProxy] Failed to proxy media:', error)
    return new Response('Failed to proxy media', { status: 500 })
  }
}
