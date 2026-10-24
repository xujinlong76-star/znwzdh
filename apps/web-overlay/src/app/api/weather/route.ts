import { NextResponse } from 'next/server'
import {
  SsrfBlockedError,
  guardedFetch,
  readTextLimited,
} from '@/lib/ssrf-guard'
import {
  WEATHER_CITIES,
  airQualityUrlPath,
  dayLabel,
  forecastUrlPath,
  resolveCityKey,
  type WeatherPayload,
} from '@/lib/modular/weather'

/**
 * 天气代取路由（Open-Meteo）。
 *
 * 为什么必须有这一层：小卡以前渲染的是文件里写死的一张静态表，卡片标题却叫
 * 「实时天气」——用户看到的是 2026 年某个假想的上海 24°C。现在数据真的来自上游。
 *
 * 与 /api/rss 的关键区别：这里不接受任意 URL，只接受 WEATHER_CITIES 里的 key，
 * 坐标由服务端表决定，所以不存在「拿本服务当免费代理」的开放面；SSRF 防护仍然复用，
 * 只为挡住 DNS 把官方域名指进内网这类异常。
 *
 * 诚实边界：
 *  - 上游没给某个字段 → 该字段留 null，展示层渲染「—」；
 *  - 空气指数是另一个上游（air-quality-api），失败时只把 AQI 置 null 并说明原因，
 *    不拖累气温/预报；
 *  - 本次取数失败但有历史成功结果 → 带 `stale:true` + `staleAt` 返回，卡片明说是旧观测。
 */

// nodejs：SSRF 防护需要 node:dns 做解析后 IP 校验，edge runtime 不具备该能力
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WEATHER_ORIGIN = 'https://api.open-meteo.com'
const AIR_ORIGIN = 'https://air-quality-api.open-meteo.com'
const FORECAST_DAYS = 3

const FETCH_TIMEOUT_MS = 8_000
const MAX_BYTES = 128 * 1024
const TTL_MS = 10 * 60_000
const STALE_MAX_MS = 6 * 60 * 60_000
const MAX_ENTRIES = 40

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 60

interface CacheEntry {
  at: number
  payload: WeatherPayload
}

const cache = new Map<string, CacheEntry>()
const rateBuckets = new Map<string, { windowStart: number; used: number }>()

function cachePut(key: string, entry: CacheEntry): void {
  if (cache.size >= MAX_ENTRIES) {
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

/** 数值字段：脏值（字符串 / NaN / null）统一归 null，绝不当成 0 */
function numOrNull(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function arr(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : []
}

function reasonFromError(err: unknown): string {
  if (err instanceof SsrfBlockedError) return 'blocked'
  const name = err instanceof Error ? err.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  return 'network'
}

async function fetchJson(
  url: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string; message: string }> {
  let response: Response
  try {
    const guarded = await guardedFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      maxRedirects: 0,
      allowPrivateNetworks: false,
    })
    response = guarded.response
  } catch (err) {
    const reason = reasonFromError(err)
    if (err instanceof SsrfBlockedError) {
      return { ok: false, reason, message: `气象请求被 SSRF 防护拒绝：${err.reason}` }
    }
    return {
      ok: false,
      reason,
      message: reason === 'timeout' ? `气象服务在 ${FETCH_TIMEOUT_MS / 1000} 秒内没有响应` : '无法连接气象服务（DNS 失败、连接被拒或 TLS 异常）',
    }
  }
  if (!response.ok) {
    return { ok: false, reason: 'upstream_status', message: `气象服务返回 HTTP ${response.status}` }
  }
  const { text, truncated } = await readTextLimited(response, MAX_BYTES)
  if (truncated) {
    return { ok: false, reason: 'bad_response', message: '气象响应超出大小上限，已中止解析' }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'bad_response', message: '气象服务返回的不是预期 JSON 对象' }
    }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, reason: 'bad_response', message: '气象响应无法解析（上游返回了非 JSON 内容）' }
  }
}

/** 失败时若有历史成功结果，带出来并明确标注 stale */
function stalePayload(hit?: CacheEntry): (WeatherPayload & { cached: true }) | null {
  if (!hit || Date.now() - hit.at > STALE_MAX_MS) return null
  return { ...hit.payload, stale: true, staleAt: hit.at, cached: true }
}

