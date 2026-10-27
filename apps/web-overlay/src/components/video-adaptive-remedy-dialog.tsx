'use client'

import React, { useState, useMemo } from 'react'
import {
  BayesianKnowledgeTracer,
  type ConceptMasteryState,
  type DiagnosticWeaknessReport,
} from '@/lib/video-knowledge-tracer'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Brain, AlertCircle, CheckCircle2, ArrowRight, Sparkles, Clock } from 'lucide-react'
import { formatDuration } from '@/lib/video-format'
import { cn } from '@/lib/utils'

interface VideoAdaptiveRemedyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSeekToTimestamp?: (sec: number) => void
}

export function VideoAdaptiveRemedyDialog({
  open,
  onOpenChange,
  onSeekToTimestamp,
}: VideoAdaptiveRemedyDialogProps) {
  const tracer = useMemo(() => {
    const t = new BayesianKnowledgeTracer([
      {
        conceptId: 'c-1',
        conceptName: '事件循环与微任务队列 (EventLoop)',
        priorMastery: 0.85,
        transitionProb: 0.2,
        guessProb: 0.15,
        slipProb: 0.08,
        prerequisiteIds: [],
        recommendedTimestampSec: 180,
      },
      {
        conceptId: 'c-2',
        conceptName: '原型链继承与寄生组合模式',
        priorMastery: 0.42,
        transitionProb: 0.15,
        guessProb: 0.2,
        slipProb: 0.12,
        prerequisiteIds: ['c-1'],
        recommendedTimestampSec: 640,
      },
      {
        conceptId: 'c-3',
        conceptName: '闭包内存泄漏排查与 DevTools Heap',
        priorMastery: 0.38,
        transitionProb: 0.12,
        guessProb: 0.25,
        slipProb: 0.15,
        prerequisiteIds: ['c-1'],
        recommendedTimestampSec: 1120,
      },
      {
        conceptId: 'c-4',
        conceptName: 'Web Worker 多线程与 SharedArrayBuffer',
        priorMastery: 0.76,
        transitionProb: 0.18,
        guessProb: 0.2,
        slipProb: 0.1,
        prerequisiteIds: ['c-1'],
        recommendedTimestampSec: 1540,
      },
    ])
    return t
  }, [])

  const report = useMemo<DiagnosticWeaknessReport>(() => tracer.getDiagnosticReport(), [tracer])
  const states = useMemo<ConceptMasteryState[]>(() => tracer.getAllStates(), [tracer])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Brain className="w-5 h-5 text-indigo-400" />
            <span>贝叶斯自适应知识追踪与弱项诊断 (BKT Analytics)</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          {/* Overview Score Cards */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 rounded-lg border border-border/50 bg-card text-center space-y-1">
              <span className="text-muted-foreground text-[10px]">整体掌握概率</span>
              <p className="text-lg font-bold text-indigo-400 font-mono">
                {Math.round(report.overallProficiency * 100)}%
              </p>
            </div>
            <div className="p-3 rounded-lg border border-border/50 bg-card text-center space-y-1">
              <span className="text-muted-foreground text-[10px]">已完全掌握</span>
              <p className="text-lg font-bold text-emerald-400 font-mono">
                {report.masteredCount} 个概念
              </p>
            </div>
            <div className="p-3 rounded-lg border border-border/50 bg-card text-center space-y-1">
              <span className="text-muted-foreground text-[10px]">急需巩固薄弱点</span>
              <p className="text-lg font-bold text-amber-400 font-mono">
                {report.weakCount} 个节点
              </p>
            </div>
          </div>

          {/* Concepts Mastery List */}
          <div className="space-y-2 p-3 rounded-lg border border-border/50 bg-muted/20">
            <p className="font-semibold text-foreground">核心知识节点掌握进度</p>
            <div className="space-y-2 pt-1">
              {states.map(s => {
                const pct = Math.round(s.currentMastery * 100)
                return (
                  <div key={s.conceptId} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-foreground">{s.conceptName}</span>
                      <span className="font-mono font-bold text-primary">{pct}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all duration-300',
                          pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-indigo-500' : 'bg-amber-500'
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Weakness Diagnostic & Jump Actions */}
          {report.remedialSuggestions.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                <span>靶向弱项强化补救路线</span>
              </p>
              <div className="space-y-2">
                {report.remedialSuggestions.map(rec => (
                  <div
                    key={rec.conceptId}
                    className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5 flex-1">
                      <p className="font-medium text-foreground">{rec.conceptName}</p>
                      <p className="text-[11px] text-muted-foreground">{rec.reason}</p>
                    </div>
                    {rec.jumpToTimeSec !== undefined && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2 gap-1 shrink-0 font-mono"
                        onClick={() => {
                          if (onSeekToTimestamp) onSeekToTimestamp(rec.jumpToTimeSec!)
                          onOpenChange(false)
                        }}
                      >
                        <Clock className="w-3 h-3 text-primary" />
                        <span>重学 {formatDuration(rec.jumpToTimeSec)}</span>
                        <ArrowRight className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={() => onOpenChange(false)}>
              完成诊断
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
