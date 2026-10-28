'use client'

import React, { useMemo } from 'react'
import {
  type SlideSnapshot,
  detectSlideTransitions,
} from '@/lib/video-slide-detector'
import { Button } from '@/registry/new-york/ui/button'
import { Presentation, Download, ExternalLink, Sparkles, Clock } from 'lucide-react'
import { formatDuration } from '@/lib/video-format'
import { chapterStartSec, type VideoChapter } from '@/types/navigation'

interface VideoSlideDeckViewerProps {
  chapters?: VideoChapter[]
  currentSec: number
  onSeek: (sec: number) => void
  videoTitle?: string
}

export function VideoSlideDeckViewer({
  chapters = [],
  currentSec,
  onSeek,
  videoTitle = '技术实战课件',
}: VideoSlideDeckViewerProps) {
  // Convert chapters into synthesized slide snapshots
  const slides = useMemo<SlideSnapshot[]>(() => {
    if (chapters.length === 0) {
      // Generate default slide progression
      return [
        {
          id: 'slide-1',
          pageNumber: 1,
          timestampSec: 0,
          durationSec: 300,
          title: '课程体系概览与核心导读',
          pHash: '8a3f91c01e2b4d5a',
          thumbnailDataUrl: '',
          ocrKeywords: ['架构', '核心原则', '技术选型'],
        },
        {
          id: 'slide-2',
          pageNumber: 2,
          timestampSec: 300,
          durationSec: 600,
          title: '核心原理深度剖析与模块解耦',
          pHash: '1c2e4f8b9a0d3e5f',
          thumbnailDataUrl: '',
          ocrKeywords: ['解耦', '状态机', '高性能'],
        },
        {
          id: 'slide-3',
          pageNumber: 3,
          timestampSec: 900,
          durationSec: 900,
          title: '生产级工程化落地与避坑指南',
          pHash: 'f4d3c2b1a0e98765',
          thumbnailDataUrl: '',
          ocrKeywords: ['CI/CD', '压测调优', '最佳实践'],
        },
      ]
    }

    return chapters.map((ch, idx) => ({
      id: ch.id || `slide-${idx + 1}`,
      pageNumber: idx + 1,
      timestampSec: chapterStartSec(ch),
      durationSec: ch.duration || 300,
      title: ch.title,
      pHash: `slide-hash-${idx}`,
      thumbnailDataUrl: '',
      ocrKeywords: ch.summary ? ch.summary.split(' ').slice(0, 4) : ['技术演练', '代码架构'],
    }))
  }, [chapters])

  // Locate current active slide
  const activeSlideIndex = useMemo(() => {
    let active = 0
    for (let i = 0; i < slides.length; i++) {
      if (currentSec >= slides[i]!.timestampSec) {
        active = i
      } else {
        break
      }
    }
    return active
  }, [slides, currentSec])

  const handleExportSlideOutline = () => {
    let md = `# ${videoTitle} - 课件大纲与幻灯片索引\n\n`
    md += `生成时间: ${new Date().toLocaleString()}\n`
    md += `总页数: ${slides.length} 页\n\n---\n\n`

    slides.forEach(s => {
      md += `### 第 ${s.pageNumber} 页: ${s.title}\n`
      md += `- 对应时间: [${formatDuration(s.timestampSec)}]\n`
      md += `- 核心关键词: ${s.ocrKeywords.join(', ')}\n\n`
    })

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${videoTitle}_课件大纲.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Presentation className="w-4 h-4 text-primary" />
          <span>智能课件切片与演示画廊 ({slides.length} 页)</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs px-2 gap-1"
          onClick={handleExportSlideOutline}
          title="导出 Markdown 课件幻灯片大纲"
        >
          <Download className="w-3 h-3" />
          导出讲义
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
        {slides.map((s, idx) => {
          const isActive = idx === activeSlideIndex
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              aria-current={isActive ? 'true' : undefined}
              aria-label={`跳到第 ${s.pageNumber} 页（${s.title || '幻灯片'}）`}
              onClick={() => onSeek(s.timestampSec)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSeek(s.timestampSec)
                }
              }}
              className={`p-2.5 rounded-lg border transition-all cursor-pointer space-y-2 ${
                isActive
                  ? 'border-primary bg-primary/5 shadow-xs'
                  : 'border-border/50 bg-card hover:border-primary/40 hover:bg-accent/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-bold text-primary font-mono">
                  P.{s.pageNumber}
                </span>
                <span className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatDuration(s.timestampSec)}
                </span>
              </div>

              <p className="font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                {s.title}
              </p>

              <div className="flex flex-wrap gap-1 pt-1">
                {s.ocrKeywords.map((kw, i) => (
                  <span
                    key={i}
                    className="px-1 py-0.2 rounded bg-muted/60 text-[10px] text-muted-foreground"
                  >
                    #{kw}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
