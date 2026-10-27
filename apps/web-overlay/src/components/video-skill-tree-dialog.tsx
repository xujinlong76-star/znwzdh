'use client'

import React, { useMemo } from 'react'
import {
  type SkillDomainScore,
  calculateLearningStreak,
  generate365DayHeatmapGrid,
  computeRadarPolygonPoints,
} from '@/lib/video-learning-analytics'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Flame, Trophy, Clock, GitCommit, Target } from 'lucide-react'

interface VideoSkillTreeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userHistoryMap?: Record<string, number>
}

const DOMAIN_SCORES: SkillDomainScore[] = [
  { domain: 'devops', name: 'DevOps & 运维', score: 85, maxScore: 100 },
  { domain: 'frontend', name: '前端现代工程', score: 90, maxScore: 100 },
  { domain: 'backend', name: '高并发后端', score: 78, maxScore: 100 },
  { domain: 'database', name: '分布式存储', score: 72, maxScore: 100 },
  { domain: 'cloud', name: '云原生与安全', score: 88, maxScore: 100 },
]

export function VideoSkillTreeDialog({
  open,
  onOpenChange,
  userHistoryMap = {},
}: VideoSkillTreeDialogProps) {
  // Generate sample calendar history if empty
  const enrichedHistory = useMemo(() => {
    const map: Record<string, number> = { ...userHistoryMap }
    const now = new Date()
    for (let i = 0; i < 90; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dStr = d.toISOString().slice(0, 10)
      if (map[dStr] === undefined) {
        // Random study minutes on 70% of days
        if ((i % 7) !== 0 && (i % 5) !== 0) {
          map[dStr] = 30 + ((i * 13) % 60)
        }
      }
    }
    return map
  }, [userHistoryMap])

  const streakMetrics = useMemo(() => {
    return calculateLearningStreak(enrichedHistory)
  }, [enrichedHistory])

  const heatmapGrid = useMemo(() => {
    return generate365DayHeatmapGrid(enrichedHistory)
  }, [enrichedHistory])

  // Radar polygon vertices
  const radarPoints = useMemo(() => {
    return computeRadarPolygonPoints(DOMAIN_SCORES, { x: 100, y: 100 }, 80)
  }, [])

  const levelColor = (level: number) => {
    switch (level) {
      case 1: return 'bg-emerald-950 text-emerald-300 border border-emerald-800'
      case 2: return 'bg-emerald-800'
      case 3: return 'bg-emerald-600'
      case 4: return 'bg-emerald-400'
      default: return 'bg-muted/40'
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Trophy className="w-5 h-5 text-amber-500" />
            <span>全周期持续学习热力图与技能图谱</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-4 gap-2">
            <div className="p-3 rounded-lg border bg-card text-center space-y-1">
              <div className="flex items-center justify-center gap-1 text-amber-500 font-bold text-lg font-mono">
                <Flame className="w-4 h-4 fill-amber-500" />
                {streakMetrics.currentStreak}
              </div>
              <div className="text-[10px] text-muted-foreground">当前连续打卡(天)</div>
            </div>

            <div className="p-3 rounded-lg border bg-card text-center space-y-1">
              <div className="text-foreground font-bold text-lg font-mono">
                {streakMetrics.longestStreak}
              </div>
              <div className="text-[10px] text-muted-foreground">最长连续打卡(天)</div>
            </div>

            <div className="p-3 rounded-lg border bg-card text-center space-y-1">
              <div className="flex items-center justify-center gap-1 text-primary font-bold text-lg font-mono">
                <Clock className="w-4 h-4" />
                {(streakMetrics.totalMinutes / 60).toFixed(1)}
              </div>
              <div className="text-[10px] text-muted-foreground">累计学习时数(h)</div>
            </div>

            <div className="p-3 rounded-lg border bg-card text-center space-y-1">
              <div className="text-emerald-500 font-bold text-lg font-mono">
                {Math.round(streakMetrics.totalMinutes / 25)}
              </div>
              <div className="text-[10px] text-muted-foreground">通关视频课时</div>
            </div>
          </div>

          {/* 365-Day Heatmap */}
          <div className="p-3 rounded-lg border bg-card space-y-2">
            <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
              <span className="flex items-center gap-1.5">
                <GitCommit className="w-3.5 h-3.5 text-emerald-500" />
                年度学习打卡热力方块 (52 周)
              </span>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>少</span>
                <div className="w-2.5 h-2.5 rounded-xs bg-muted/40" />
                <div className="w-2.5 h-2.5 rounded-xs bg-emerald-950" />
                <div className="w-2.5 h-2.5 rounded-xs bg-emerald-700" />
                <div className="w-2.5 h-2.5 rounded-xs bg-emerald-400" />
                <span>多</span>
              </div>
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="flex gap-1 min-w-[640px]">
                {heatmapGrid.map((week, wIdx) => (
                  <div key={wIdx} className="flex flex-col gap-1">
                    {week.map((day) => (
                      <div
                        key={day.date}
                        className={`w-2.5 h-2.5 rounded-xs transition-colors ${levelColor(day.level)}`}
                        title={`${day.date}: 学习 ${day.minutes} 分钟`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Skill Radar and Domain Breakdown */}
          <div className="grid grid-cols-2 gap-3 items-center">
            {/* SVG Radar Polygon */}
            <div className="p-3 rounded-lg border bg-zinc-950 flex flex-col items-center justify-center">
              <div className="text-[11px] font-medium text-zinc-400 mb-1 flex items-center gap-1">
                <Target className="w-3.5 h-3.5 text-primary" /> 全维工程技能雷达
              </div>
              <svg width="200" height="200" viewBox="0 0 200 200" className="overflow-visible">
                {/* Background rings */}
                {[0.25, 0.5, 0.75, 1.0].map((scale) => {
                  const ringPoints = computeRadarPolygonPoints(
                    DOMAIN_SCORES.map(s => ({ ...s, score: 100 })),
                    { x: 100, y: 100 },
                    80 * scale
                  )
                  return (
                    <polygon
                      key={scale}
                      points={ringPoints}
                      fill="none"
                      stroke="#27272a"
                      strokeWidth="1"
                    />
                  )
                })}
                {/* Active score polygon */}
                <polygon
                  points={radarPoints}
                  fill="rgba(56, 189, 248, 0.25)"
                  stroke="#38bdf8"
                  strokeWidth="2"
                />
              </svg>
            </div>

            {/* Domain Scores List */}
            <div className="space-y-2">
              <div className="font-semibold text-foreground text-[11px]">专业技术领域掌握度</div>
              {DOMAIN_SCORES.map((s) => (
                <div key={s.domain} className="space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-foreground">{s.name}</span>
                    <span className="font-mono text-primary font-bold">{s.score}%</span>
                  </div>
                  <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${s.score}%` }} />
                  </div>
                </div>
              ))}
            </div>
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
