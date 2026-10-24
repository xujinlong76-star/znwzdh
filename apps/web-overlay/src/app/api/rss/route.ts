import { NextResponse } from 'next/server'
import {
  SsrfBlockedError,
  guardedFetch,
  isProbablySafeUrl,
  readTextLimited,
} from '@/lib/ssrf-guard'
import { looksLikeFeed, parseFeed, type ParsedFeedItem } from '@/lib/modular/feed-parse'

/**
 * 订阅源代取（RSS / Atom / RDF）。
 *
 * 为什么必须有这一层：浏览器直连任何 feed 基本都会被 CORS 挡掉，于是订阅小卡
 * 以前干脆不取数，直接渲染五条写死的假新闻。这里服务端出网并复用全站同一套
 * SSRF 三层防护（协议白名单 + 解析后 IP 校验 + 逐跳重定向校验），私网/元数据
 * 地址一律拒绝。
 *
 * 边界：
 *  - 只回解析后的条目，绝不把原始 XML 透给前端（避免变成通用代理）；
 *  - 每条 URL 5 分钟缓存、单 IP 每分钟有限次，防止被当免费抓取器打爆上游；
 *  - 取失败时宁可回 `ok:false` + 原因，也不给空列表冒充「没有新内容」；
 *    有历史结果时按 `stale:true` 复用，并在文案里说明这是上一次成功抓取的内容。
 */

// nodejs：SSRF 防护需要 node:dns 做解析后 IP 校验，edge runtime 不具备该能力
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FETCH_TIMEOUT_MS = 8_000
const MAX_BYTES = 512 * 1024
const TTL_MS = 5 * 60 * 1000
const STALE_MAX_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 50

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30

interface CacheEntry {
  at: number
  body: Record<string, unknown>
}

const cache = new Map<string, CacheEntry>()
const rateBuckets = new Map<string, { windowStart: number; used: number }>()

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  return hit
}

function cachePut(key: string, entry: CacheEntry): void {
  if (cache.size >= MAX_ENTRIES) {
    // 简单 FIFO 淘汰：Map 保持插入顺序，丢最早的一个
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, entry)
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'unknown'
}

function rateLimited(key: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    // 桶表同样有上限，避免被伪造 IP 撑出无界内存
    if (rateBuckets.size >= 2_000) {
      for (const [k, v] of rateBuckets) {
        if (now - v.windowStart >= RATE_WINDOW_MS) rateBuckets.delete(k)
      }
      if (rateBuckets.size >= 2_000) rateBuckets.clear()
    }
    rateBuckets.set(key, { windowStart: now, used: 1 })
    return false
  }
  bucket.used++
  return bucket.used > RATE_MAX
}

function fail(reason: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, reason, message, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const raw = (sp.get('url') ?? '').trim()
  if (!raw) return fail('missing_url', '缺少订阅地址', 400)
  const limitParam = Number(sp.get('limit') ?? '')
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(30, Math.floor(limitParam)) : 20

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail('bad_url', '订阅地址不是合法 URL', 400)
  }
  if (!isProbablySafeUrl(url.toString())) {
    return fail('blocked', '订阅地址被 SSRF 防护拒绝（仅允许公网 http(s)，且不允许内网地址）', 400)
  }
  const key = url.toString()

  if (rateLimited(clientKey(request))) {
    return fail('rate_limited', '订阅刷新过于频繁，请稍后再试', 429)
  }

  const hit = cacheGet(key)
  // fresh=1 只跳过「命中即返回」，仍然写缓存：刷新按钮要真取一次，
  // 但不能变成任意绕过缓存的免费抓取代理（限流仍在上面拦着）。
  const wantFresh = sp.get('fresh') === '1'
  if (hit && !wantFresh && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ...hit.body, cached: true }, { headers: { 'Cache-Control': 'no-store' } })
  }

  let response: Response
  try {
    const guarded = await guardedFetch(
      key,
      { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_BYTES, maxRedirects: 3, allowPrivateNetworks: false },
      { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' } }
    )
    response = guarded.response
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      // 上游重定向拐进内网也走这里：不回显 detail 之外的信息，只说明被防护拒绝
      return fail('blocked', `SSRF 防护拒绝该地址：${err.reason}`, 400, staleExtra(hit))
    }
    return fail(staleReason(err), staleFailedMessage(err), statusForStale(hit), staleExtra(hit))
  }

  if (!response.ok) {
    return fail('upstream_status', `订阅源返回 HTTP ${response.status}`, 502, {
      status: response.status,
      ...staleExtra(hit),
    })
  }

  const { text, truncated: bodyTruncated } = await readTextLimited(response, MAX_BYTES)
  if (!looksLikeFeed(response.headers.get('content-type') ?? '', text)) {
    return fail('not_a_feed', '该地址返回的不是 RSS/Atom 订阅内容（可能是普通网页或需要登录）', 415, staleExtra(hit))
  }

  const parsed = parseFeed(text, { maxItems: limit })
  if (!parsed.items.length) {
    return fail('empty_feed', `解析到 0 条（源格式：${parsed.format}）`, 422, staleExtra(hit))
  }

  const body = {
    ok: true,
    feedTitle: parsed.feedTitle,
    format: parsed.format,
    items: parsed.items,
    dropped: parsed.dropped,
    truncated: parsed.truncated || bodyTruncated,
    fetchedAt: Date.now(),
    finalUrl: url.toString(),
    cached: false,
  }
  // 与 /api/weather 同一条口径：缓存时刻就是 body.fetchedAt 那一瞬间。再取一次
  // Date.now() 会让 staleAt 报出一个什么都没取过的时刻，且 TTL 比展示的时间新。
  cachePut(key, { at: body.fetchedAt, body })
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

/** 失败时若有历史成功结果，带出来并明确标注 stale */
function staleExtra(hit?: CacheEntry): Record<string, unknown> {
  if (!hit || Date.now() - hit.at > STALE_MAX_MS) return {}
  const items = hit.body.items as ParsedFeedItem[] | undefined
  if (!items?.length) return {}
  return { stale: true, staleAt: hit.at, items, feedTitle: hit.body.feedTitle ?? null }
}

function statusForStale(hit?: CacheEntry): number {
  return staleExtra(hit).stale ? 200 : 502
}

function staleReason(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  return 'network'
}

function staleFailedMessage(err: unknown): string {
  if (staleReason(err) === 'timeout') return '订阅源在 8 秒内没有响应'
  return '无法连接订阅源（DNS 失败、连接被拒或 TLS 异常）'
}
