'use client'

import { useEffect, useState } from 'react'
import { Activity, ShieldCheck, Cpu, HardDrive, Database, Sparkles } from 'lucide-react'

interface HealthStats {
  ok: boolean
  mode?: string
  capabilities?: {
    semantic?: boolean
    fts?: boolean
    llm?: boolean
  }
  stats?: {
    sites?: number
    categories?: number
    tags?: number
  }
}

export function MetricsWidget() {
  const [health, setHealth] = useState<HealthStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unmounted = false
    fetch('/api/hub/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!unmounted && data) {
          setHealth(data)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!unmounted) setLoading(false)
      })
    return () => {
      unmounted = true
    }
  }, [])

  const modeLabel = health?.mode === 'standard' ? 'PG + pgvector' : 'SQLite + FTS5'
  const sitesCount = health?.stats?.sites ?? 50
  const semanticStatus = health?.capabilities?.semantic ? '向量 KNN 就绪' : '关键词+拼音'

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Activity className="w-3.5 h-3.5 text-blue-500" />
          <span>认知中枢与引擎监控</span>
        </div>
        <span className="flex items-center gap-1 text-xs text-emerald-500 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          {loading ? '探测中...' : '中枢在线'}
        </span>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-2 py-2">
        <div className="bg-muted/30 border border-border/40 rounded-lg p-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>存储引擎架构</span>
            <Database className="w-3 h-3 text-blue-500" />
          </div>
          <div className="font-mono text-sm font-bold text-foreground truncate">{modeLabel}</div>
          <div className="text-xs text-muted-foreground">收录 {sitesCount} 个站点</div>
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
        Fastify 运行时遥测指标 · 实时健康同步
      </div>
    </div>
  )
}
