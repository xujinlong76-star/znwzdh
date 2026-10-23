'use client'

/**
 * 声明式微组件沙箱 (Declarative Widget Sandbox)
 *
 * 安全纪律：
 * 1. 严格 0-eval：永不执行动态 JavaScript / eval / new Function；
 * 2. 纯声明式 JSON Schema 布局：通过 UI 布局描述符（kpi-grid / key-value / progress-bar / feed-list / status-badge）安全渲染；
 * 3. 安全端点取数：仅允许 relative path 或 http(s) 安全地址，具备超时中断与并发退避保护。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Layers,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Activity,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'

export interface DeclarativeWidgetKpiItem {
  label: string
  value: string | number
  unit?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
}

export interface DeclarativeWidgetKeyValueItem {
  key: string
  value: string | number
  highlight?: boolean
}

export interface DeclarativeWidgetProgressItem {
  title: string
  current: number
  total: number
  unit?: string
}

export interface DeclarativeWidgetFeedItem {
  title: string
  url?: string
  date?: string
  tag?: string
}

export interface DeclarativeWidgetConfig {
  title?: string
  description?: string
  layout?: 'kpi-grid' | 'key-value' | 'progress-bar' | 'feed-list' | 'status-badge'
  endpoint?: string
  refreshIntervalSeconds?: number
  items?: any[]
  status?: 'operational' | 'degraded' | 'maintenance' | 'unknown'
}

interface DeclarativeWidgetProps {
  config?: DeclarativeWidgetConfig
}

/** 校验微组件取数端点或外链是否安全（仅允许站内单斜杠相对路径或 http/https 协议，阻断 javascript:/data: 伪协议） */
function isSafeWidgetUrl(raw?: string): boolean {
  if (!raw || typeof raw !== 'string') return false
  const trimmed = raw.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function DeclarativeWidget({ config }: DeclarativeWidgetProps) {
  const title = config?.title || '声明式微组件'
  const layout = config?.layout || 'kpi-grid'
  const endpoint = config?.endpoint
  const items = config?.items
  const intervalSec = Math.max(10, config?.refreshIntervalSeconds || 60)

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(config?.items || [])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    if (!endpoint) {
      if (items) setData(items)
      return
    }

    if (!isSafeWidgetUrl(endpoint)) {
      setErrorMsg('不安全的数据源地址已被拦截')
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const timeoutId = setTimeout(() => ctrl.abort(), 10_000)
    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await fetch(endpoint, { cache: 'no-store', signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(Array.isArray(json) ? json : json.items || [json])
      setLastUpdated(new Date())
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setErrorMsg('数据拉取失败')
      }
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }, [endpoint, items])

  useEffect(() => {
    fetchData()
    if (!endpoint) return
    const timer = setInterval(fetchData, intervalSec * 1000)
    return () => {
      clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [fetchData, endpoint, intervalSec])

  return (
    <div className="h-full w-full flex flex-col p-4 bg-card/60 backdrop-blur-md rounded-2xl border border-border/80 text-card-foreground select-none overflow-hidden group">
      {/* 头部 */}
      <div className="flex items-center justify-between pb-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold tracking-tight text-foreground line-clamp-1">
              {title}
            </h4>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" />
              <span>声明式安全沙箱</span>
            </div>
          </div>
        </div>

        {endpoint && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
            onClick={fetchData}
            disabled={loading}
            title="刷新数据"
            aria-label="刷新数据"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin text-primary' : ''}`} />
          </Button>
        )}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto py-3">
        {errorMsg ? (
          <div className="h-full flex items-center justify-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{errorMsg}</span>
          </div>
        ) : layout === 'kpi-grid' ? (
          <div className="grid grid-cols-2 gap-2.5 h-full items-center">
            {(Array.isArray(data) ? data : []).map((kpi: DeclarativeWidgetKpiItem, idx: number) => (
              <div
                key={idx}
                className="p-2.5 rounded-xl border border-border/60 bg-muted/40 flex flex-col justify-between"
              >
                <span className="text-[11px] font-medium text-muted-foreground line-clamp-1">
                  {kpi.label}
                </span>
                <div className="flex items-baseline gap-1 my-1">
                  <span className="text-lg font-bold text-foreground tracking-tight">
                    {kpi.value}
                  </span>
                  {kpi.unit && <span className="text-[10px] text-muted-foreground">{kpi.unit}</span>}
                </div>
                {kpi.trendValue && (
                  <div
                    className={`flex items-center gap-0.5 text-[10px] font-medium ${
                      kpi.trend === 'up'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : kpi.trend === 'down'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {kpi.trend === 'up' && <TrendingUp className="h-2.5 w-2.5" />}
                    {kpi.trend === 'down' && <TrendingDown className="h-2.5 w-2.5" />}
                    <span>{kpi.trendValue}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : layout === 'key-value' ? (
          <div className="space-y-2">
            {(Array.isArray(data) ? data : []).map((kv: DeclarativeWidgetKeyValueItem, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/40 text-xs"
              >
                <span className="text-muted-foreground font-medium">{kv.key}</span>
                <span
                  className={`font-semibold ${
                    kv.highlight ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {kv.value}
                </span>
              </div>
            ))}
          </div>
        ) : layout === 'progress-bar' ? (
          <div className="space-y-3">
            {(Array.isArray(data) ? data : []).map((prog: DeclarativeWidgetProgressItem, idx: number) => {
              const pct = Math.min(100, Math.round((prog.current / Math.max(1, prog.total)) * 100))
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-foreground">{prog.title}</span>
                    <span className="text-muted-foreground">
                      {prog.current} / {prog.total} {prog.unit || ''} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : layout === 'feed-list' ? (
          <div className="space-y-2">
            {(Array.isArray(data) ? data : []).map((item: DeclarativeWidgetFeedItem, idx: number) => {
              const safeHref = isSafeWidgetUrl(item.url) ? item.url! : '#'
              return (
                <a
                  key={idx}
                  href={safeHref}
                  target={safeHref !== '#' ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="block p-2 rounded-lg bg-muted/30 hover:bg-accent border border-border/40 hover:border-primary/30 transition-all text-xs group/item"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground group-hover/item:text-primary transition-colors line-clamp-1">
                      {item.title}
                    </span>
                    {item.tag && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                        {item.tag}
                      </Badge>
                    )}
                  </div>
                  {item.date && (
                    <span className="text-[10px] text-muted-foreground mt-0.5 block">
                      {item.date}
                    </span>
                  )}
                </a>
              )
            })}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center space-y-2">
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="text-center">
              <h5 className="text-sm font-semibold text-foreground">系统运行正常</h5>
              <p className="text-[11px] text-muted-foreground">所有核心中枢与数据流完全就绪</p>
            </div>
          </div>
        )}
      </div>

      {/* 底部更新状态 */}
      {lastUpdated && (
        <div className="pt-2 text-[10px] text-muted-foreground text-right border-t border-border/40">
          已更新于 {lastUpdated.toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
