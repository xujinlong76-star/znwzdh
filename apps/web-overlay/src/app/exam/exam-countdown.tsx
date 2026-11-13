'use client'

import { useEffect, useState } from 'react'
import {
  countdownParts,
  daysUntil,
  examStatus,
  shanghaiMidnightMs,
  type ExamInfo,
} from '@/lib/exam-calendar'

/**
 * 考试倒计时客户端岛。
 *
 * 模式照抄 clock-widget：基于时间戳倒计时（每次 tick 用 Date.now() 重算，
 * 不用 prev-1 累加，防后台节流漂移）；挂载前只渲染占位——倒计时依赖
 * 客户端时间，SSR 直出会在午夜边界与水合结果差一天。
 */
export function ExamCountdown({ exam }: { exam: ExamInfo }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (now === null) {
    return (
      <div className="flex items-end gap-3" aria-hidden="true">
        <span className="font-mono text-4xl font-extrabold tabular-nums text-muted-foreground">
          ––
        </span>
        <span className="pb-1 text-sm text-muted-foreground">天</span>
      </div>
    )
  }

  const status = examStatus(exam, now)
  if (status === 'ended') {
    return <p className="text-lg font-semibold text-muted-foreground">已结束</p>
  }
  if (status === 'today' || status === 'ongoing') {
    const dayIndex = 1 - daysUntil(exam.startISO, now)
    return (
      <p className="text-lg font-semibold text-foreground">
        {status === 'today' ? '今天考试' : `进行中 · 第 ${dayIndex} 天`}
      </p>
    )
  }

  const parts = countdownParts(shanghaiMidnightMs(exam.startISO), now)
  return (
    <div
      className="flex items-end gap-3"
      role="timer"
      aria-label={`${exam.shortName}倒计时 ${parts.days} 天 ${parts.hours} 小时 ${parts.minutes} 分钟`}
    >
      <span className="font-mono text-4xl font-extrabold tabular-nums tracking-tight text-foreground">
        {parts.days}
      </span>
      <span className="pb-1 text-sm text-muted-foreground">天</span>
      <span className="pb-1 font-mono text-sm tabular-nums text-muted-foreground">
        {String(parts.hours).padStart(2, '0')}:{String(parts.minutes).padStart(2, '0')}:
        {String(parts.seconds).padStart(2, '0')}
      </span>
    </div>
  )
}
