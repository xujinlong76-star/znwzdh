'use client'

import React, { useMemo } from 'react'
import { Bot, CheckCircle2, Cpu, Database, ShieldAlert, Sparkles, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export interface DashboardStatusDonutProps {
  statusCodes?: {
    s2xx: number
    s3xx: number
    s4xx: number
    s5xx: number
    errorRate?: number
  }
  totalRequests?: number
  p50LatencyMs?: number
  p99LatencyMs?: number
  capabilities?: {
    semantic: boolean
    fts: boolean
    llm: boolean
    notes?: string[]
  }
}

export function DashboardStatusDonut({
  statusCodes = { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, errorRate: 0 },
  totalRequests = 0,
  p50LatencyMs = 12,
  p99LatencyMs = 65,
  capabilities,
}: DashboardStatusDonutProps) {
  const { s2xx, s3xx, s4xx, s5xx } = statusCodes
  const safeTotal = totalRequests > 0 ? totalRequests : s2xx + s3xx + s4xx + s5xx

  // 计算各段弧长百分比
  const slices = useMemo(() => {
    if (safeTotal === 0) {
      return [
        { key: '2xx', label: '2xx 成功', count: 0, pct: 100, color: '#10b981', strokeClass: 'text-emerald-500' },
      ]
    }
    return [
      { key: '2xx', label: '2xx 成功', count: s2xx, pct: (s2xx / safeTotal) * 100, color: '#10b981', strokeClass: 'text-emerald-500' },
      { key: '3xx', label: '3xx 重定向', count: s3xx, pct: (s3xx / safeTotal) * 100, color: '#3b82f6', strokeClass: 'text-blue-500' },
      { key: '4xx', label: '4xx 客户端', count: s4xx, pct: (s4xx / safeTotal) * 100, color: '#f59e0b', strokeClass: 'text-amber-500' },
      { key: '5xx', label: '5xx 服务端', count: s5xx, pct: (s5xx / safeTotal) * 100, color: '#f43f5e', strokeClass: 'text-rose-500' },
    ]
  }, [s2xx, s3xx, s4xx, s5xx, safeTotal])

  // SLA 成功率计算 (2xx + 3xx) / total
  const slaRate = safeTotal > 0 ? (((s2xx + s3xx) / safeTotal) * 100).toFixed(1) : '100.0'

  // SVG 甜甜圈环形参数 (stroke-dasharray 计算)
  const radius = 60
  const circumference = 2 * Math.PI * radius
  let accumulatedAngle = 0

  return (
    <Card className="hover:border-primary/40 transition-colors flex flex-col justify-between">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            HTTP 状态分布与架构引擎
          </CardTitle>
          <Badge variant="outline" className="font-mono text-xs text-emerald-600 border-emerald-500/30">
            SLA: {slaRate}%
          </Badge>
        </div>
        <CardDescription>
          响应中位数 P50: {p50LatencyMs}ms · 极端长尾 P99: {p99LatencyMs}ms
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 上半部分：甜甜圈图表与图例 */}
        <div className="flex flex-col sm:flex-row items-center justify-around gap-4 pt-1">
          {/* SVG 甜甜圈环 */}
          <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              {/* 底色静止环 */}
              <circle
                cx="80"
                cy="80"
                r={radius}
                fill="none"
                stroke="currentColor"
                className="text-muted/30"
                strokeWidth="16"
              />

              {/* 各分段圆弧 */}
              {safeTotal > 0 ? (
                slices.map((slice) => {
                  const strokeDasharray = `${(slice.pct / 100) * circumference} ${circumference}`
                  const strokeDashoffset = -accumulatedAngle
                  accumulatedAngle += (slice.pct / 100) * circumference

                  if (slice.count === 0) return null

                  return (
                    <circle
                      key={slice.key}
                      cx="80"
                      cy="80"
                      r={radius}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth="16"
                      strokeDasharray={strokeDasharray}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      className="transition-all duration-500"
                    />
                  )
                })
              ) : (
                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="16"
                  strokeDasharray={`${circumference} ${circumference}`}
                />
              )}
            </svg>

            {/* 中心数据文字 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="text-xl font-mono font-bold tracking-tight text-foreground">
                {safeTotal}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Total Req
              </span>
            </div>
          </div>

          {/* 右侧分类图例 */}
          <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 text-xs w-full sm:w-auto">
            {slices.map((slice) => (
              <div key={slice.key} className="flex items-center justify-between gap-3 p-1.5 rounded-md bg-muted/20 border border-border/40">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="font-medium text-foreground">{slice.label}</span>
                </div>
                <div className="font-mono text-right">
                  <span className="font-semibold">{slice.count}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">({slice.pct.toFixed(0)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 下半部分：AI 与底层引擎状态胶囊 */}
        <div className="pt-3 border-t space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-primary" />
              中枢底层计算引擎与向量探针
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {/* FTS5 */}
            <div className="p-2 rounded-lg border bg-card/60 flex flex-col items-center justify-center space-y-1">
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Database className="w-3 h-3" />
                <span>全文检索</span>
              </div>
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                FTS5 (CJK)
              </Badge>
            </div>

            {/* 向量引擎 */}
            <div className="p-2 rounded-lg border bg-card/60 flex flex-col items-center justify-center space-y-1">
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Sparkles className="w-3 h-3" />
                <span>向量通道</span>
              </div>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  capabilities?.semantic
                    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                    : 'border-muted-foreground/30 text-muted-foreground'
                }`}
              >
                {capabilities?.semantic ? 'sqlite-vec (512)' : '未就绪'}
              </Badge>
            </div>

            {/* 大模型审核 */}
            <div className="p-2 rounded-lg border bg-card/60 flex flex-col items-center justify-center space-y-1">
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Bot className="w-3 h-3" />
                <span>AI 严审模型</span>
              </div>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  capabilities?.llm
                    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                    : 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                }`}
              >
                {capabilities?.llm ? '网关就绪' : '备用池接入'}
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
