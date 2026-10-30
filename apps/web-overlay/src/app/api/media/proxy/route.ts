import { NextResponse } from 'next/server'
import { isSafeMediaHost, verifyMediaSignature } from '@/lib/media-proxy'
import { envPositiveInt } from '@/lib/stream-budget'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'

interface CachedMedia {
  buffer: Buffer
  contentType: string
  etag: string
  cachedAt: number
}

// 内存 LRU 缓存，最多缓存 800 张常用封面
const MEDIA_CACHE = new Map<string, CachedMedia>()
const MAX_CACHE_SIZE = 800
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时

/**
 * 单张封面的字节上限。
 *
 * 修复前上游响应直接 `arrayBuffer()` 全量读入：签名 URL 指向一张 100MB 的图
 * （或 raw.githubusercontent.com 上任一大文件）就能把进程内存吃穿，
 * 而且缓存只数条目不数字节，800 条足够撑爆 Node。
 * 上限做成环境变量只为让「字节预算淘汰」这条分支能被小成本单测覆盖，
 * 生产默认值不依赖它。
 */
const MAX_MEDIA_BYTES = envPositiveInt('NAVHUB_MEDIA_PROXY_MAX_BYTES', 5 * 1024 * 1024)
/** 缓存总字节预算：条目数上限挡不住「800 张刚好压线的图」 */
const MAX_CACHE_BYTES = envPositiveInt('NAVHUB_MEDIA_PROXY_CACHE_BYTES', 128 * 1024 * 1024)

/**
 * 可代理的响应类型白名单。
 *
 * 只放位图：`image/svg+xml` 是脚本可执行的，同源代理回去等于把
 * raw.githubusercontent.com 上任何人上传的 SVG 变成站内 XSS。
 * 类型缺失也拒绝——「猜它是 jpeg」会让代理变成任意内容投递器。
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon'
])

// 并发控制与在途请求合并，防止首屏 50+ 封面同时轰炸打爆 Node.js Socket 导致 68 秒 HMR 卡死
const inFlightRequests = new Map<string, Promise<FetchOutcome>>()
let activeFetches = 0
const MAX_CONCURRENT_UPSTREAM = 6
const fetchWaitQueue: (() => void)[] = []

/** 缓存的字节账（与条目数账并行维护，LRU 淘汰时一起回收） */
let cacheBytes = 0

type FetchOutcome =
  | { status: 'ok'; item: CachedMedia }
  | { status: 'too_large' }
  | { status: 'bad_type'; contentType: string }
  | { status: 'failed' }

async function acquireFetchSlot(): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_UPSTREAM) {
    activeFetches++
    return
  }
  return new Promise<void>((resolve) => {
    fetchWaitQueue.push(() => {
      activeFetches++
      resolve()
    })
  })
}

function releaseFetchSlot(): void {
  activeFetches--
  const next = fetchWaitQueue.shift()
  if (next) next()
}

function dropCacheEntry(key: string): void {
  const entry = MEDIA_CACHE.get(key)
  if (entry) cacheBytes -= entry.buffer.length
  MEDIA_CACHE.delete(key)
}

/** 按「条目数 + 总字节」双上限淘汰最旧条目 */
function makeRoomFor(nextBytes: number): void {
  while (
    (MEDIA_CACHE.size >= MAX_CACHE_SIZE || cacheBytes + nextBytes > MAX_CACHE_BYTES) &&
    MEDIA_CACHE.size > 0
  ) {
    const oldestKey = MEDIA_CACHE.keys().next().value
    if (!oldestKey) break
    dropCacheEntry(oldestKey)
  }
}

/**
 * 带上限地读上游响应体。
 *
 * 超限时立刻 cancel（连接随之关闭），不把多字节读进内存再丢弃。
 */
async function readBodyWithLimit(res: Response, maxBytes: number): Promise<{ buffer: Buffer } | { overflow: true }> {
  const body = res.body
  if (!body) return { buffer: Buffer.alloc(0) }
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => { /* cancel 失败可忽略：这条路径本来就在放弃流（超限/类型不符），没人在等它完成 */ })
      return { overflow: true }
    }
    chunks.push(Buffer.from(value))
  }
  return { buffer: Buffer.concat(chunks, total) }
}

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

    // 4. 发起上游抓取（带 6 路并发限流与在途 Promise 合并）
    let outcome: FetchOutcome

    const existing = inFlightRequests.get(cacheKey)
    if (existing) {
      outcome = await existing
    } else {
      const fetchPromise = (async (): Promise<FetchOutcome> => {
        await acquireFetchSlot()
        try {
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
            signal: AbortSignal.timeout(6000)
          })

          if (!upstreamRes.ok) {
            return { status: 'failed' }
          }

          // 5. 体积预检：Content-Length 超限直接拒，不开始读
          const declaredLength = Number(upstreamRes.headers.get('content-length'))
          if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
            await upstreamRes.body?.cancel().catch(() => { /* cancel 失败可忽略：这条路径本来就在放弃流（超限/类型不符），没人在等它完成 */ })
            return { status: 'too_large' }
          }

          // 6. 类型白名单：先认类型再收字节，避免把 HTML/脚本当图片缓存
          const rawContentType = (upstreamRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
          if (!ALLOWED_CONTENT_TYPES.has(rawContentType)) {
            await upstreamRes.body?.cancel().catch(() => { /* cancel 失败可忽略：这条路径本来就在放弃流（超限/类型不符），没人在等它完成 */ })
            // 回给客户端的头只能用 latin1：值里写中文会让 new Response() 抛错，把 415 变成 500
            return { status: 'bad_type', contentType: rawContentType || 'unknown' }
          }

          // 7. 无长度头时边读边限，到点即断
          const read = await readBodyWithLimit(upstreamRes, MAX_MEDIA_BYTES)
          if ('overflow' in read) {
            return { status: 'too_large' }
          }

          const buffer = read.buffer
          const etag = `"${createHash('md5').update(buffer).digest('hex')}"`
          const item: CachedMedia = {
            buffer,
            contentType: rawContentType,
            etag,
            cachedAt: Date.now()
          }

          // 写入内存缓存（条目数与总字节双上限）
          dropCacheEntry(cacheKey)
          makeRoomFor(buffer.length)
          MEDIA_CACHE.set(cacheKey, item)
          cacheBytes += buffer.length
          return { status: 'ok', item }
        } catch {
          // 上游超时/中断/读流失败：与历史行为一致，如实降级为 502
          return { status: 'failed' }
        } finally {
          releaseFetchSlot()
          inFlightRequests.delete(cacheKey)
        }
      })()

      inFlightRequests.set(cacheKey, fetchPromise)
      outcome = await fetchPromise
    }

    if (outcome.status === 'too_large') {
      return new Response('Media exceeds the proxy size limit', {
        status: 413,
        headers: { 'X-Media-Limit-Bytes': String(MAX_MEDIA_BYTES) }
      })
    }
    if (outcome.status === 'bad_type') {
      return new Response('Media type is not supported by the proxy', {
        status: 415,
        // HTTP 头值必须是 ByteString（ASCII）：上游的 Content-Type 可能带非 ASCII
        // （实测中文类型串会抛 TypeError: character at index 1 has a value of 32570）。
        // 这里只做回显，剥成 ASCII 是安全的；真值已经在响应体里。
        headers: { 'X-Media-Content-Type': String(outcome.contentType ?? '').replace(/[^\x20-\x7e]/g, '?') }
      })
    }
    if (outcome.status === 'failed') {
      return new Response('Upstream fetch failed or timed out', { status: 502 })
    }

    const { buffer, contentType, etag } = outcome.item

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
