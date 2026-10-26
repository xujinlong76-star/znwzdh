'use client'

import React, { useId } from 'react'

export interface DashboardSparklineProps {
  data: number[]
  color?: 'emerald' | 'amber' | 'rose' | 'blue' | 'violet' | 'indigo'
  width?: number
  height?: number
  className?: string
}

const COLOR_MAP = {
  emerald: {
    stroke: '#10b981',
    fillStart: 'rgba(16, 185, 129, 0.35)',
    fillEnd: 'rgba(16, 185, 129, 0.0)',
  },
  amber: {
    stroke: '#f59e0b',
    fillStart: 'rgba(245, 158, 11, 0.35)',
    fillEnd: 'rgba(245, 158, 11, 0.0)',
  },
  rose: {
    stroke: '#f43f5e',
    fillStart: 'rgba(244, 63, 94, 0.35)',
    fillEnd: 'rgba(244, 63, 94, 0.0)',
  },
  blue: {
    stroke: '#3b82f6',
    fillStart: 'rgba(59, 130, 246, 0.35)',
    fillEnd: 'rgba(59, 130, 246, 0.0)',
  },
  violet: {
    stroke: '#8b5cf6',
    fillStart: 'rgba(139, 92, 246, 0.35)',
    fillEnd: 'rgba(139, 92, 246, 0.0)',
  },
  indigo: {
    stroke: '#6366f1',
    fillStart: 'rgba(99, 102, 241, 0.35)',
    fillEnd: 'rgba(99, 102, 241, 0.0)',
  },
}

export function DashboardSparkline({
  data,
  color = 'indigo',
  width = 120,
  height = 36,
  className = '',
}: DashboardSparklineProps) {
  const gradientId = useId()
  const c = COLOR_MAP[color] || COLOR_MAP.indigo

  // 安全检查：至少需要 2 个点
  const safeData = data.length < 2 ? [0, ...(data.length === 1 ? [data[0]] : [0, 0])] : data
  const min = Math.min(...safeData)
  const max = Math.max(...safeData)
  const range = max === min ? 1 : max - min

  const padX = 2
  const padY = 3
  const effW = width - padX * 2
  const effH = height - padY * 2

  const pts = safeData.map((val, idx) => {
    const x = padX + (idx / (safeData.length - 1)) * effW
    const y = padY + effH - ((val - min) / range) * effH
    return { x, y }
  })

  // 生成折线路径
  const linePath = pts.reduce((acc, p, idx) => {
    return idx === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  }, '')

  // 生成闭合渐变面积路径
  const lastX = pts[pts.length - 1].x.toFixed(1)
  const firstX = pts[0].x.toFixed(1)
  const bottomY = (height - 1).toFixed(1)
  const areaPath = `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`

  const lastPoint = pts[pts.length - 1]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible select-none shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.fillStart} />
          <stop offset="100%" stopColor={c.fillEnd} />
        </linearGradient>
      </defs>

      {/* 渐变面积 */}
      <path d={areaPath} fill={`url(#${gradientId})`} />

      {/* 平滑主折线 */}
      <path
        d={linePath}
        fill="none"
        stroke={c.stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 终点呼吸脉冲圆点 */}
      <circle cx={lastPoint.x} cy={lastPoint.y} r="2.5" fill={c.stroke} />
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r="4.5"
        fill="none"
        stroke={c.stroke}
        strokeWidth="1"
        className="opacity-60 animate-ping"
      />
    </svg>
  )
}
