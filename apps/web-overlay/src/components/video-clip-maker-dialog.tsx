'use client'

import React, { useState } from 'react'
import {
  type ClipExportOptions,
  validateClipInterval,
  renderVideoClipPackage,
} from '@/lib/video-clip-exporter'
import type { VideoTranscriptItem } from '@/types/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Scissors, Download, Film, Sparkles, Check } from 'lucide-react'
import { formatDuration } from '@/lib/video-format'

interface VideoClipMakerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoTitle: string
  currentSec: number
  durationSec: number
  transcripts?: VideoTranscriptItem[]
}

export function VideoClipMakerDialog({
  open,
  onOpenChange,
  videoTitle,
  currentSec,
  durationSec,
  transcripts = [],
}: VideoClipMakerDialogProps) {
  const [startSec, setStartSec] = useState<number>(() => Math.max(0, currentSec - 10))
  const [endSec, setEndSec] = useState<number>(() => Math.min(durationSec, currentSec + 20))
  const [format, setFormat] = useState<'webm' | 'gif'>('webm')
  const [includeSubs, setIncludeSubs] = useState<boolean>(true)
  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  const validation = validateClipInterval(startSec, endSec)

  const handleExport = async () => {
    if (!validation.valid) return
    setIsExporting(true)
    try {
      const pkg = await renderVideoClipPackage(videoTitle, transcripts, {
        startSec,
        endSec,
        format,
        includeSubtitles: includeSubs,
        includeWatermark: true,
        quality: '720p',
      })
      setDownloadUrl(pkg.blobUrl)

      // Auto trigger download
      const a = document.createElement('a')
      a.href = pkg.blobUrl
      a.download = pkg.filename
      a.click()
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Scissors className="w-5 h-5 text-primary" />
            <span>视频微知识点一键切片生成器</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            选取关键实战精华片段（15s–60s），合成内置字幕与高清排版，导出为便于在技术群组、Slack 或社交平台分享的动画切片。
          </p>

          {/* Time range selection */}
          <div className="space-y-3 p-3 rounded-lg border bg-card">
            <div className="flex items-center justify-between text-[11px] font-medium">
              <span>切片区间设置</span>
              <span className="font-mono text-primary font-bold">
                {formatDuration(startSec)} → {formatDuration(endSec)} ({Math.round(endSec - startSec)}秒)
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>开始时间点</span>
                <span className="font-mono">{formatDuration(startSec)}</span>
              </div>
              <input aria-label="片段起始时间"
                type="range"
                min="0"
                max={Math.max(1, durationSec)}
                step="1"
                value={startSec}
                onChange={(e) => setStartSec(Number(e.target.value))}
                className="w-full h-1.5 bg-muted rounded appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>结束时间点</span>
                <span className="font-mono">{formatDuration(endSec)}</span>
              </div>
              <input aria-label="片段结束时间"
                type="range"
                min="0"
                max={Math.max(1, durationSec)}
                step="1"
                value={endSec}
                onChange={(e) => setEndSec(Number(e.target.value))}
                className="w-full h-1.5 bg-muted rounded appearance-none cursor-pointer accent-primary"
              />
            </div>

            {!validation.valid && (
              <p className="text-red-400 text-[10px] font-medium">{validation.error}</p>
            )}
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg border bg-card space-y-1.5">
              <div className="text-[10px] font-medium text-foreground">输出格式</div>
              <div className="flex gap-1">
                {(['webm', 'gif'] as const).map((fmt) => (
                  <Button
                    key={fmt}
                    size="sm"
                    variant={format === fmt ? 'default' : 'outline'}
                    className="flex-1 h-7 text-xs uppercase"
                    onClick={() => setFormat(fmt)}
                  >
                    {fmt}
                  </Button>
                ))}
              </div>
            </div>

            <div className="p-2.5 rounded-lg border bg-card flex flex-col justify-between">
              <div className="text-[10px] font-medium text-foreground">压制画面字幕</div>
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeSubs}
                  onChange={(e) => setIncludeSubs(e.target.checked)}
                  className="rounded border-border text-primary w-3.5 h-3.5"
                />
                合成同步逐字字幕
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!validation.valid || isExporting}
              onClick={handleExport}
              className="gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {isExporting ? '正在切片压制...' : '导出切片视频'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
