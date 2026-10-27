'use client'

import React, { useMemo } from 'react'
import {
  type FilmstripThumbnail,
  findClosestThumbnail,
} from '@/lib/video-filmstrip-generator'
import { formatDuration } from '@/lib/video-format'
import { cn } from '@/lib/utils'

interface VideoScrubberPreviewProps {
  hoverSec: number | null
  visible: boolean
  thumbnails: FilmstripThumbnail[]
  positionX: number // pixel or percent
}

export function VideoScrubberPreview({
  hoverSec,
  visible,
  thumbnails,
  positionX,
}: VideoScrubberPreviewProps) {
  const currentThumbnail = useMemo(() => {
    if (hoverSec === null || thumbnails.length === 0) return null
    return findClosestThumbnail(thumbnails, hoverSec)
  }, [hoverSec, thumbnails])

  if (!visible || hoverSec === null || !currentThumbnail) return null

  return (
    <div
      className="absolute bottom-6 -translate-x-1/2 pointer-events-none z-50 flex flex-col items-center animate-in fade-in zoom-in-95 duration-100"
      style={{ left: `${Math.max(10, Math.min(90, positionX))}%` }}
    >
      <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl p-1 space-y-1">
        {/* Thumbnail Frame */}
        <div className="relative w-40 h-[90px] rounded bg-zinc-900 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentThumbnail.dataUrl}
            alt="Timeline preview"
            className="w-full h-full object-cover"
          />
        </div>
        {/* Caption & Timestamp */}
        <div className="flex items-center justify-between px-1 text-[10px] font-mono text-zinc-300">
          <span className="font-bold text-sky-400">{formatDuration(hoverSec)}</span>
          {currentThumbnail.chapterTitle && (
            <span className="truncate max-w-[90px] text-zinc-400 text-[9px]">
              {currentThumbnail.chapterTitle}
            </span>
          )}
        </div>
      </div>
      {/* Downward triangle arrow */}
      <div className="w-2 h-2 bg-zinc-950 border-r border-b border-zinc-700 rotate-45 -mt-1" />
    </div>
  )
}
