'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Activity, RefreshCw, ExternalLink, Settings, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

interface LiveApiWidgetProps {
  config?: {
    title?: string
    apiUrl?: string
    jsonKey?: string
    unit?: string
    refreshIntervalSeconds?: number
  }
}

export function LiveApiWidget({ config }: LiveApiWidgetProps) {
  const title = config?.title || 'REST 接口动态遥测'
  const apiUrl = config?.apiUrl || '/api/hub/health'
  const jsonKey = config?.jsonKey || 'status'
  const unit = config?.unit || ''
  const intervalSec = Math.max(5, config?.refreshIntervalSeconds || 30)

  const [dataValue, setDataValue] = useState<string | number | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [statusOk, setStatusOk] = useState<boolean | null>(null)
  // 性能/资源：请求取消 + 失败指数退避（防后台页签空转与失败接口打爆服务端）
  const abortRef = useRef<AbortController | null>(null)
  const failuresRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    if (!apiUrl) return
    // 切配置时 abort 旧请求，避免竞态覆盖
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch(apiUrl, { cache: 'no-store', signal: ctrl.signal })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json()
      
      // 按点分隔路径提取嵌套字段，例如 'data.metrics.cpu' 或直接 'status'
      let val: any = json
      if (jsonKey && jsonKey.trim()) {
        const parts = jsonKey.trim().split('.')
        for (const p of parts) {
          if (val && typeof val === 'object' && p in val) {
            val = val[p]
          } else {
            val = null
            break
          }
        }
      }

      if (val !== null && val !== undefined) {
        setDataValue(typeof val === 'object' ? JSON.stringify(val) : val)
        setStatusOk(true)
      } else {
        setDataValue(JSON.stringify(json).slice(0, 50))
        setStatusOk(true)
      }
      setLastUpdated(new Date())
      failuresRef.current = 0
    } catch (err: any) {
      // 主动取消不计失败、不刷错误态
      if (err?.name === 'AbortError') return
      failuresRef.current += 1
      setErrorMsg(err.message || '抓取失败')
      setStatusOk(false)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, jsonKey])

  useEffect(() => {
    let cancelled = false
    const schedule = () => {
      // 指数退避：连续失败时拉长间隔（上限 5 分钟），成功后 reset
      const backoffMs = Math.min(300_000, intervalSec * 1000 * Math.pow(2, Math.min(5, failuresRef.current)))
      timerRef.current = setTimeout(async () => {
        if (cancelled) return
        // 后台页签暂停轮询（visibilitychange 也会即时清理/恢复）
        if (!document.hidden) {
          await fetchData()
        }
        schedule()
      }, backoffMs)
    }
    void fetchData()
    schedule()
    const onVisibility = () => {
      // 切回可见立即刷新一次；切后台时 abort 进行中的请求
      if (document.hidden) {
        abortRef.current?.abort()
      } else {
        void fetchData()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      // unmount abort：防止 setState on unmounted + 释放连接
      abortRef.current?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchData, intervalSec])

  return (
    <div className="flex flex-col h-full justify-between p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-500 border border-sky-500/20">
            <Activity className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground truncate max-w-[140px]">{title}</h4>
            <p className="text-[10px] text-muted-foreground truncate max-w-[150px] font-mono">{apiUrl}</p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={() => void fetchData()}
          disabled={loading}
          title="手动刷新数据"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="py-2 px-3 rounded-lg bg-muted/30 border border-border/40 flex items-center justify-between">
        <div>
          <div className="text-[10px] text-muted-foreground">提取字段: <span className="font-mono text-foreground">{jsonKey}</span></div>
          <div className="text-lg font-bold font-mono tracking-tight text-foreground flex items-center gap-1.5">
            {errorMsg ? (
              <span className="text-xs text-rose-500 font-normal">异常: {errorMsg}</span>
            ) : dataValue !== null ? (
              <>
                <span>{String(dataValue)}</span>
                {unit && <span className="text-xs text-muted-foreground font-normal">{unit}</span>}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">正在轮询...</span>
            )}
          </div>
        </div>

        <div>
          {statusOk === true ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-medium">
              <CheckCircle2 className="w-2.5 h-2.5" /> 正常
            </span>
          ) : statusOk === false ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20 font-medium">
              <AlertCircle className="w-2.5 h-2.5" /> 异常
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30">
        <span>轮询频率: {intervalSec}s</span>
        <span>{lastUpdated ? `更新于 ${lastUpdated.toLocaleTimeString()}` : '等待同步'}</span>
      </div>
    </div>
  )
}
