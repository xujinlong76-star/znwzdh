'use client'

import React, { useState } from 'react'
import { AlertTriangle, Check, Copy, Gauge } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'

export interface SlowRouteItem {
  route: string
  method: string
  avgLatencyMs: number
  count: number
}

export interface DashboardSlowRoutesProps {
  routes?: SlowRouteItem[]
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  POST: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
  PUT: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  DELETE: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  PATCH: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
}

export function DashboardSlowRoutes({ routes }: DashboardSlowRoutesProps) {
  const [copiedRoute, setCopiedRoute] = useState<string | null>(null)

  const handleCopy = async (route: string) => {
    const success = await copyText(route)
    if (success) {
      setCopiedRoute(route)
      setTimeout(() => setCopiedRoute(null), 1800)
    }
  }

  const safeRoutes = routes && routes.length > 0 ? routes : []
  const maxLatency = Math.max(100, ...safeRoutes.map((r) => r.avgLatencyMs))

  return (
    <div className="border rounded-xl divide-y text-xs overflow-hidden bg-card/60 shadow-sm">
      <div className="px-3.5 py-2 bg-muted/40 font-medium text-muted-foreground flex justify-between items-center">
        <span className="flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-primary" />
          <span>耗时最高路由排障 (Top 5 慢请求治理)</span>
        </span>
        <span>平均响应 · 采样量</span>
      </div>

      {safeRoutes.length > 0 ? (
        safeRoutes.map((r) => {
          const isCopied = copiedRoute === r.route
          const methodBadgeClass = METHOD_COLORS[r.method.toUpperCase()] || 'bg-muted text-muted-foreground'
          const latencyBarWidth = Math.min(100, Math.max(8, (r.avgLatencyMs / maxLatency) * 100))

          // 延迟评级色标：>150ms 警告红，>80ms 观察橙，<=80ms 稳健黄绿
          const latencyTextClass =
            r.avgLatencyMs >= 150
              ? 'text-rose-600 dark:text-rose-400 font-bold'
              : r.avgLatencyMs >= 80
              ? 'text-amber-600 dark:text-amber-400 font-semibold'
              : 'text-foreground font-medium'

          return (
            <div
              key={`${r.method}-${r.route}`}
              className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors group"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Badge
                  variant="outline"
                  className={`text-[10px] h-4 px-1 font-mono uppercase shrink-0 font-bold ${methodBadgeClass}`}
                >
                  {r.method}
                </Badge>

                <span
                  title={r.route}
                  className="font-mono text-xs truncate max-w-[160px] sm:max-w-[260px] md:max-w-[340px] text-foreground"
                >
                  {r.route}
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                  aria-label={`${r.route} - 复制路由路径`}
                  onClick={() => handleCopy(r.route)}
                >
                  {isCopied ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>

              <div className="flex flex-col items-end shrink-0 min-w-[100px]">
                <div className="flex items-center gap-1.5 font-mono">
                  <span className={latencyTextClass}>{r.avgLatencyMs} ms</span>
                  <span className="text-[11px] text-muted-foreground">({r.count}次)</span>
                </div>

                {/* 相对延迟占用微进度条 */}
                <div className="w-16 h-1 bg-muted rounded-full overflow-hidden mt-1">
                  <div
                    className={`h-full rounded-full ${
                      r.avgLatencyMs >= 150
                        ? 'bg-rose-500'
                        : r.avgLatencyMs >= 80
                        ? 'bg-amber-500'
                        : 'bg-primary'
                    }`}
                    style={{ width: `${latencyBarWidth}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })
      ) : (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground space-y-1">
          <p>暂无异常慢请求采样</p>
          <p className="text-[11px] text-muted-foreground/80">接口延迟全部在基线以内（P95 &lt; 50ms）</p>
        </div>
      )}
    </div>
  )
}