function staleResponse(hit?: CacheEntry): NextResponse | null {
  const stale = stalePayload(hit)
  if (!stale) return null
  return NextResponse.json({ ok: true, ...stale }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const resolved = resolveCityKey(sp.get('city'))
  if (resolved.unknown) {
    return fail(
      'unknown_city',
      `城市标识「${resolved.requested}」不在内置城市表中，可用值：${Object.keys(WEATHER_CITIES).join(' / ')}`,
      400,
    )
  }
  const city = WEATHER_CITIES[resolved.key]!
  const key = city.key

  if (rateLimited(clientKey(request))) {
    return fail('rate_limited', '天气刷新过于频繁，请稍后再试', 429)
  }

  const hit = cache.get(key)
  // fresh=1 只跳过「命中即返回」，仍然写缓存：手动刷新要真取一次，但限流照旧拦着。
  const wantFresh = sp.get('fresh') === '1'
  if (hit && !wantFresh && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(
      { ok: true, ...hit.payload, cached: true },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const weatherResult = await fetchJson(`${WEATHER_ORIGIN}${forecastUrlPath(city, FORECAST_DAYS)}`)
  if (!weatherResult.ok) {
    // 旧观测仍比「查不到」有用，但必须挂着 stale 说明，不能冒充实时
    return staleResponse(hit) ?? fail(weatherResult.reason, weatherResult.message, 502)
  }

  const data = weatherResult.data
  const currentRaw = (data.current && typeof data.current === 'object' ? data.current : {}) as Record<string, unknown>
  const daily = (data.daily && typeof data.daily === 'object' ? data.daily : {}) as Record<string, unknown>
  const times = arr(daily.time)
  const codes = arr(daily.weather_code)
  const highs = arr(daily.temperature_2m_max)
  const lows = arr(daily.temperature_2m_min)

  const observedAt = typeof currentRaw.time === 'string' ? currentRaw.time : null
  const payload: WeatherPayload = {
    cityKey: city.key,
    current: {
      tempC: numOrNull(currentRaw.temperature_2m),
      feelsLikeC: numOrNull(currentRaw.apparent_temperature),
      humidity: numOrNull(currentRaw.relative_humidity_2m),
      code: numOrNull(currentRaw.weather_code),
      windSpeedKmh: numOrNull(currentRaw.wind_speed_10m),
      windDirectionDeg: numOrNull(currentRaw.wind_direction_10m),
      observedAt,
    },
    days: times.map((t, i) => ({
      date: typeof t === 'string' ? t : '',
      label: dayLabel(typeof t === 'string' ? t : '', i),
      code: numOrNull(codes[i]),
      highC: numOrNull(highs[i]),
      lowC: numOrNull(lows[i]),
    })),
    aqi: null,
    aqiNote: null,
    source: 'open-meteo',
    fetchedAt: Date.now(),
    stale: false,
    staleAt: null,
  }

  // 空气指数单独取：它挂了只让 AQI 变未知，不该把整张天气卡判死
  const air = await fetchJson(`${AIR_ORIGIN}${airQualityUrlPath(city)}`)
  if (air.ok) {
    const airCurrent = (air.data.current && typeof air.data.current === 'object' ? air.data.current : {}) as Record<string, unknown>
    const aqi = numOrNull(airCurrent.us_aqi)
    if (aqi === null) payload.aqiNote = '空气指数上游未返回该字段'
    else payload.aqi = aqi
  } else {
    payload.aqiNote = `空气指数未取到（${air.message}）`
  }

  if (payload.days.length === 0) {
    return staleResponse(hit) ?? fail('bad_response', `气象服务没有返回任何预报（城市：${city.name}）`, 502)
  }

  // 缓存时刻必须等于 payload.fetchedAt：再调一次 Date.now() 会把「空气指数那一跳」的
  // 耗时（最坏 8 秒超时）算进观测时间，于是 TTL/STALE 按一个比真实观测更晚的钟走，
  // 而卡片上写的 staleAt 也是什么都没取过的时刻。
  cachePut(key, { at: payload.fetchedAt, payload })
  return NextResponse.json(
    { ok: true, ...payload, cached: false },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
