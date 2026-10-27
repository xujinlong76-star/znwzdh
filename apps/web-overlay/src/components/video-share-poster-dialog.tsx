'use client'

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Share2, Copy, Check, Download, ExternalLink, Sparkles } from 'lucide-react'
import { formatDuration } from '@/lib/video-format'
import { copyText } from '@/lib/clipboard'

interface VideoSharePosterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  videoTitle: string
  videoAuthor?: string
  currentSec: number
  videoId: string
}

export function VideoSharePosterDialog({
  open,
  onOpenChange,
  videoTitle,
  videoAuthor = '技术专家',
  currentSec,
  videoId,
}: VideoSharePosterDialogProps) {
  const [copiedLink, setCopiedLink] = useState(false)
  const formattedTime = formatDuration(currentSec)

  const ogUrl = `/api/og/video?title=${encodeURIComponent(videoTitle)}&author=${encodeURIComponent(videoAuthor)}&time=${encodeURIComponent(formattedTime)}`
  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/videos/player?id=${encodeURIComponent(videoId)}&t=${currentSec}`
    : `/videos/player?id=${videoId}&t=${currentSec}`

  const handleCopyLink = () => {
    void copyText(shareLink).then((result) => {
      if (!result.ok) return
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    })
  }

  const handleDownloadPoster = () => {
    const a = document.createElement('a')
    a.href = ogUrl
    a.download = `${videoTitle}_${formattedTime}_海报.svg`
    a.click()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Share2 className="w-5 h-5 text-primary" />
            <span>生成高能时间戳分享海报</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          {/* Live OG Card Preview */}
          <div className="relative w-full aspect-[1200/630] rounded-xl overflow-hidden border border-border shadow-2xl bg-zinc-950 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ogUrl}
              alt={videoTitle}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Share metadata info */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted text-xs">
            <div className="space-y-0.5">
              <div className="font-semibold text-foreground">精准锚定播放点: {formattedTime}</div>
              <div className="text-[11px] text-muted-foreground truncate max-w-sm">
                {shareLink}
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleCopyLink}>
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? '已复制' : '复制直达链接'}</span>
            </Button>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button size="sm" className="gap-1.5" onClick={handleDownloadPoster}>
              <Download className="w-3.5 h-3.5" />
              下载高清海报 (SVG)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
