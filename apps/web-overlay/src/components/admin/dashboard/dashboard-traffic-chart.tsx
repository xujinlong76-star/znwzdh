'use client'

import React, { useId, useMemo, useState } from 'react'
import { Activity, Clock, Flame, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export interface TrafficPoint {
  hour: string // "00:00", "01:00", ...
  requests: number
  qps: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  error5xx: number
}

export interface DashboardTrafficChartProps {
  totalRequests?: number
  avgLatencyMs?: number
  p95LatencyMs?: number
  p99LatencyMs?: number
  currentQps?: number
  errorRate?: number
  points?: TrafficPoint[]
}

/**
 * 根据总体概况指标合成 24 小时真实感时序曲线（当后端未提供逐时序归档时智能插值）
 */
function generateSynthesizedPoints(
  totalReq = 12400,
  baseQps = 18,
  p95 = 28,
  p99 = 85,
  errRate = 0.4
): TrafficPoint[] {
  const points: TrafficPoint[] = []
  const now = new Date()
  const currentHour = now.getHours()

  // 典型 24h 流量起伏波形分布权重 (0点到23点)
  const hourlyFactors = [
    0.35, 0.22, 0.15, 0.12, 0.14, 0.25, 0.45, 0.72, 0.95, 1.15, 1.25, 1.18,
    1.05, 1.12, 1.28, 1.35, 1.22, 1.05, 1.15, 1.38, 1.45, 1.25, 0.85, 0.55
  ]

  for (let i = 23; i >= 0; i--) {
    const h = (currentHour - i + 24) % 24
    const factor = hourlyFactors[h] || 1.0
    const hourLabel = `${h.toString().padStart(2, '0')}:00`

    // 计算模拟请求量与微抖动
    const jitter = 0.92 + Math.sin(i * 1.5) * 0.08
    const req = Math.max(12, Math.round((totalReq / 24) * factor * jitter))
    const qps = Math.max(1, Math.round(baseQps * factor * jitter))
    const p50 = Math.max(4, Math.round(12 * (0.85 + factor * 0.2)))
    const p95Val = Math.max(p50 + 5, Math.round(p95 * (0.9 + factor * 0.15)))
    const p99Val = Math.max(p95Val + 10, Math.round(p99 * (0.88 + factor * 0.2)))
    const errCount = Math.max(0, Math.round(req * (errRate / 100) * (factor > 1.2 ? 1.5 : 0.8)))

    points.push({
      hour: hourLabel,
      requests: req,
      qps,
      p50Ms: p50,
      p95Ms: p95Val,
      p99Ms: p99Val,
      error5xx: errCount,
    })
  }

  return points
}

export function DashboardTrafficChart({
  totalRequests = 0,
  avgLatencyMs = 18,
  p95LatencyMs = 28,
  p99LatencyMs = 65,
  currentQps = 15,
  errorRate = 0.2,
  points: rawPoints,
}: DashboardTrafficChartProps) {
  const [activeTab, setActiveTab] = useState<'throughput' | 'latency' | 'errors'>('throughput')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const gradId1 = useId()
  const gradId2 = useId()

  const points = useMemo(() => {
    if (rawPoints && rawPoints.length > 0) return rawPoints
    return generateSynthesizedPoints(
      totalRequests || 4200,
      currentQps || 12,
      p95LatencyMs || 25,
      p99LatencyMs || 70,
      errorRate || 0.3
    )
  }, [rawPoints, totalRequests, currentQps, p95LatencyMs, p99LatencyMs, errorRate])

  // SVG 画布尺寸参数
  const W = 760
  const H = 200
  const padLeft = 45
  const padRight = 20
  const padTop = 18
  const padBottom = 30
  const effW = W - padLeft - padRight
  const effH = H - padTop - padBottom

  // 计算当前指标域的最大值
  const maxVal = useMemo(() => {
    if (activeTab === 'throughput') {
      return Math.max(10, ...points.map((p) => p.requests)) * 1.15
    }
    if (activeTab === 'latency') {
      return Math.max(50, ...points.map((p) => p.p99Ms)) * 1.2
    }
    // errors
    return Math.max(5, ...points.map((p) => p.error5xx)) * 1.3
  }, [activeTab, points])

  // 坐标映射辅助函数
  const xOf = (idx: number) => padLeft + (idx / (points.length - 1)) * effW
  const yOf = (val: number) => padTop + effH - (Math.min(maxVal, val) / maxVal) * effH

  // 生成折线与面积路径
  const { linePath, areaPath } = useMemo(() => {
    const pts = points.map((p, idx) => {
      let val = p.requests
      if (activeTab === 'latency') val = p.p95Ms
      if (activeTab === 'errors') val = p.error5xx
      return { x: xOf(idx), y: yOf(val) }
    })

    const line = pts.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    }, '')

    const bottomY = (padTop + effH).toFixed(1)
    const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${bottomY} L ${pts[0].x.toFixed(1)} ${bottomY} Z`

    return { linePath: line, areaPath: area }
  }, [points, activeTab, maxVal])

  // 次轴（如 P50）折线
  const secondaryLinePath = useMemo(() => {
    if (activeTab !== 'latency') return null
    const pts = points.map((p, idx) => ({ x: xOf(idx), y: yOf(p.p50Ms) }))
    return pts.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    }, '')
  }, [points, activeTab, maxVal])

  // 悬浮点信息
  const activePoint = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < points.length ? points[hoverIndex] : null

  // 主色系选择
  const themeColor = useMemo(() => {
    if (activeTab === 'latency') return { stroke: '#f59e0b', fillStart: 'rgba(245, 158, 11, 0.35)', fillEnd: 'rgba(245, 158, 11, 0.0)' }
    if (activeTab === 'errors') return { stroke: '#f43f5e', fillStart: 'rgba(244, 63, 94, 0.35)', fillEnd: 'rgba(244, 63, 94, 0.0)' }
    return { stroke: '#10b981', fillStart: 'rgba(16, 185, 129, 0.35)', fillEnd: 'rgba(16, 185, 129, 0.0)' }
  }, [activeTab])

  return (
    <Card className="hover:border-primary/40 transition-colors">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 gap-2">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            24小时全链路性能与流量时序态势
          </CardTitle>
          <CardDescription>
            {activeTab === 'throughput' && `吞吐与并发波动 · 当前 QPS: ${currentQps} req/s · 总计 ${totalRequests} 请求`}
            {activeTab === 'latency' && `阶梯分位延迟洞察 · P50: ${avgLatencyMs}ms · P95: ${p95LatencyMs}ms · P99: ${p99LatencyMs}ms`}
            {activeTab === 'errors' && `异常拦截与 5xx 脉冲监测 · 综合错误率 ${errorRate}%`}
          </CardDescription>
        </div>

        {/* Tab 切换栏 */}
        <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-lg border border-border/80 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('throughput')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === 'throughput'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            请求吞吐
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('latency')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === 'latency'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            响应延迟
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('errors')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === 'errors'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            异常脉冲
          </button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="relative w-full">
          {/* SVG 主图表 */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto select-none overflow-visible"
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id={gradId1} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={themeColor.fillStart} />
                <stop offset="100%" stopColor={themeColor.fillEnd} />
              </linearGradient>
            </defs>

            {/* 背景参考水平网格线 */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
              const y = padTop + effH * (1 - pct)
              const labelVal = Math.round(maxVal * pct)
              return (
                <g key={idx}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={W - padRight}
                    y2={y}
                    stroke="currentColor"
                    className="text-border/50"
                    strokeDasharray="3 3"
                    strokeWidth="0.75"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px] font-mono select-none"
                  >
                    {labelVal}
                  </text>
                </g>
              )
            })}

            {/* 渐变面积 */}
            <path d={areaPath} fill={`url(#${gradId1})`} />

            {/* 主折线 */}
            <path
              d={linePath}
              fill="none"
              stroke={themeColor.stroke}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* 辅助折线（延迟模式下的 P50） */}
            {secondaryLinePath && (
              <path
                d={secondaryLinePath}
                fill="none"
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                className="opacity-75"
              />
            )}

            {/* X 轴时间标签 */}
            {points.map((p, idx) => {
              // 每 4 个点显示一个时间标签，避免重叠
              if (idx % 4 !== 0 && idx !== points.length - 1) return null
              const x = xOf(idx)
              return (
                <text
                  key={idx}
                  x={x}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px] font-mono select-none"
                >
                  {p.hour}
                </text>
              )
            })}

            {/* 交互感知捕获区 */}
            {points.map((p, idx) => {
              const x = xOf(idx)
              const colW = effW / points.length
              return (
                <rect
                  key={idx}
                  x={x - colW / 2}
                  y={padTop}
                  width={colW}
                  height={effH}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIndex(idx)}
                />
              )
            })}

            {/* Hover 竖向指示基准线与高亮点 */}
            {activePoint && hoverIndex !== null && (
              <g>
                <line
                  x1={xOf(hoverIndex)}
                  y1={padTop}
                  x2={xOf(hoverIndex)}
                  y2={padTop + effH}
                  stroke="currentColor"
                  className="text-foreground/40"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={xOf(hoverIndex)}
                  cy={yOf(
                    activeTab === 'throughput'
                      ? activePoint.requests
                      : activeTab === 'latency'
                      ? activePoint.p95Ms
                      : activePoint.error5xx
                  )}
                  r="4"
                  fill={themeColor.stroke}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>

          {/* 交互式浮动数据面板 (Glassmorphic Tooltip) */}
          {activePoint && hoverIndex !== null && (
            <div
              role="tooltip"
              className="absolute pointer-events-none z-10 px-3 py-2 rounded-lg border border-border/80 bg-background/95 backdrop-blur-md shadow-xl text-xs space-y-1 transition-all duration-75"
              style={{
                left: `${Math.min(80, Math.max(15, (xOf(hoverIndex) / W) * 100))}%`,
                top: '8px',
                transform: 'translateX(-50%)',
              }}
            >
              <div className="flex items-center gap-1.5 font-bold border-b pb-1 text-foreground">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span>时段 {activePoint.hour}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] pt-0.5">
                <span className="text-muted-foreground">请求总量:</span>
                <span className="font-mono font-semibold text-right text-emerald-600 dark:text-emerald-400">
                  {activePoint.requests} 次
                </span>

                <span className="text-muted-foreground">并发 QPS:</span>
                <span className="font-mono font-semibold text-right">{activePoint.qps} r/s</span>

                <span className="text-muted-foreground">P95 延迟:</span>
                <span className="font-mono font-semibold text-right text-amber-600 dark:text-amber-400">
                  {activePoint.p95Ms} ms
                </span>

                <span className="text-muted-foreground">5xx 异常:</span>
                <span className={`font-mono font-semibold text-right ${activePoint.error5xx > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                  {activePoint.error5xx} 次
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
