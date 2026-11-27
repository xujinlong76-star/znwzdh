'use client'

/**
 * 独立天气页 /weather。
 *
 * 挂件放不下 24 小时逐小时与 7 日详情，这一页是它们的家：
 * 城市搜索框、实况大卡、逐小时 24 小时横向条、7 日预报列表、空气质量卡、
 * 数据来源/取数时刻/stale 不可用态、预警免责文字、Open-Meteo 署名。
 *
 * 城市偏好：选定后写本机 `navhub_weather_city_v1`；登录用户同时写账号偏好
 * （PATCH /api/me/settings 的 weatherCity 字段，失败时本机仍生效、不报错）；
 * 刷新后仍是上次的城市（B-4）。搜索 id 24 小时过期后，用存下的城市名重新
 * 搜索一次、按坐标匹配到同一城市再取新 id，不静默换城市。
 *
 * 温度单位偏好：与城市同一套偏好模型（本机 localStorage 快照 + 账号
 * PATCH /api/me/settings 的 tempUnit 字段），是天气挂件共用的单一来源：
 * 页面切换写偏好，挂件下次打开即读新值；刷新后保持上次的单位，缺省 °C。
 * 初始优先级：账号偏好（登录时云端取一次）> 本机快照 > 默认 °C。
 *
 * 数据全部来自服务端 /api/weather 与 /api/weather/search；上游挂了就明示，
 * 绝不编数。首屏不阻塞：页面骨架先出，天气数据随后到（C-5）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  MapPin,
  RefreshCw,
  Search,
  Sun,
  Thermometer,
  TriangleAlert,
  Wind,
} from 'lucide-react'

import { isLoggedIn } from '@/lib/identity'
import { saveSettingsPatchToCloud } from '@/lib/me-settings-save'
import {
  WEATHER_CITIES,
  ageLabel,
  aqiLevel,
  describeWeatherCode,
  formatTemp,
  hourLabel,
  normalizeUnit,
  normalizeWeatherCityPreference,
  observedAtLabel,
  readWeatherCityPreference,
  uvLevel,
  windLabel,
  writeWeatherCityPreference,
  type WeatherCityPreference,
  type WeatherIconKind,
  type WeatherPayload,
  type WeatherUnit,
} from '@/lib/modular/weather'
import { readLocalUserSettings, writeLocalUserSettings } from '@/lib/user-settings'

interface SearchCandidate {
  id: string
  name: string
  region: string
  country: string
  timezone: string
  latitude: number
  longitude: number
  builtin: boolean
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; reason: string; message: string }
  | { kind: 'ready'; payload: WeatherPayload }

const REASON_HINT: Record<string, string> = {
  unknown_city: '这个城市标识已过期或不在支持范围，请重新搜索一次。',
  timeout: '气象服务响应慢（8 秒超时），稍后重试通常就好。',
  network: '服务端连不上气象上游（DNS/连接/TLS 异常）。',
  upstream_status: '气象上游返回了错误状态码。',
  bad_response: '气象上游返回的内容无法解析成天气数据。',
  rate_limited: '刷新过于频繁被服务端限流，等一分钟再试。',
  blocked: '气象请求被服务端 SSRF 防护拒绝（域名解析到了内网地址）。',
  request_failed: '请求未能发出（本地服务不可用或网络异常）。',
}

function WeatherGlyph({ kind, className }: { kind: WeatherIconKind; className?: string }) {
  const cls = className ?? 'w-4 h-4'
  if (kind === 'sun') return <Sun className={`${cls} text-amber-500`} />
  if (kind === 'rain') return <CloudRain className={`${cls} text-blue-500`} />
  if (kind === 'snow') return <CloudSnow className={`${cls} text-sky-400`} />
  if (kind === 'fog') return <CloudFog className={`${cls} text-slate-400`} />
  if (kind === 'storm') return <CloudLightning className={`${cls} text-violet-500`} />
  return <CloudSun className={`${cls} text-sky-500`} />
}

function tempOrDash(value: number | null | undefined, unit: WeatherUnit): string {
  return formatTemp(typeof value === 'number' ? value : null, unit)
}

function builtinPreference(key: string): WeatherCityPreference | null {
  const city = WEATHER_CITIES[key]
  if (!city) return null
  return {
    id: city.key,
    name: city.name,
    region: city.region,
    country: city.key === 'tokyo' ? '日本' : city.key === 'sf' ? '美国' : '中国',
    timezone: city.timezone,
    latitude: city.latitude,
    longitude: city.longitude,
  }
}

const DEFAULT_PREFERENCE: WeatherCityPreference = builtinPreference('shanghai')!

function coordsClose(a: WeatherCityPreference, b: { latitude: number; longitude: number }): boolean {
  return Math.abs(a.latitude - b.latitude) < 0.05 && Math.abs(a.longitude - b.longitude) < 0.05
}

export function WeatherPage() {
  const [pref, setPref] = useState<WeatherCityPreference>(DEFAULT_PREFERENCE)
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  // 温度单位不是内存态：初始值读账号偏好本机快照（缺省 °C），切换后写回
  // 本机 + 账号同步，刷新后保持（P1-5）。
  const [unit, setUnit] = useState<WeatherUnit>(() => readLocalUserSettings().tempUnit)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<SearchCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [searchNote, setSearchNote] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  // 用户在本页亲手切过单位后，挂载时那次云端取数不再回写：取数是进页面时
  // 发出的，云端值可能比用户刚切的新值旧，回写会把新选择吞掉。
  const unitTouchedRef = useRef(false)
  const reqId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const prefRef = useRef(pref)
  prefRef.current = pref

  const load = useCallback(async (cityId: string, fresh: boolean, retried = false) => {
    const id = ++reqId.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ kind: 'loading' })
    if (fresh) setRefreshing(true)
    try {
      const url = `/api/weather?city=${encodeURIComponent(cityId)}${fresh ? '&fresh=1' : ''}`
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
      const data: unknown = await res.json().catch(() => {
        /* 响应体不是合法 JSON 时当空对象处理：下文按 body.ok !== true 走错误态，不编造天气数据。 */
        return null
      })
      if (id !== reqId.current) return
      const body = (data ?? {}) as Record<string, unknown>
      if (!res.ok || body.ok !== true) {
        const reason = typeof body.reason === 'string' ? body.reason : `http_${res.status}`
        // 搜索 id 过期是可自愈的：用存下的城市名重新搜索、按坐标匹配同一城市再取新 id
        if (reason === 'unknown_city' && !retried && prefRef.current.id === cityId) {
          const stored = prefRef.current
          try {
            const sres = await fetch(`/api/weather/search?q=${encodeURIComponent(stored.name)}`, {
              cache: 'no-store',
            })
            const sdata: unknown = await sres.json().catch(() => {
              /* 搜索响应不是合法 JSON 时当空处理：list 为空、匹配不到就落到下面的错误态，不静默换城市。 */
              return null
            })
            const list = ((sdata as Record<string, unknown> | null)?.results ?? []) as SearchCandidate[]
            const match = list.find((c) => coordsClose(stored, c))
            if (match && match.id !== cityId) {
              const next: WeatherCityPreference = {
                id: match.id,
                name: match.name,
                region: match.region,
                country: match.country,
                timezone: match.timezone,
                latitude: match.latitude,
                longitude: match.longitude,
              }
              persistPreference(next)
              setPref(next)
              await load(match.id, fresh, true)
              return
            }
          } catch {
            // 重新搜索失败就落到下面的错误态，不编数、不静默换城市
          }
        }
        setState({
          kind: 'error',
          reason,
          message: typeof body.message === 'string' ? body.message : `天气接口返回 HTTP ${res.status}`,
        })
        return
      }
      setState({ kind: 'ready', payload: body as unknown as WeatherPayload })
    } catch (err) {
      if (id !== reqId.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      setState({ kind: 'error', reason: 'request_failed', message: '天气请求未能发出' })
    } finally {
      if (id === reqId.current) {
        setRefreshing(false)
        if (abortRef.current === controller) abortRef.current = null
      }
    }
  }, [])

  // 初始城市：URL ?city= > 本机偏好 > 账号偏好（本地快照）> 登录时云端 > 上海
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlCity = (params.get('city') ?? '').trim()
    let initial: WeatherCityPreference | null = null
    if (urlCity) {
      // URL 城市只认两种：内置 key，或本机偏好里就是这个 id；陌生值不认、不静默换城市
      initial = builtinPreference(urlCity)
      if (!initial) {
        const stored = readWeatherCityPreference()
        if (stored && stored.id === urlCity) initial = stored
      }
    }
    if (!initial) initial = readWeatherCityPreference()
    if (!initial) {
      try {
        initial = normalizeWeatherCityPreference(readLocalUserSettings().weatherCity)
      } catch {
        initial = null
      }
    }
    if (!initial) initial = DEFAULT_PREFERENCE
    setPref(initial)
    setQuery(initial.name)
    void load(initial.id, false)
    // 登录且本机没有任何偏好时，向云端取一次账号城市（失败就静默用默认）
    if (!readWeatherCityPreference() && isLoggedIn()) {
      void (async () => {
        try {
          const res = await fetch('/api/me/settings', { cache: 'no-store' })
          if (!res.ok) return
          const data = (await res.json()) as { settings?: { weatherCity?: unknown } }
          const cloud = normalizeWeatherCityPreference(data.settings?.weatherCity)
          if (cloud && !readWeatherCityPreference()) {
            writeWeatherCityPreference(cloud)
            setPref(cloud)
            setQuery(cloud.name)
            void load(cloud.id, false)
          }
        } catch {
          // 云端取不到不阻断：本机默认城市照常用
        }
      })()
    }
    return () => abortRef.current?.abort()
  }, [])

  // 温度单位：账号偏好 > 本机 > 默认 °C。登录时向云端取一次账号单位并写回
  // 本机快照（失败就静默用本机值）；未登录只用本机快照。
  useEffect(() => {
    if (!isLoggedIn()) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/me/settings', { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { settings?: { tempUnit?: unknown } }
        const cloudUnit = normalizeUnit(data.settings?.tempUnit)
        if (cancelled || unitTouchedRef.current) return
        if (cloudUnit !== readLocalUserSettings().tempUnit) {
          try {
            writeLocalUserSettings({ tempUnit: cloudUnit })
          } catch {
            // 本机写失败不阻断：本次显示仍用云端单位
          }
          setUnit(cloudUnit)
        }
      } catch {
        // 云端取不到不阻断：本机单位照常用
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function persistUnit(next: WeatherUnit) {
    unitTouchedRef.current = true
    setUnit(next)
    try {
      writeLocalUserSettings({ tempUnit: next })
    } catch {
      // 本机账号偏好写失败不阻断：本次显示仍用新单位，下次打开回落到旧偏好
    }
    if (isLoggedIn()) {
      // 云端同步是尽力而为：失败时本机仍生效，下次切换再同步
      void saveSettingsPatchToCloud({ tempUnit: next }).catch(() => {
        /* 云端同步是尽力而为：失败时本机偏好仍生效，下次切换再同步。 */
      })
    }
  }

  function persistPreference(next: WeatherCityPreference) {
    writeWeatherCityPreference(next)
    try {
      writeLocalUserSettings({ weatherCity: next })
    } catch {
      // 本机账号偏好写失败不阻断：天气城市偏好本身已落盘
    }
    if (isLoggedIn()) {
      // 云端同步是尽力而为：失败时本机仍生效，下次选城市再同步
      void saveSettingsPatchToCloud({ weatherCity: next }).catch(() => {
        /* 云端同步是尽力而为：失败时本机偏好仍生效，下次选城市再同步。 */
      })
    }
  }

  function selectCity(candidate: SearchCandidate) {
    const next: WeatherCityPreference = {
      id: candidate.id,
      name: candidate.name,
      region: candidate.region,
      country: candidate.country,
      timezone: candidate.timezone,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    }
    persistPreference(next)
    setPref(next)
    setQuery(candidate.name)
    setCandidates([])
    setDropdownOpen(false)
    setSearchNote(null)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('city', candidate.id)
      window.history.replaceState(null, '', url.toString())
    } catch {
      // URL 写失败不阻断选城市
    }
    void load(candidate.id, false)
  }

  function runSearch(q: string) {
    const trimmed = q.trim()
    if (!trimmed) {
      setCandidates([])
      setSearchNote(null)
      setSearchError(null)
      setDropdownOpen(false)
      return
    }
    setSearching(true)
    setSearchError(null)
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    void (async () => {
      try {
        const res = await fetch(`/api/weather/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        const data: unknown = await res.json().catch(() => {
          /* 搜索响应不是合法 JSON 时当空对象处理：下文按 body.ok !== true 显示搜索错误，不谎报无结果。 */
          return null
        })
        const body = (data ?? {}) as Record<string, unknown>
        if (!res.ok || body.ok !== true) {
          setCandidates([])
          setSearchNote(null)
          setSearchError(typeof body.message === 'string' ? body.message : `搜索接口返回 HTTP ${res.status}`)
          setDropdownOpen(true)
          return
        }
        setCandidates((body.results ?? []) as SearchCandidate[])
        setSearchNote(typeof body.note === 'string' ? body.note : null)
        setSearchError(null)
        setDropdownOpen(true)
        setActiveIdx(-1)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setCandidates([])
        setSearchError('搜索请求未能发出，请检查网络后重试')
        setDropdownOpen(true)
      } finally {
        setSearching(false)
      }
    })()
  }

  function onQueryChange(value: string) {
    setQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => runSearch(value), 300)
  }

  const payload = state.kind === 'ready' ? state.payload : null
  const current = payload?.current ?? null
  const days = payload?.days ?? []
  const hourly = payload?.hourly ?? []
  const level = aqiLevel(payload?.aqi ?? null)
  const condition = describeWeatherCode(current?.code ?? null)
  const wind = windLabel(current?.windDirectionDeg ?? null, current?.windSpeedKmh ?? null)
  const pollutants = payload?.aqiPollutants ?? null

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-6 space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">天气</h1>
        <p className="text-sm text-muted-foreground">实时天气、24 小时逐小时预报、7 日预报与空气质量。</p>
      </header>

      {/* 城市搜索：中文或拼音，候选 ≤10 条；搜索不可用时下方 8 城快选仍可用 */}
      <section aria-label="城市搜索" className="relative">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-primary/40">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => {
              if (candidates.length > 0 || searchError) setDropdownOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && candidates.length > 0) {
                e.preventDefault()
                setDropdownOpen(true)
                setActiveIdx((i) => Math.min(candidates.length - 1, i + 1))
              } else if (e.key === 'ArrowUp' && candidates.length > 0) {
                e.preventDefault()
                setDropdownOpen(true)
                setActiveIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                if (dropdownOpen && activeIdx >= 0 && candidates[activeIdx]) {
                  e.preventDefault()
                  selectCity(candidates[activeIdx])
                } else {
                  runSearch(query)
                }
              } else if (e.key === 'Escape') {
                setDropdownOpen(false)
              }
            }}
            placeholder="搜索城市（中文或拼音，如 南京 / nanjing）"
            aria-label="搜索城市"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {searching && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
        </div>
        {dropdownOpen && (
          <ul className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
            {searchError && (
              <li className="px-3 py-2 text-xs text-muted-foreground leading-relaxed">{searchError}</li>
            )}
            {!searchError && candidates.length === 0 && !searching && (
              <li className="px-3 py-2 text-xs text-muted-foreground">没有找到这个城市，换个关键词试试。</li>
            )}
            {candidates.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => selectCity(c)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                    i === activeIdx ? 'bg-muted/70' : ''
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="font-medium text-foreground truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {c.region ? `${c.region} · ` : ''}
                      {c.country}
                    </span>
                  </span>
                  {c.builtin && <span className="text-[10px] text-muted-foreground shrink-0">内置</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchNote && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{searchNote}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.values(WEATHER_CITIES).map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => selectCity({ id: c.key, name: c.name, region: c.region, country: c.key === 'tokyo' ? '日本' : c.key === 'sf' ? '美国' : '中国', timezone: c.timezone, latitude: c.latitude, longitude: c.longitude, builtin: true })}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                pref.id === c.key
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </section>

      {/* stale 旧观测：页面顶部琥珀色横条，不只是底部小字 */}
      {payload?.stale && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
        >
          本次刷新未成功，以下是 {ageLabel(payload.staleAt ?? payload.fetchedAt)}的历史观测（2 小时内），可能与当前天气不符。
        </div>
      )}

      {state.kind === 'loading' && (
        <div className="space-y-4" aria-label="天气加载中">
          <div className="rounded-2xl border border-border bg-card p-5 animate-pulse">
            <div className="h-10 w-32 rounded bg-muted" />
            <div className="mt-3 h-4 w-48 rounded bg-muted" />
            <div className="mt-4 h-4 w-64 rounded bg-muted" />
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 animate-pulse">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="mt-3 flex gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-36 w-20 rounded-lg bg-muted shrink-0" />
              ))}
            </div>
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center gap-2 text-center">
          <TriangleAlert className="w-5 h-5 text-amber-500" />
          <p className="text-sm text-foreground font-medium">天气服务暂时不可用</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{state.message}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {REASON_HINT[state.reason] ?? '可以重试，或换个城市试试。'}
          </p>
          <button
            onClick={() => void load(pref.id, true)}
            className="mt-1 text-sm text-primary hover:underline"
          >
            重试
          </button>
        </div>
      )}

      {state.kind === 'ready' && payload && (
        <>
          {/* 实况大卡 */}
          <section aria-label="实况" className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <WeatherGlyph kind={condition.kind} className="w-7 h-7" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-4xl font-bold font-mono tracking-tight text-foreground">
                      {tempOrDash(current?.tempC, unit)}
                    </span>
                    <span className="text-sm text-muted-foreground">{condition.label}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <MapPin className="w-3 h-3 text-primary" />
                    <span>
                      {payload.cityName}（{payload.cityRegion}）
                    </span>
                    <span>· 观测时间 {observedAtLabel(current?.observedAt ?? null)}（{payload.cityName}本地）</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => persistUnit(unit === 'celsius' ? 'fahrenheit' : 'celsius')}
                  className="text-xs font-mono px-2 py-1 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 transition-colors"
                >
                  {unit === 'celsius' ? '切换至 °F' : '切换至 °C'}
                </button>
                <button
                  onClick={() => void load(pref.id, true)}
                  disabled={refreshing}
                  className="text-xs px-2 py-1 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 transition-colors disabled:opacity-50"
                  title="重新向上游取一次"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg bg-muted/30 border border-border/30 px-2.5 py-2">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Thermometer className="w-3 h-3 text-orange-500" /> 体感
                </div>
                <div className="mt-0.5 font-mono font-medium text-foreground">{tempOrDash(current?.feelsLikeC, unit)}</div>
              </div>
              <div className="rounded-lg bg-muted/30 border border-border/30 px-2.5 py-2">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Droplets className="w-3 h-3 text-sky-500" /> 湿度
                </div>
                <div className="mt-0.5 font-mono font-medium text-foreground">
                  {current?.humidity === null || current === null ? '—' : `${Math.round(current.humidity)}%`}
                </div>
              </div>
              <div className="rounded-lg bg-muted/30 border border-border/30 px-2.5 py-2">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Wind className="w-3 h-3 text-teal-500" /> 风力
                </div>
                <div className="mt-0.5 font-medium text-foreground">{wind ?? '—'}</div>
              </div>
              <div className="rounded-lg bg-muted/30 border border-border/30 px-2.5 py-2">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Droplets className="w-3 h-3 text-blue-500" /> 降水
                </div>
                <div className="mt-0.5 font-medium text-foreground">
                  {current?.precipMm === null || current === null
                    ? '—'
                    : `${current.precipMm} mm（今日至今）`}
                  {days[0]?.precipProbMax !== null && days[0]?.precipProbMax !== undefined
                    ? ` · 今日降水概率 ${Math.round(days[0].precipProbMax)}%`
                    : ''}
                </div>
              </div>
            </div>
          </section>

          {/* 逐小时 24 小时横向条 */}
          <section aria-label="逐小时预报" className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">逐小时预报（未来 24 小时）</h2>
            {hourly.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">上游未返回逐小时数据。</p>
            ) : (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1" data-testid="hourly-strip">
                {hourly.map((h) => {
                  const hc = describeWeatherCode(h.code)
                  return (
                    <div
                      key={h.time}
                      className="flex flex-col items-center gap-1 px-1 py-2 rounded-lg bg-muted/30 border border-border/30 text-xs shrink-0 w-20 whitespace-nowrap"
                      title={`${h.time} · ${hc.label}`}
                    >
                      <span className="text-muted-foreground font-mono">{hourLabel(h.time)}</span>
                      <WeatherGlyph kind={hc.kind} className="w-4 h-4" />
                      <span className="font-mono font-medium text-foreground">{tempOrDash(h.tempC, unit)}</span>
                      <span className="text-sky-600 dark:text-sky-400 font-mono">
                        {h.precipProb === null ? '—' : `${Math.round(h.precipProb)}%`}
                      </span>
                      {((h.precipProb ?? 0) > 0 || (h.precipMm ?? 0) > 0) && h.precipMm !== null ? (
                        <span className="text-sky-600 dark:text-sky-400 font-mono">{`${h.precipMm} mm`}</span>
                      ) : null}
                      <span className="text-muted-foreground font-mono">
                        {h.windSpeedKmh === null ? '—' : `风 ${Math.round(h.windSpeedKmh)} km/h`}
                      </span>
                      <span className="text-muted-foreground font-mono">
                        {h.humidity === null ? '—' : `湿度 ${Math.round(h.humidity)}%`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 7 日预报列表 */}
          <section aria-label="7 日预报" className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">7 日预报</h2>
            {days.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">上游未返回预报数据。</p>
            ) : (
              <ul className="mt-2 divide-y divide-border/40">
                {days.map((d, idx) => {
                  const dc = describeWeatherCode(d.code)
                  return (
                    <li key={d.date || idx} className="py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="w-14 shrink-0 text-muted-foreground">
                          {idx < 3 ? d.label : d.date ? d.date.slice(5) : d.label}
                          {idx < 3 && (
                            <span className="block text-[11px] font-mono">{d.date ? d.date.slice(5) : ''}</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5 min-w-0 flex-1">
                          <WeatherGlyph kind={dc.kind} className="w-4 h-4 shrink-0" />
                          <span className="text-foreground truncate">{dc.label}</span>
                        </span>
                        <span className="hidden sm:flex items-center gap-1 text-xs text-sky-600 dark:text-sky-400 shrink-0">
                          <Droplets className="w-3 h-3" />
                          {d.precipProbMax === null ? '—' : `${Math.round(d.precipProbMax)}%`}
                          {d.precipSumMm !== null ? ` · ${d.precipSumMm} mm` : ''}
                        </span>
                        <span className="font-mono font-medium text-foreground shrink-0">
                          {tempOrDash(d.highC, unit)}
                          <span className="text-muted-foreground"> / {tempOrDash(d.lowC, unit)}</span>
                        </span>
                      </div>
                      {/* 日出/日落/紫外线：手机上也必须可见，不藏进 hidden sm:flex */}
                      <p className="mt-1 pl-16 text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                        日出 {hourLabel(d.sunrise)} · 日落 {hourLabel(d.sunset)} ·{' '}
                        {d.uvIndexMax === null
                          ? 'UV —'
                          : `UV ${Math.round(d.uvIndexMax)} ${uvLevel(d.uvIndexMax)?.label ?? ''}`}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* 空气质量卡 */}
          <section aria-label="空气质量" className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">空气质量</h2>
            {payload.aqi === null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                AQI 未知{payload.aqiNote ? `（${payload.aqiNote}）` : ''}
              </p>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`text-sm border px-2 py-0.5 rounded-full font-mono ${
                      level?.tone === 'good'
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                        : level?.tone === 'moderate'
                          ? 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/20'
                          : 'text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/20'
                    }`}
                    title="美国 EPA AQI 口径，由空气质量上游单独提供"
                  >
                    AQI {Math.round(payload.aqi)} {level?.label ?? ''}
                  </span>
                  <span className="text-xs text-muted-foreground">美国 EPA 口径</span>
                </div>
                <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
                  {(
                    [
                      ['PM2.5', pollutants?.pm25],
                      ['PM10', pollutants?.pm10],
                      ['O₃', pollutants?.o3],
                      ['NO₂', pollutants?.no2],
                      ['SO₂', pollutants?.so2],
                      ['CO', pollutants?.co],
                    ] as Array<[string, number | null | undefined]>
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-muted/30 border border-border/30 px-2 py-2">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="mt-0.5 font-mono font-medium text-foreground">
                        {value === null || value === undefined ? '—' : `${value} µg/m³`}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {payload.aqi !== null && payload.aqiNote && (
              <p className="mt-2 text-[11px] text-muted-foreground">{payload.aqiNote}</p>
            )}
          </section>
        </>
      )}

      {/* 数据来源 / 取数时刻 / 免责 / 署名 */}
      <footer className="text-[11px] text-muted-foreground space-y-1 pb-4">
        <p>
          数据源 Open-Meteo ·{' '}
          {state.kind === 'ready' && payload ? `${ageLabel(payload.fetchedAt)}更新` : '尚未取到数据'}
          {payload?.stale ? `（历史观测，${ageLabel(payload.staleAt ?? payload.fetchedAt)}）` : ''}
        </p>
        <p>
          Weather data by{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
            Open-Meteo
          </a>{' '}
          (CC BY 4.0)
        </p>
        <p>本站不提供灾害预警，极端天气请以气象部门发布为准。</p>
        <p>
          备用源和风天气：
          {payload?.qweatherConfigured
            ? '已配置'
            : '未配置（需站长在控制台配置后可用）'}
          。主源 Open-Meteo 免费免 key；无 key 时核心天气不受影响。
        </p>
      </footer>
    </main>
  )
}
