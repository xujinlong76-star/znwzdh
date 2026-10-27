'use client'

import React, { useState, useMemo } from 'react'
import {
  type SubtitleLanguage,
  buildBilingualTranscripts,
  formatToWebVTT,
  formatToSRT,
} from '@/lib/video-multilingual-translator'
import type { VideoTranscriptItem } from '@/types/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Languages, Download, Check, Sparkles } from 'lucide-react'
import { formatDuration } from '@/lib/video-format'

interface VideoBilingualSubtitlesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transcripts: VideoTranscriptItem[]
  videoTitle?: string
}

export function VideoBilingualSubtitlesDialog({
  open,
  onOpenChange,
  transcripts,
  videoTitle = '技术实战视频',
}: VideoBilingualSubtitlesDialogProps) {
  const [targetLang, setTargetLang] = useState<SubtitleLanguage>('en')

  const bilingualLines = useMemo(() => {
    return buildBilingualTranscripts(transcripts, targetLang)
  }, [transcripts, targetLang])

  const handleDownloadVTT = () => {
    const content = formatToWebVTT(transcripts)
    const blob = new Blob([content], { type: 'text/vtt;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${videoTitle}-subtitles.vtt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadSRT = () => {
    const content = formatToSRT(transcripts)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${videoTitle}-subtitles.srt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Languages className="w-5 h-5 text-primary" />
            <span>双语字幕实时对齐与多语言导出</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            内置专业级技术专有名词术语词库（K8s、幂等性、微服务、gRPC），提供双行实时对齐与工业级 WebVTT/SRT 文件导出。
          </p>

          {/* Language Selector */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">目标翻译语种：</span>
            {(['en', 'ja', 'es', 'zh'] as SubtitleLanguage[]).map((lang) => (
              <Button
                key={lang}
                size="sm"
                variant={targetLang === lang ? 'default' : 'outline'}
                className="h-7 text-xs uppercase"
                onClick={() => setTargetLang(lang)}
              >
                {lang === 'en' ? '英语 (English)' : lang === 'ja' ? '日语 (日本語)' : lang === 'es' ? '西班牙语 (Español)' : '中文原文'}
              </Button>
            ))}
          </div>

          {/* Bilingual Preview ScrollArea */}
          <div className="border rounded-lg p-2.5 max-h-56 overflow-y-auto space-y-2 bg-card">
            {bilingualLines.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">暂无字幕逐字稿</p>
            ) : (
              bilingualLines.map((line) => (
                <div key={line.id} className="p-2 rounded bg-muted/40 space-y-1 text-xs">
                  <div className="text-[10px] font-mono text-muted-foreground">
                    ⏱️ {formatDuration(line.startSec)} - {formatDuration(line.endSec)}
                  </div>
                  <div className="text-foreground font-medium">{line.originalText}</div>
                  <div className="text-primary text-[11px] font-sans">{line.translatedText}</div>
                </div>
              ))
            )}
          </div>

          {/* Export Buttons */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-muted-foreground">
              共计 {bilingualLines.length} 条双语同步对齐轨道
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleDownloadSRT}>
                <Download className="w-3.5 h-3.5" />
                导出 .SRT
              </Button>
              <Button size="sm" className="gap-1.5 text-xs" onClick={handleDownloadVTT}>
                <Download className="w-3.5 h-3.5" />
                导出 .VTT
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
