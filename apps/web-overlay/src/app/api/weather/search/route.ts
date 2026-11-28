import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  SsrfBlockedError,
  guardedFetch,
  readTextLimited,
} from '@/lib/ssrf-guard'
import {
  WEATHER_CITIES,
  WEATHER_CITY_PINYIN,
  registerSearchedCity,
  type WeatherCity,
} from '@/lib/modular/weather'
import { WEATHER_DNS_TIMEOUT_MS, getWeatherDnsResolver } from '@/lib/weather-dns'

/**
 * 城市搜索代理（Open-Meteo geocoding）。
 *
 * 前端只传关键词、只收候选列表：坐标由服务端在注册候选时决定，
 * 前端回传的是不透明 id（见 lib/modular/weather.ts 的搜索映射说明），
 * 绝不接受前端自传经纬度——否则本站就成了免费的地理编码代理。
 *
 * 候选上限 10 条：内置 8 城的中文名/拼音匹配排在前面（离线就有，不花上游调用），
 * 再补 geocoding 结果；防滥用限流每 IP 每分钟 20 次（与天气接口的 60 次分开计桶）。
 */

// nodejs：SSRF 防护需要 node:dns 做解析后 IP 校验，edge runtime 不具备该能力
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GEOCODING_ORIGIN = 'https://geocoding-api.open-meteo.com'
const FETCH_TIMEOUT_MS = 8_000
const MAX_BYTES = 128 * 1024
const MAX_RESULTS = 10

const SEARCH_TTL_MS = 24 * 60 * 60_000
const SEARCH_CACHE_MAX = 100

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 20

interface SearchCandidate {
  /** 内置城市为 key（如 shanghai）；geocoding 城市为服务端注册的不透明 id */
  id: string
  name: string
  region: string
  country: string
  timezone: string
  latitude: number
  longitude: number
  builtin: boolean
}

interface SearchCacheEntry {
  at: number
  results: SearchCandidate[]
}

const searchCache = new Map<string, SearchCacheEntry>()
const rateBuckets = new Map<string, { windowStart: number; used: number }>()

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'unknown'
}

function rateLimited(key: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
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

function fail(reason: string, message: string, status: number) {
  return NextResponse.json({ ok: false, reason, message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function numOrNull(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function reasonFromError(err: unknown): string {
  // 注入的真实 DNS 解析器本身失败/超时 → dns_failure（走 502），
  // 绝不回退系统解析器；解析成功后被 SSRF 规则拦截的仍是 blocked。
  if (err instanceof SsrfBlockedError) {
    if (err.code === 'dns-failure' || err.code === 'dns-timeout') return 'dns_failure'
    return 'blocked'
  }
  const name = err instanceof Error ? err.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  return 'network'
}

async function fetchJson(
  url: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string; message: string }> {
  let response: Response
  try {
    // 天气走真实 DNS 解析器（8.8.8.8，已连接 UDP + 金丝雀）：
    // 本机系统解析器把公网域名解析到 198.18/15，SSRF 守卫拦截致 502。
    const dnsResolver = await getWeatherDnsResolver()
    const guarded = await guardedFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      maxRedirects: 0,
      allowPrivateNetworks: false,
      dnsResolver,
      dnsTimeoutMs: WEATHER_DNS_TIMEOUT_MS,
    })
    response = guarded.response
  } catch (err) {
    const reason = reasonFromError(err)
    if (err instanceof SsrfBlockedError) {
      if (reason === 'dns_failure') {
        return { ok: false, reason, message: `地理编码服务 DNS 解析失败（${err.reason}），未回退系统解析器` }
      }
      return { ok: false, reason, message: `地理编码请求被 SSRF 防护拒绝：${err.reason}` }
    }
    return {
      ok: false,
      reason,
      message: reason === 'timeout' ? `地理编码服务在 ${FETCH_TIMEOUT_MS / 1000} 秒内没有响应` : '无法连接地理编码服务（DNS 失败、连接被拒或 TLS 异常）',
    }
  }
  if (!response.ok) {
    return { ok: false, reason: 'upstream_status', message: `地理编码服务返回 HTTP ${response.status}` }
  }
  const { text, truncated } = await readTextLimited(response, MAX_BYTES)
  if (truncated) {
    return { ok: false, reason: 'bad_response', message: '地理编码响应超出大小上限，已中止解析' }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'bad_response', message: '地理编码服务返回的不是预期 JSON 对象' }
    }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, reason: 'bad_response', message: '地理编码响应无法解析（上游返回了非 JSON 内容）' }
  }
}

