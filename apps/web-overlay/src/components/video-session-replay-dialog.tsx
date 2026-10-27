'use client'

import React, { useMemo } from 'react'
import {
  type CognitiveEngagementReport,
  SessionActivityRecorder,
} from '@/lib/video-session-recorder'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { History, Brain, Sparkles, AlertCircle, PlayCircle, Flame } from 'lucide-react'
import { formatDuration } from '@/lib/video-format'

interface VideoSessionReplayDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recorder?: SessionActivityRecorder
  onSeekToHotspot?: (sec: number) => void
}

export function VideoSessionReplayDialog({
  open,
  onOpenChange,
  recorder,
  onSeekToHotspot,
}: VideoSessionReplayDialogProps) {
  const report = useMemo<CognitiveEngagementReport>(() => {
    if (!recorder) {
      // Default simulated report
      return {
        totalEvents: 18,
        frictionScore: 35,
        handsOnScore: 80,
        fluencyScore: 82,
        rewindHotspotsSec: [120, 240, 480],
        eventsSummary: {
          play: 4,
          pause: 5,
          seek: 4,
          rate_change: 2,
          take_note: 2,
          quiz_attempt: 1,
          sandbox_run: 3,
          confusion_marker: 1,
        },
      }
    }
    return recorder.generateEngagementReport()
  }, [recorder])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="w-5 h-5 text-primary" />
            <span>学习会话时空漫游与认知负荷复盘</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            基于会话事件微动作流（倒退、暂停、沙箱演练、笔记记录），量化评估概念吸收难度与动手参与度。
          </p>

          {/* Three Core Engagement Scores */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">动手实战度</div>
              <div className="text-emerald-500 font-mono font-bold text-lg">
                {report.handsOnScore}
              </div>
              <div className="text-[9px] text-muted-foreground">沙箱代码演练与剪藏</div>
            </div>

            <div className="p-3 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">听课流畅度</div>
              <div className="text-primary font-mono font-bold text-lg">
                {report.fluencyScore}
              </div>
              <div className="text-[9px] text-muted-foreground">连贯持续专注度</div>
            </div>

            <div className="p-3 rounded-lg border bg-card space-y-1">
              <div className="text-[10px] text-muted-foreground">认知挑战指数</div>
              <div className="text-amber-500 font-mono font-bold text-lg">
                {report.frictionScore}
              </div>
              <div className="text-[9px] text-muted-foreground">倒退重看与高难知识点</div>
            </div>
          </div>

          {/* Rewind Hotspots List */}
          <div className="space-y-2">
            <div className="font-medium text-foreground flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              <span>检测到的深度思考与高频重播盲点</span>
            </div>
            {report.rewindHotspotsSec.length === 0 ? (
              <p className="p-3 border rounded-lg text-muted-foreground text-center text-xs">
                本节课未出现大跨度倒退重播，知识点吸收顺畅！
              </p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {report.rewindHotspotsSec.map((sec, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-lg border bg-muted/30 text-xs"
                  >
                    <div>
                      <span className="font-mono text-primary font-semibold">
                        ⏱️ {formatDuration(sec)}
                      </span>
                      <span className="text-muted-foreground ml-2 text-[11px]">
                        高密度架构概念回看 (第 {idx + 1} 处难点)
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] gap-1"
                      onClick={() => onSeekToHotspot && onSeekToHotspot(sec)}
                    >
                      <PlayCircle className="w-3 h-3" /> 跳转复习
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={() => onOpenChange(false)}>
              确定
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
