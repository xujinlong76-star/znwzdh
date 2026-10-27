'use client'

import React from 'react'
import type { QoEMetrics } from '@/lib/video-qoe-telemetry'
import { Popover, PopoverContent, PopoverTrigger } from '@/registry/new-york/ui/popover'
import { Button } from '@/registry/new-york/ui/button'
import { Activity, Wifi, ShieldAlert, CheckCircle2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoNetworkSentinelProps {
  metrics: QoEMetrics
  onFailoverTrigger?: () => void
  className?: string
}

export function VideoNetworkSentinel({
  metrics,
  onFailoverTrigger,
  className,
}: VideoNetworkSentinelProps) {
  const statusStyles: Record<QoEMetrics['status'], { badge: string; dot: string; text: string }> = {
    excellent: {
      badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20',
      dot: 'bg-emerald-500',
      text: '网络极佳',
    },
    good: {
      badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20',
      dot: 'bg-blue-500',
      text: '网络稳定',
    },
    degraded: {
      badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20',
      dot: 'bg-amber-500 animate-pulse',
      text: '网络轻微抖动',
    },
    critical: {
      badge: 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20',
      dot: 'bg-red-500 animate-ping',
      text: '弱网高延迟',
    },
  }

  const currentStyle = statusStyles[metrics.status] || statusStyles.good

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono border transition-all select-none cursor-pointer",
            currentStyle.badge,
            className
          )}
          title="查看实时流媒体传输质量 (QoE)"
        >
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", currentStyle.dot)} />
          <Activity className="w-3 h-3" />
          <span>{metrics.healthScore}分</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        className="w-72 p-3 bg-zinc-950/95 border border-zinc-800 text-zinc-200 text-xs shadow-2xl backdrop-blur space-y-3"
      >
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-zinc-100">
            <Wifi className="w-4 h-4 text-primary" />
            <span>QoE 播放体验遥测</span>
          </div>
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", currentStyle.badge)}>
            {currentStyle.text}
          </span>
        </div>

        {/* Telemetry Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800/50 space-y-0.5">
            <span className="text-[10px] text-zinc-400">估算下行带宽</span>
            <div className="font-bold text-zinc-100 text-sm">
              {metrics.estimatedBandwidthMbps} <span className="text-[10px] font-normal text-zinc-400">Mbps</span>
            </div>
          </div>

          <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800/50 space-y-0.5">
            <span className="text-[10px] text-zinc-400">首帧缓冲 (TTFB)</span>
            <div className="font-bold text-zinc-100 text-sm">
              {metrics.ttfbMs} <span className="text-[10px] font-normal text-zinc-400">ms</span>
            </div>
          </div>

          <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800/50 space-y-0.5">
            <span className="text-[10px] text-zinc-400">卡顿重缓冲次数</span>
            <div className="font-bold text-zinc-100 text-sm">
              {metrics.rebufferCount} <span className="text-[10px] font-normal text-zinc-400">次</span>
            </div>
          </div>

          <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800/50 space-y-0.5">
            <span className="text-[10px] text-zinc-400">网络连接制式</span>
            <div className="font-bold text-emerald-400 text-sm uppercase">
              {metrics.networkType}
            </div>
          </div>
        </div>

        {/* Protection / Failover action */}
        {metrics.status === 'critical' ? (
          <div className="p-2 rounded bg-red-950/40 border border-red-800/60 text-red-300 text-[11px] space-y-1.5">
            <div className="flex items-center gap-1 font-semibold">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>检测到卡顿滞后，建议切换低延迟线路</span>
            </div>
            {onFailoverTrigger && (
              <Button
                size="sm"
                variant="destructive"
                className="w-full h-7 text-xs gap-1"
                onClick={onFailoverTrigger}
              >
                <RefreshCw className="w-3 h-3" /> 立即熔断切换镜像线路
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 pt-1 border-t border-zinc-900">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>自适应码率平稳，缓存健康度良好</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
