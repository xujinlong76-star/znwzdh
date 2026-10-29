'use client'

import React, { useState, useRef, useMemo } from 'react'
import { chapterStartSec, type VideoChapter, type VideoDanmakuItem } from '@/types/navigation'
import {
  generateEngagementHeatmap,
  buildHeatmapSvgPath,
  type EngagementHeatmapPoint,
} from '@/lib/video-scrubber-filmstrip'
import { formatDuration } from '@/lib/video-format'
import { cn } from '@/lib/utils'

interface VideoHeatmapTimelineProps {
  durationSec: number
  currentSec: number
  chapters?: VideoChapter[]
  danmaku?: VideoDanmakuItem[]
  onSeek?: (timeSec: number) => void
  className?: string
}

export function VideoHeatmapTimeline({
  durationSec,
  currentSec,
  chapters = [],
  danmaku = [],
  onSeek,
  className,
}: VideoHeatmapTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [hoverLabel, setHoverLabel] = useState<string | null>(null)

  const points = useMemo(() => {
    return generateEngagementHeatmap({
      durationSec,
      chapters,
      danmaku,
      samplesCount: 120,
    })
  }, [durationSec, chapters, danmaku])

  const svgPaths = useMemo(() => {
    return buildHeatmapSvgPath(points, 600, 36)
  }, [points])

  const progressPercent = durationSec > 0 ? Math.min(100, Math.max(0, (currentSec / durationSec) * 100)) : 0

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || durationSec <= 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const relativeX = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const ratio = relativeX / rect.width
    const time = Math.round(ratio * durationSec)

    setHoverX(relativeX)
    setHoverTime(time)

    // Find closest peak label
    const closest = points.find(p => Math.abs(p.timeSec - time) < (durationSec / 50))
    setHoverLabel(closest?.label || null)
  }

  const handleMouseLeave = () => {
    setHoverTime(null)
    setHoverX(null)
    setHoverLabel(null)
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || durationSec <= 0 || !onSeek) return
    const rect = containerRef.current.getBoundingClientRect()
    const relativeX = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const ratio = relativeX / rect.width
    const time = Math.round(ratio * durationSec)
    onSeek(time)
  }

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label="播放进度热力图（方向键微调，Home/End 跳到首尾）"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, durationSec)}
      aria-valuenow={Math.round(currentSec)}
      aria-valuetext={`${formatDuration(currentSec)} / ${formatDuration(durationSec)}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (!onSeek) return
        const step = 5
        if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, currentSec - step)) }
        else if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(durationSec, currentSec + step)) }
        else if (e.key === 'Home') { e.preventDefault(); onSeek(0) }
        else if (e.key === 'End') { e.preventDefault(); onSeek(durationSec) }
      }}
      className={cn(
        "relative w-full h-9 bg-zinc-950/60 rounded-md overflow-hidden cursor-pointer select-none group border border-zinc-800/60 hover:border-zinc-700 transition-colors",
        className
      )}
    >
      {/* SVG Waveform Area */}
      <svg
        viewBox="0 0 600 36"
        preserveAspectRatio="none"
        className="w-full h-full pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity"
      >
        <defs>
          <linearGradient id="heatGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.6" />
            <stop offset="60%" stopColor="#06b6d4" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Heatmap Area Fill */}
        {svgPaths.areaPath && (
          <path d={svgPaths.areaPath} fill="url(#heatGradient)" />
        )}

        {/* Waveform Top Stroke */}
        {svgPaths.linePath && (
          <path d={svgPaths.linePath} fill="none" stroke="#34d399" strokeWidth="1.5" />
        )}
      </svg>

      {/* Chapter Marker Dots */}
      {chapters.map(ch => {
        const leftPercent = durationSec > 0 ? (chapterStartSec(ch) / durationSec) * 100 : 0
        return (
          <div
            key={ch.id}
            style={{ left: `${leftPercent}%` }}
            className={cn(
              "absolute bottom-0 w-1 h-3 pointer-events-none -translate-x-1/2 rounded-t",
              ch.codeSnippet ? "bg-amber-400" : "bg-zinc-400/60"
            )}
            title={ch.title}
          />
        )
      })}

      {/* Progress Bar Fill */}
      <div
        className="absolute bottom-0 left-0 h-1 bg-primary/80 transition-all pointer-events-none"
        style={{ width: `${progressPercent}%` }}
      />

      {/* Playhead Marker */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-primary pointer-events-none"
        style={{ left: `${progressPercent}%` }}
      />

      {/* Hover Line & Tooltip */}
      {hoverX !== null && hoverTime !== null && (
        <>
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/70 pointer-events-none"
            style={{ left: `${hoverX}px` }}
          />

          <div
            className="absolute bottom-10 -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center animate-in fade-in zoom-in-95 duration-100"
            style={{ left: `${hoverX}px` }}
          >
            <div className="bg-zinc-950/95 text-zinc-100 text-[10px] px-2 py-1 rounded shadow-xl border border-zinc-700/80 backdrop-blur whitespace-nowrap flex flex-col items-center gap-0.5">
              <span className="font-mono font-bold text-emerald-400">
                {formatDuration(hoverTime)}
              </span>
              {hoverLabel && (
                <span className="text-[9px] text-zinc-300 max-w-[180px] truncate">
                  🔥 {hoverLabel}
                </span>
              )}
            </div>
            {/* Arrow */}
            <div className="w-1.5 h-1.5 bg-zinc-950 border-r border-b border-zinc-700 -rotate-45 -mt-1" />
          </div>
        </>
      )}
    </div>
  )
}