/** 内置 8 城先行匹配：中文名/地区含关键词，或拼音含关键词（小写比较） */
function builtinMatches(query: string): SearchCandidate[] {
  const q = query.toLowerCase()
  const out: SearchCandidate[] = []
  for (const city of Object.values(WEATHER_CITIES)) {
    const pinyin = WEATHER_CITY_PINYIN[city.key] ?? []
    const hit =
      city.name.includes(query) ||
      city.region.includes(query) ||
      pinyin.some((p) => p.includes(q))
    if (!hit) continue
    out.push({
      id: city.key,
      name: city.name,
      region: city.region,
      country: city.key === 'tokyo' ? '日本' : city.key === 'sf' ? '美国' : '中国',
      timezone: city.timezone,
      latitude: city.latitude,
      longitude: city.longitude,
      builtin: true,
    })
  }
  return out
}

function toCandidate(raw: Record<string, unknown>): SearchCandidate | null {
  const name = typeof raw.name === 'string' ? raw.name : ''
  const latitude = numOrNull(raw.latitude)
  const longitude = numOrNull(raw.longitude)
  const timezone = typeof raw.timezone === 'string' ? raw.timezone : ''
  if (!name || latitude === null || longitude === null || !timezone) return null
  const city: WeatherCity = {
    key: `geo:${latitude},${longitude}`,
    name,
    region: typeof raw.admin1 === 'string' ? raw.admin1 : '',
    latitude,
    longitude,
    timezone,
  }
  const id = `geo-${randomUUID()}`
  registerSearchedCity(id, city)
  return {
    id,
    name,
    region: city.region,
    country: typeof raw.country === 'string' ? raw.country : '',
    timezone,
    latitude,
    longitude,
    builtin: false,
  }
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const q = (sp.get('q') ?? '').trim()
  if (!q) {
    return fail('bad_query', '请先输入城市名（中文或拼音）再搜索', 400)
  }
  if (q.length > 100) {
    return fail('bad_query', '搜索关键词过长（最多 100 字）', 400)
  }

  if (rateLimited(clientKey(request))) {
    return fail('rate_limited', '城市搜索过于频繁，请稍后再试', 429)
  }

  const cacheKey = q.toLowerCase()
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) {
    return NextResponse.json(
      { ok: true, results: cached.results, cached: true },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const found = builtinMatches(q)
  const seen = new Set(found.map((c) => `${c.name}|${c.region}|${c.country}`))

  // 内置已命中且关键词就是中文名时仍要补 geocoding：同名城市可能有多个
  // （如「南京」在国内国外都有）；只有内置命中已满 10 条时才省掉上游调用。
  let upstreamNote: string | null = null
  if (found.length < MAX_RESULTS) {
    const params = new URLSearchParams({
      name: q,
      count: String(MAX_RESULTS),
      language: 'zh',
      format: 'json',
    })
    const result = await fetchJson(`${GEOCODING_ORIGIN}/v1/search?${params.toString()}`)
    if (!result.ok) {
      // 上游挂了也不让内置匹配白白丢掉：有内置结果就先给，附注说明搜索不完整；
      // 一个都没有才 502 明示。
      if (found.length > 0) {
        upstreamNote = `在线搜索未取到（${result.message}），仅显示内置城市`
      } else {
        return fail(result.reason, result.message, 502)
      }
    } else {
      const list = Array.isArray(result.data.results) ? result.data.results : []
      for (const item of list) {
        if (found.length >= MAX_RESULTS) break
        if (!item || typeof item !== 'object') continue
        const candidate = toCandidate(item as Record<string, unknown>)
        if (!candidate) continue
        const dedupe = `${candidate.name}|${candidate.region}|${candidate.country}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        found.push(candidate)
      }
    }
  }

  const results = found.slice(0, MAX_RESULTS)
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value
    if (oldest !== undefined) searchCache.delete(oldest)
  }
  searchCache.set(cacheKey, { at: Date.now(), results })
  return NextResponse.json(
    { ok: true, results, cached: false, ...(upstreamNote ? { note: upstreamNote } : {}) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
