'use client'

import React, { useState, useEffect, useCallback } from 'react'
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

  const fetchData = useCallback(async () => {
    if (!apiUrl) return
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch(apiUrl, { cache: 'no-store' })
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
    } catch (err: any) {
      setErrorMsg(err.message || '抓取失败')
      setStatusOk(false)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, jsonKey])

  useEffect(() => {
    void fetchData()
    const timer = setInterval(() => {
      void fetchData()
    }, intervalSec * 1000)
    return () => clearInterval(timer)
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
