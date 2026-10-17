'use client'

import { useEffect, useState } from 'react'
import { Activity, ShieldCheck, Cpu, HardDrive, Database, Sparkles } from 'lucide-react'
import { describeHealth, type HealthTone, type HubHealthLike } from '@/lib/hub-health'

interface HealthStats extends HubHealthLike {
  ok: boolean
}

const TONE_DOT: Record<HealthTone, string> = {
  online: 'bg-emerald-500 animate-ping',
  probing: 'bg-blue-500 animate-ping',
  offline: 'bg-amber-500',
}

const TONE_TEXT: Record<HealthTone, string> = {
  online: 'text-emerald-500',
  probing: 'text-blue-500',
  offline: 'text-amber-500',
}

export function MetricsWidget() {
  const [health, setHealth] = useState<HealthStats | null>(null)
  const [loading, setLoading] = useState(true)
  /** 探测失败要显式记录：以前失败也显示「中枢在线」，属于假绿灯 */
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let unmounted = false
    fetch('/api/hub/health')
      .then((res) => {
        if (!res.ok) throw new Error('health probe failed: HTTP ' + res.status)
        return res.json()
      })
      .then((data) => {
        if (unmounted) return
        if (!data) {
          setFailed(true)
          return
        }
        setHealth(data)
      })
      .catch(() => {
        if (!unmounted) setFailed(true)
      })
      .finally(() => {
        if (!unmounted) setLoading(false)
      })
    return () => {
      unmounted = true
    }
  }, [])

  // 拿不到的数就说未知，绝不填默认值（历史缺陷：站点数缺省时被填成一个固定数字）
  const status = describeHealth(health, failed, loading)
  const modeLabel = status.engineLabel
  const sitesCount = status.sitesLabel
  const semanticStatus = status.semanticLabel

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Activity className="w-3.5 h-3.5 text-blue-500" />
          <span>认知中枢与引擎监控</span>
        </div>
        <span className={`flex items-center gap-1 text-xs font-mono ${TONE_TEXT[status.tone]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[status.tone]}`} />
          {status.label}
        </span>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-2 py-2">
        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>存储引擎架构</span>
            <Database className="w-3 h-3 text-blue-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground truncate">{modeLabel}</div>
          <div className="text-xs text-muted-foreground">{sitesCount}</div>
        </div>

        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>E2EE 零知识金库</span>
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground">AES-256-GCM</div>
          <div className="text-xs text-muted-foreground">PBKDF2 100k 轮加盐</div>
        </div>

        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>语义多路召回</span>
            <Sparkles className="w-3 h-3 text-amber-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground truncate">{semanticStatus}</div>
          <div className="text-xs text-muted-foreground">RRF k=60 动态融合</div>
        </div>

        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>LinUCB / 双曲曲率</span>
            <Cpu className="w-3 h-3 text-purple-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground">α=0.25 · c=-1</div>
          <div className="text-xs text-muted-foreground">Poincaré 双曲空间度量</div>
        </div>
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        {status.tone === 'offline' ? '遥测不可用 · 未能连上中枢' : 'Fastify 运行时遥测指标 · 实时健康同步'}
      </div>
    </div>
  )
}
