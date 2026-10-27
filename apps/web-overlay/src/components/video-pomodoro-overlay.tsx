'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  PomodoroSessionManager,
  type PomodoroState,
  ERGONOMIC_BREAK_TIPS,
} from '@/lib/video-pomodoro-engine'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Timer, Play, Pause, RotateCcw, Sparkles, Volume2, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoPomodoroOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPauseVideo?: () => void
}

export function VideoPomodoroDialog({
  open,
  onOpenChange,
  onPauseVideo,
}: VideoPomodoroOverlayProps) {
  const managerRef = useRef<PomodoroSessionManager>(new PomodoroSessionManager())
  const [state, setState] = useState<PomodoroState>(() => managerRef.current.getState())
  const [ambientSound, setAmbientSound] = useState<boolean>(false)

  useEffect(() => {
    const unsub = managerRef.current.subscribe((newState) => {
      setState(newState)
      if (newState.phase !== 'work' && managerRef.current.getConfig().autoPauseVideoOnBreak) {
        if (onPauseVideo) onPauseVideo()
      }
    })

    const timer = setInterval(() => {
      managerRef.current.tickSecond()
    }, 1000)

    return () => {
      unsub()
      clearInterval(timer)
    }
  }, [onPauseVideo])

  const mins = Math.floor(state.remainingSec / 60)
  const secs = state.remainingSec % 60
  const timeFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`

  const currentTip = ERGONOMIC_BREAK_TIPS[state.completedCycles % ERGONOMIC_BREAK_TIPS.length]

  // Circular timer progress
  const totalPhaseSec = state.phase === 'work' ? 25 * 60 : 5 * 60
  const progressPercent = ((totalPhaseSec - state.remainingSec) / totalPhaseSec) * 100
  const strokeDashoffset = 283 - (283 * progressPercent) / 100

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Timer className="w-5 h-5 text-amber-500" />
            <span>深度专注番茄钟与工效护眼防疲劳</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs flex flex-col items-center">
          {/* Circular Countdown Gauge */}
          <div className="relative w-44 h-44 flex items-center justify-center my-2">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="#27272a"
                strokeWidth="6"
              />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke={state.phase === 'work' ? '#f59e0b' : '#10b981'}
                strokeWidth="6"
                strokeDasharray="283"
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-mono text-3xl font-extrabold text-foreground tracking-tight">
                {timeFormatted}
              </span>
              <span className={cn(
                "text-[10px] uppercase font-bold mt-1 px-2 py-0.5 rounded-full",
                state.phase === 'work' ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
              )}>
                {state.phase === 'work' ? '专注编码中' : '工效护眼休息'}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {state.isRunning ? (
              <Button size="sm" variant="outline" className="gap-1.5 px-4 text-xs" onClick={() => managerRef.current.pause()}>
                <Pause className="w-3.5 h-3.5" /> 暂停
              </Button>
            ) : (
              <Button size="sm" className="gap-1.5 px-4 text-xs" onClick={() => managerRef.current.start()}>
                <Play className="w-3.5 h-3.5" /> 开始专注
              </Button>
            )}
            <Button size="sm" variant="ghost" className="gap-1 px-3 text-xs" onClick={() => managerRef.current.reset()}>
              <RotateCcw className="w-3.5 h-3.5" /> 重置
            </Button>
          </div>

          {/* Ergonomic Tip Banner */}
          <div className="w-full p-3 rounded-lg border bg-muted/40 space-y-1">
            <div className="font-semibold text-foreground flex items-center gap-1.5 text-[11px]">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              <span>工效学小贴士：{currentTip.title}</span>
            </div>
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              {currentTip.instruction}
            </p>
          </div>

          {/* Stats Bar */}
          <div className="w-full flex items-center justify-between text-[11px] text-muted-foreground border-t pt-2">
            <span>已完成周期: <strong className="text-foreground">{state.completedCycles}</strong> 个</span>
            <span>累计专注: <strong className="text-primary font-mono">{state.totalFocusedMinutes}</strong> 分钟</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
