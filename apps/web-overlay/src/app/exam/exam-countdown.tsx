'use client'

import { useEffect, useState } from 'react'
import {
  countdownParts,
  daysUntil,
  examStatus,
  firstExamDay,
  hasActionableNodes,
  shanghaiMidnightMs,
  urgencyTier,
  type ExamInfo,
  type ExamUrgencyTier,
} from '@/lib/exam-calendar'

/**
 * 紧迫度配色（大号天数 / 今天考试文案）：站内已有的 amber-600 / red-600
 * 配方（深色档 amber-400 / red-400）；relaxed 保持原来的 text-foreground。
 * 红 600 白底约 4.8:1、琥珀 600 用于 text-4xl 大号字（大字 3:1 即可）。
 */
const URGENCY_DAY_CLASS: Record<ExamUrgencyTier, string> = {
  today: 'text-red-600 dark:text-red-400',
  tomorrow: 'text-red-600 dark:text-red-400',
  urgent: 'text-red-600 dark:text-red-400',
  soon: 'text-amber-700 dark:text-amber-400',
  relaxed: 'text-foreground',
}

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
    // R1（2026-11-17）：统考已过但成绩等节点仍可办时（成考 11-18），裸
    // 「已结束」会与下方「今天」节点自相矛盾，改按统考 scoped 文案；
    // 节点全过后（成考 11-19 起）仍渲染裸「已结束」，行为不变。
    return (
      <p className="text-lg font-semibold text-muted-foreground">
        {hasActionableNodes(exam, now) ? '统考已结束' : '已结束'}
      </p>
    )
  }
  // 未结束时紧迫度恒有档位（today/ongoing → today）；?? 只是类型兜底。
  const tier = urgencyTier(exam, now) ?? 'relaxed'
  if (status === 'today' || status === 'ongoing') {
    // 第 N 天只在进行中（ongoing，多日考试）时算：单日考试恒走 today
    // 分支，此前无条件算出的 dayIndex 永不渲染（国考 11-28/11-29 恒为
    // today；2026-11-16 0922 C 线死值清理）。考研 12-20「进行中 · 第 2 天」
    // 仍走同一表达式，行为不变。
    // U-107：首考日当天优先用 firstDayLabel（国考 11-28「今天国考 ·
    // 专业科目 14:00 开考」），与首页条带 nearestExamCountdown 同口径；
    // 首考日之后（国考 11-29 / 京考 12-06，daysUntil 首考日为 -1）仍
    // 回落「今天考试」——首日文案只在首日成立。ongoing 分支不动。
    const label =
      status === 'today'
        ? daysUntil(firstExamDay(exam), now) === 0 && exam.firstDayLabel
          ? exam.firstDayLabel
          : '今天考试'
        : `进行中 · 第 ${1 - daysUntil(firstExamDay(exam), now)} 天`
    return (
      <p className={`text-lg font-semibold ${URGENCY_DAY_CLASS[tier]}`}>{label}</p>
    )
  }

  // 倒计时锚首考日（国考 11-28 专业科目先考），与时钟卡同口径。
  const parts = countdownParts(shanghaiMidnightMs(firstExamDay(exam)), now)
  return (
    <div
      className="flex items-end gap-3"
      role="timer"
      aria-label={`${exam.shortName}倒计时 ${parts.days} 天 ${parts.hours} 小时 ${parts.minutes} 分钟`}
    >
      <span
        className={`font-mono text-4xl font-extrabold tabular-nums tracking-tight ${URGENCY_DAY_CLASS[tier]}`}
      >
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
