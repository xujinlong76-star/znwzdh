'use client'

import React, { useMemo } from 'react'
import type { VideoDanmakuItem } from '@/types/navigation'
import {
  clusterConfusionHotspots,
  type ConfusionHotspot,
} from '@/lib/video-danmaku-sentiment'
import { formatDuration } from '@/lib/video-format'
import { AlertCircle, HelpCircle, Play, Sparkles, CheckCircle2 } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'

interface VideoConfusionRadarProps {
  danmaku: VideoDanmakuItem[]
  onSeek?: (timeSec: number) => void
  className?: string
}

export function VideoConfusionRadar({
  danmaku,
  onSeek,
  className,
}: VideoConfusionRadarProps) {
  const hotspots = useMemo(() => {
    return clusterConfusionHotspots(danmaku)
  }, [danmaku])

  if (hotspots.length === 0) {
    return (
      <div className={cn("p-4 rounded-xl border bg-card text-center text-xs text-muted-foreground space-y-1", className)}>
        <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto opacity-70" />
        <p>全片暂无密集疑惑堵点，大家学得很顺畅！</p>
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <span>全网技术疑惑堵点雷达 ({hotspots.length} 处高频痛点)</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          AI 智能避坑聚合
        </span>
      </div>

      <div className="space-y-2">
        {hotspots.map((hs, idx) => (
          <div
            key={idx}
            className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40 transition-all text-xs space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-mono text-amber-500 font-semibold">
                <span>⏱ {formatDuration(hs.timeSec)}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400">
                  {hs.confusionCount} 条弹幕反馈
                </span>
              </div>

              {onSeek && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px] px-2 gap-1 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                  onClick={() => onSeek(hs.timeSec)}
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  跳转到该处
                </Button>
              )}
            </div>

            {/* Sample questions */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">学员典型提问：</span>
              <div className="flex flex-wrap gap-1">
                {hs.sampleDanmaku.map((q, qIdx) => (
                  <span
                    key={qIdx}
                    className="text-[11px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300"
                  >
                    &quot;{q}&quot;
                  </span>
                ))}
              </div>
            </div>

            {/* AI Diagnostic Advice */}
            <div className="p-2 rounded bg-zinc-950/80 border border-zinc-800/60 text-[11px] text-zinc-200 leading-relaxed flex items-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
              <span>{hs.diagnosticRecommendation}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
