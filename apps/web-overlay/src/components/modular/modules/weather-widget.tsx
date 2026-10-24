'use client'

/**
 * 天气小卡。
 *
 * 历史问题：这张卡渲染的是源码里写死的一张静态表（上海常年 24°C、北京常年 21°C），
 * 注册表标题却叫「实时天气」。用户据此决定穿什么出门，假数据比没数据更糟。
 * 现在数据走服务端 /api/weather 代取 Open-Meteo，取不到就明确失败并说明原因。
 *
 * widget 只能读 config、不能自己落盘：卡上的单位切换是本卡临时状态，因此带「临时」标记，
 * 永久设置要走卡片齿轮里的「温度单位」。
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
  Sun,
  Thermometer,
  TriangleAlert,
  Wind,
} from 'lucide-react'

import {
  WEATHER_CITIES,
  ageLabel,
  aqiLevel,
  describeWeatherCode,
  formatTemp,
  normalizeUnit,
  observedAtLabel,
  resolveCityKey,
  windLabel,
  type WeatherIconKind,
  type WeatherPayload,
  type WeatherUnit,
} from '@/lib/modular/weather'

interface WeatherWidgetProps {
  config?: {
    city?: string
    unit?: 'celsius' | 'fahrenheit'
  }
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; reason: string; message: string }
  | { kind: 'ready'; payload: WeatherPayload }

/** 失败原因 → 用户能照着做下一步的文案 */
const REASON_HINT: Record<string, string> = {
  unknown_city: '配置的城市标识不在内置城市表中，请在卡片设置里换一个。',
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

/** 缺失就是缺失：渲染「—」，不用 0 顶替（0°C 是真实温度，不是「没数据」） */
function tempOrDash(value: number | null | undefined, unit: WeatherUnit): string {
  return formatTemp(typeof value === 'number' ? value : null, unit)
}

export function WeatherWidget({ config }: WeatherWidgetProps) {
  const resolved = resolveCityKey(config?.city)
  const city = WEATHER_CITIES[resolved.key]!
  const configuredUnit = normalizeUnit(config?.unit)
  const [unitOverride, setUnitOverride] = useState<WeatherUnit | null>(null)
  const unit = unitOverride ?? configuredUnit

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const reqId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (cityKey: string, fresh: boolean) => {
    const id = ++reqId.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ kind: 'loading' })
    if (fresh) setRefreshing(true)
    try {
      const url = `/api/weather?city=${encodeURIComponent(cityKey)}${fresh ? '&fresh=1' : ''}`
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
      // 非 JSON 响应（网关错误页等）在这里读不出 reason，下面的分支会用 HTTP 状态码兜底；
      // 空对象不会被当成一次成功观测，因此不会伪装成「今天 0℃」。
      const data: unknown = await res.json().catch(() => {
        return null
      })
      if (id !== reqId.current) return
      const body = (data ?? {}) as Record<string, unknown>
      if (!res.ok || body.ok !== true) {
        setState({
          kind: 'error',
          reason: typeof body.reason === 'string' ? body.reason : `http_${res.status}`,
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

  useEffect(() => {
    void load(resolved.key, false)
    return () => abortRef.current?.abort()
  }, [resolved.key, load])

  const payload = state.kind === 'ready' ? state.payload : null
  const current = payload?.current ?? null
  const days = payload?.days ?? []
  const aqi = payload?.aqi ?? null
  const level = aqiLevel(aqi)
  const condition = describeWeatherCode(current?.code ?? null)
  const wind = windLabel(current?.windDirectionDeg ?? null, current?.windSpeedKmh ?? null)

  return (
    <div className="h-full flex flex-col justify-between p-3.5 select-none space-y-2">
      {/* 顶部城市与单位/刷新操作 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground min-w-0">
          <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">{city.name}</span>
          <span className="text-xs text-muted-foreground font-normal shrink-0">({city.region})</span>
          {payload?.stale && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-normal shrink-0">
              旧观测
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {unitOverride !== null && (
            <span
              className="text-[10px] px-1 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 leading-none"
              title="卡上的切换只影响本卡本次显示，不会写回配置"
            >
              临时
            </span>
          )}
          <button
            onClick={() => setUnitOverride(unit === 'celsius' ? 'fahrenheit' : 'celsius')}
            className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 transition-colors"
            title="仅本卡临时切换显示单位；永久设置请点卡片齿轮里的「温度单位」"
          >
            {unit === 'celsius' ? '切换至 °F' : '切换至 °C'}
          </button>
          <button
            onClick={() => void load(resolved.key, true)}
            disabled={refreshing}
            className="text-xs px-1.5 py-0.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 transition-colors disabled:opacity-50"
            title="重新向上游取一次（服务端结果缓存 10 分钟）"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {resolved.unknown && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed shrink-0">
          配置的城市「{resolved.requested}」不在内置城市表中，已改用{city.name}。可用值：
          {Object.keys(WEATHER_CITIES).join(' / ')}。
        </p>
      )}

      {state.kind === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" />
          正在获取{city.name}的实时观测…
        </div>
      )}

      {state.kind === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 text-center">
          <TriangleAlert className="w-4 h-4 text-amber-500" />
          <p className="text-xs text-muted-foreground leading-relaxed">{state.message}</p>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            {REASON_HINT[state.reason] ?? '可以重试，或在卡片设置里换个城市。'}
          </p>
          <button onClick={() => void load(resolved.key, true)} className="text-xs text-primary hover:underline">
            重试
          </button>
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          {/* 实时观测 */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <WeatherGlyph kind={condition.kind} className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
                  {tempOrDash(current?.tempC, unit)}
                </div>
                <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 flex-wrap">
                  <span className="truncate">{condition.label}</span>
                  {level ? (
                    <span
                      className={`text-[10px] border px-1.5 py-0.5 rounded-full font-mono ${
                        level.tone === 'good'
                          ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          : level.tone === 'moderate'
                            ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20'
                            : 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20'
                      }`}
                      title="美国 EPA AQI 口径，由空气质量上游单独提供"
                    >
                      AQI {Math.round(aqi!)} {level.label}
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono border border-border/40 text-muted-foreground">
                      AQI 未知
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 体感 / 湿度 / 风力：缺哪项显示「—」 */}
            <div className="text-right text-xs text-muted-foreground space-y-1 shrink-0">
              <div className="flex items-center justify-end gap-1">
                <Thermometer className="w-3 h-3 text-orange-500" />
                <span>体感 {tempOrDash(current?.feelsLikeC, unit)}</span>
              </div>
              <div className="flex items-center justify-end gap-1">
                <Droplets className="w-3 h-3 text-sky-500" />
                <span>
                  湿度 {current?.humidity === null || current === null ? '—' : `${Math.round(current.humidity)}%`}
                </span>
              </div>
              <div className="flex items-center justify-end gap-1">
                <Wind className="w-3 h-3 text-teal-500" />
                <span>{wind ?? '—'}</span>
              </div>
            </div>
          </div>

          {/* 近三日趋势胶囊（含今天） */}
          <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-border/40">
            {days.slice(0, 3).map((d, idx) => {
              const dc = describeWeatherCode(d.code)
              return (
                <div
                  key={d.date || idx}
                  className="flex items-center justify-between px-2 py-1 rounded-lg bg-muted/30 border border-border/30 text-xs"
                  title={`${d.date || '日期未知'} · ${dc.label}`}
                >
                  <span className="text-muted-foreground">{d.label}</span>
                  <div className="flex items-center gap-1 font-mono font-medium">
                    <WeatherGlyph kind={dc.kind} className="w-2.5 h-2.5" />
                    <span>{tempOrDash(d.highC, unit)}</span>
                    <span className="text-muted-foreground/70">/{tempOrDash(d.lowC, unit)}</span>
                  </div>
                </div>
              )
            })}
            {days.length === 0 && (
              <div className="col-span-3 text-xs text-muted-foreground text-center py-1">上游未返回预报数据</div>
            )}
          </div>
        </>
      )}

      <div className="text-[10px] text-muted-foreground/70 font-mono space-y-0.5 shrink-0">
        {payload?.stale ? (
          <p className="text-amber-600 dark:text-amber-400">
            本次刷新未成功，以下是 {ageLabel(payload.staleAt ?? payload.fetchedAt)}的历史观测。
          </p>
        ) : (
          <p>观测时间 {observedAtLabel(current?.observedAt ?? null)}（{city.name}本地）</p>
        )}
        <p className="text-center">
          数据源 Open-Meteo ·{' '}
          {state.kind === 'ready' ? `${ageLabel(payload!.fetchedAt)}更新` : '尚未取到数据'}
        </p>
        {aqi === null && payload?.aqiNote && <p className="text-center text-muted-foreground/80">{payload.aqiNote}</p>}
      </div>
    </div>
  )
}
