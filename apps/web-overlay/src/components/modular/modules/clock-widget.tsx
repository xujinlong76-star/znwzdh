'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Play, Pause, RotateCcw, Clock as ClockIcon, Sparkles } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

const POMO_PRESETS = [
  { label: '15分', seconds: 15 * 60, desc: '快速冲刺' },
  { label: '25分', seconds: 25 * 60, desc: '标准番茄' },
  { label: '45分', seconds: 45 * 60, desc: '深度心流' },
]

export function ClockWidget({ config }: { config?: Record<string, any> }) {
  const [time, setTime] = useState<Date | null>(null)
  const [isPomodoro, setIsPomodoro] = useState(false)
  const [totalSeconds, setTotalSeconds] = useState(25 * 60)
  const [pomodoroSeconds, setPomodoroSeconds] = useState(25 * 60)
  const [isRunning, setIsRunning] = useState(false)
  const endAtRef = useRef<number | null>(null)

  useEffect(() => {
    setTime(new Date())
    // 单 timer 驱动时钟显示 + 番茄倒计时（原双 interval：1s 时钟 + 500ms 番茄各跑各的）。
    // 专注运行时 500ms 档（倒计时跟手），待机时 1000ms 档（省一半渲染）。
    const intervalMs = isRunning ? 500 : 1000
    const timer = setInterval(() => {
      setTime(new Date())
      if (isRunning && endAtRef.current) {
        const remaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000))
        setPomodoroSeconds(remaining)
        if (remaining <= 0) {
          setIsRunning(false)
          endAtRef.current = null
        }
      }
    }, intervalMs)
    return () => clearInterval(timer)
  }, [isRunning])

  useEffect(() => {
    // 基于时间戳倒计时（而非 prev-1 累加）：setInterval 在后台标签页会被
    // 浏览器节流到分钟级，累加法会累积漂移；每次启动/恢复时以真实
    // Date.now() 锚定终点，节流恢复后自动追平，不丢秒。
    if (isRunning && pomodoroSeconds > 0 && endAtRef.current === null) {
      endAtRef.current = Date.now() + pomodoroSeconds * 1000
    } else if (!isRunning) {
      endAtRef.current = null
    }
  }, [isRunning])

  if (!time) {
    return <div className="h-full flex items-center justify-center text-xs text-muted-foreground font-mono">加载时钟...</div>
  }

  const hours = String(time.getHours()).padStart(2, '0')
  const minutes = String(time.getMinutes()).padStart(2, '0')
  const seconds = String(time.getSeconds()).padStart(2, '0')

  const pomoMinutes = String(Math.floor(pomodoroSeconds / 60)).padStart(2, '0')
  const pomoSecs = String(pomodoroSeconds % 60).padStart(2, '0')
  const progressPercent = Math.min(100, Math.max(0, ((totalSeconds - pomodoroSeconds) / totalSeconds) * 100))

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none space-y-1.5">
      {/* 顶部标题栏与模式切换 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <ClockIcon className="w-3.5 h-3.5 text-primary" />
          <span>{isPomodoro ? '番茄沉浸专注' : '本地精准时钟'}</span>
        </div>
        <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/40">
          <button
            onClick={() => setIsPomodoro(false)}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              !isPomodoro ? 'bg-background text-foreground font-semibold shadow-2xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            时钟
          </button>
          <button
            onClick={() => setIsPomodoro(true)}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              isPomodoro ? 'bg-background text-foreground font-semibold shadow-2xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            专注
          </button>
        </div>
      </div>

      {/* 核心时间展示区 */}
      <div className="flex-1 flex flex-col items-center justify-center py-1">
        {!isPomodoro ? (
          <div className="text-center space-y-1">
            <div className="font-mono text-3xl sm:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-muted-foreground">
              {hours}:{minutes}
              <span className="text-lg text-primary font-normal">:{seconds}</span>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {time.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
        ) : (
          <div className="w-full text-center space-y-2">
            {/* 倒计时数字 */}
            <div className="font-mono text-3xl sm:text-4xl font-extrabold tracking-tight text-primary flex items-center justify-center gap-1">
              <span>{pomoMinutes}:{pomoSecs}</span>
              {isRunning && (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              )}
            </div>

            {/* 专注进度条 */}
            <div className="w-3/4 mx-auto bg-muted/50 h-1.5 rounded-full overflow-hidden border border-border/40">
              <div
                className="bg-primary h-full transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* 预设时长选择 */}
            <div className="flex items-center justify-center gap-1.5 pt-0.5">
              {POMO_PRESETS.map((preset) => (
                <button
                  key={preset.seconds}
                  disabled={isRunning}
                  onClick={() => {
                    setTotalSeconds(preset.seconds)
                    setPomodoroSeconds(preset.seconds)
                  }}
                  className={`text-xs px-2 py-0.5 rounded-md border transition-colors disabled:opacity-50 ${
                    totalSeconds === preset.seconds
                      ? 'bg-primary/15 text-primary border-primary/30 font-semibold'
                      : 'border-border/40 text-muted-foreground hover:bg-muted'
                  }`}
                  title={preset.desc}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* 控制按钮 */}
            <div className="flex items-center justify-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className={`h-7 px-3 text-xs rounded-full gap-1 transition-all ${
                  isRunning
                    ? 'border-amber-500/30 text-amber-600 hover:bg-amber-500/10'
                    : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
                }`}
                onClick={() => setIsRunning(!isRunning)}
              >
                {isRunning ? (
                  <Pause className="w-3 h-3 fill-amber-500" />
                ) : (
                  <Play className="w-3 h-3 fill-emerald-500" />
                )}
                <span>{isRunning ? '暂停专注' : '开始专注'}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setIsRunning(false)
                  setPomodoroSeconds(totalSeconds)
                }}
                title="重置倒计时"
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 底部状态 */}
      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono truncate">
        {isPomodoro
          ? isRunning
            ? '心流模式运行中 · 保持专注'
            : '就绪 · 点击开始进入心流'
          : '本地系统时区 · 毫秒级精度同步'}
      </div>
    </div>
  )
}
