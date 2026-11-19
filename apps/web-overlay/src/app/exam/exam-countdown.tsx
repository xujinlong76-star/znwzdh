'use client'

import { useEffect, useState } from 'react'
import {
  countdownParts,
  daysUntil,
  examStatus,
  firstExamDay,
  hasActionableNodes,
  nextExamNode,
  shanghaiMidnightMs,
  todayNodeDeadlineMs,
  urgencyTier,
  type ExamInfo,
  type ExamUrgencyTier,
} from '@/lib/exam-calendar'
import { ExamVerificationBadge } from '@/components/exam-verification-badge'
import { useExamVerificationLookup } from '@/components/exam-verification-context'
import { formatCorrectionNote, isPeakEligible } from '@/lib/exam-verification'

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
  // R1：服务端取数经 ExamVerificationProvider（page.tsx）传入；未包 Provider
  // 的调用点（如首页条带）取空表，行为不变。
  const { latestByKey, correctionsByKey } = useExamVerificationLookup()
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
    // 节点全过后（11-30 起）仍渲染裸「已结束」，行为不变。
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
  // §7.1 / §9.2：下一节点的时刻倒计时 chip 只给准入节点；unverified 节点只显示
  // 「待核实」徽标，不渲染时刻倒计时。考试日本身的天数倒计时是日期口径，不受此限。
  // R1：最新核查行 verdict === 'false' 时节点下架（准入闸 false、时刻 undefined）。
  const nextNode = nextExamNode(exam, now)
  const nextKey = nextNode !== undefined ? `${exam.id}:${nextNode.label}` : undefined
  const nextLatest = nextKey !== undefined ? latestByKey[nextKey] : undefined
  const nextEligible = nextNode !== undefined && isPeakEligible(nextNode, now, nextLatest)
  const nextDeadlineMs =
    nextNode !== undefined && nextEligible
      ? todayNodeDeadlineMs({ exam, node: nextNode, kind: 'today' }, now, nextLatest)
      : undefined
  const nextParts =
    nextDeadlineMs !== undefined ? countdownParts(nextDeadlineMs, now) : undefined
  // §6.3 更正注：时刻/入口/适用口径三类重大错误的更正注置于节点卡片顶部
  //（此处为下一节点行下方，即该节点卡片区内）；同一节点多次更正按时间倒序。
  const nextCorrectionNotes =
    nextKey !== undefined
      ? (correctionsByKey[nextKey] ?? [])
          .map((c) => formatCorrectionNote(c))
          .filter((t): t is string => t !== null)
      : []
  return (
    <div className="space-y-2">
      <div
        className="flex items-end gap-3"
        role="timer"
        aria-live="off"
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
      {nextNode !== undefined ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">下一步：{nextNode.label}</span>
          <ExamVerificationBadge node={nextNode} examId={exam.id} />
          {nextParts !== undefined && nextDeadlineMs !== undefined ? (
            <span aria-live="off" className="font-mono tabular-nums text-muted-foreground">
              距截止 {nextParts.days > 0 ? `${nextParts.days} 天 ` : ''}
              {nextParts.hours} 小时 {nextParts.minutes} 分
            </span>
          ) : null}
        </div>
      ) : null}
      {nextCorrectionNotes.length > 0 ? (
        <div className="space-y-1">
          {nextCorrectionNotes.map((note, i) => (
            <p key={i} className="text-xs leading-relaxed text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
