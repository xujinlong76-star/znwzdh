'use client'

import React, { useState } from 'react'
import { useVideoPlayer } from '@/contexts/VideoPlayerContext'
import {
  X,
  Maximize2,
  Play,
  Pause,
  Layers,
  PictureInPicture,
  Tv,
  Check,
} from 'lucide-react'
import { formatDuration } from '@/lib/video-format'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function VideoMiniPlayer() {
  const {
    activeVideo,
    isPlaying,
    isMiniPlayerOpen,
    restorePlayer,
    closePlayer,
    togglePlayPause,
    playheadSec,
    activeMirror,
    availableMirrors,
    switchMirror,
    requestDocumentPiP,
    chapters,
    activeChapterId,
  } = useVideoPlayer()

  const [isHovered, setIsHovered] = useState(false)

  if (!isMiniPlayerOpen || !activeVideo || !activeVideo.videoConfig) {
    return null
  }

  const duration = activeVideo.videoConfig.durationSec || 600
  const progressPercent = Math.min(100, Math.max(0, (playheadSec / duration) * 100))

  // Determine embed URL based on activeMirror
  const platform = activeMirror?.platform || activeVideo.videoConfig.type
  const sourceId = activeMirror?.sourceId || activeVideo.videoConfig.bvid || activeVideo.videoConfig.videoId || ''

  let embedUrl = ''
  if (platform === 'bilibili') {
    embedUrl = `//player.bilibili.com/player.html?bvid=${encodeURIComponent(sourceId)}&page=1&autoplay=${isPlaying ? '1' : '0'}`
  } else if (platform === 'youtube') {
    embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(sourceId)}?autoplay=${isPlaying ? '1' : '0'}`
  } else {
    embedUrl = sourceId
  }

  const activeChapter = chapters.find(c => c.id === activeChapterId)

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 rounded-xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur-md overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/60 border-b border-border/50 text-xs text-muted-foreground select-none">
        <div className="flex items-center gap-1.5 min-w-0 pr-2">
          <Tv className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="font-medium text-foreground truncate">
            {activeVideo.title}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Mirror Selector */}
          {availableMirrors.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="切换镜像源"
                >
                  <Layers className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 text-xs">
                {availableMirrors.map(m => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() => switchMirror(m.id)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <span className="truncate">{m.label}</span>
                    {activeMirror?.id === m.id && <Check className="w-3.5 h-3.5 text-primary ml-2 shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Document PiP */}
          <button
            type="button"
            onClick={requestDocumentPiP}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="画中画模式"
          >
            <PictureInPicture className="w-3.5 h-3.5" />
          </button>

          {/* Maximize / Restore */}
          <button
            type="button"
            onClick={restorePlayer}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="还原播放器"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={closePlayer}
            className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Video Embed Frame */}
      <div className="relative aspect-video w-full bg-black">
        <iframe
          src={embedUrl}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          title={activeVideo.title}
        />

        {/* Hover Overlay Controls */}
        <div
          className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-2 transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {activeChapter && (
            <div className="text-[11px] text-white/90 font-medium truncate mb-1">
              📍 {activeChapter.title}
            </div>
          )}
          <div className="flex items-center justify-between text-[11px] text-white/80">
            <button
              type="button"
              onClick={togglePlayPause}
              className="p-1 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
            <span className="font-mono">
              {formatDuration(playheadSec)} / {formatDuration(duration)}
            </span>
          </div>
        </div>
      </div>

      {/* Playback Progress Indicator */}
      <div className="h-1 w-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-200"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  )
}
