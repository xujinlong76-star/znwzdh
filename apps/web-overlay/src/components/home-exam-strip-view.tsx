'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays } from 'lucide-react'
import { ExamCountdown } from '@/app/exam/exam-countdown'
import { useMyExams } from '@/hooks/useMyExams'
import {
  EXAM_REMINDER_TIER_LABEL,
  reminderTier,
  urgencyTier,
  type ExamInfo,
  type ExamNode,
  type ExamReminderTier,
  type ExamUrgencyTier,
} from '@/lib/exam-calendar'
import {
  nearestFollowedExam,
  nextTodoNode,
} from '@/lib/my-exams'

/**
 * 徽章紧迫度配色：与倒计时同档（≤7 天琥珀、≤3 天/明天/今天红），
 * relaxed 沿用原来的 sky 配方；小字用 amber-700 / red-700（白底 ≥4.8:1），
 * 深色档 amber-400 / red-400。挂载前一律 sky，与 SSR 直出一致，防午夜
 * 边界水合错位。
 */
const STRIP_BADGE_CLASS: Record<ExamUrgencyTier, string> = {
  today: 'border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-400',
  tomorrow: 'border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-400',
  urgent: 'border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-400',
  soon: 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  relaxed: 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-400',
}

/** 提醒前缀小字配色：7 天档琥珀、其余红（与徽章同档不同深浅，均为小字合规色） */
const REMINDER_TEXT_CLASS: Record<ExamReminderTier, string> = {
  '7d': 'text-amber-700 dark:text-amber-400',
  '3d': 'text-red-700 dark:text-red-400',
  '1d': 'text-red-700 dark:text-red-400',
  today: 'text-red-700 dark:text-red-400',
}

/**
 * 首页「考试季」运营条客户端视图（挂载后个性化）。
 *
 * 挂载前只渲染服务端直出的默认视图（全局最近场 + 下一步节点），与 SSR
 * 一字不差；挂载后由共享 hook 接管本机关注状态（与 /exam 四场卡片同一
 * 份快照），若用户关注了未结束的考试，整条切到已关注场中首日最早的
 * 一场，徽章变「我的考试」，「下一步」变该场第一个未勾选且未结束的
 * 节点——打开首页就能对上自己的考前清单，/exam 页改关注后首页无需
 * 刷新即更新。无关注、关注场全部已结束、存储不可用时一律静默回退
 * 默认视图；只读不写；关注与勾选只保存在本机浏览器。
 */
export function HomeExamStripView({
  exam: defaultExam,
  nextNode: defaultNextNode,
}: {
  exam: ExamInfo
  nextNode: ExamNode | undefined
}) {
  const { state } = useMyExams()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const preferred = state === null ? undefined : nearestFollowedExam(state)
  const personal =
    preferred && state !== null
      ? { exam: preferred, nextNode: nextTodoNode(state, preferred) }
      : null

  const exam = personal?.exam ?? defaultExam
  const nextNode = personal ? personal.nextNode : defaultNextNode

  // 紧迫度与提醒档位都是 (考试 + 今天) 的只读派生：不写存储、不标脏，
  // 与 Wave 0 的脏标记零交集。挂载前取 relaxed / 无提醒，与 SSR 一致。
  const now = Date.now()
  const tier: ExamUrgencyTier = mounted ? (urgencyTier(exam, now) ?? 'relaxed') : 'relaxed'
  // 提醒文案只对已关注考试显示（未关注只变色、不出文案，避免噪音）。
  const reminder: ExamReminderTier | null =
    personal && mounted ? reminderTier(exam, now) : null

  return (
    <section aria-label="考试季" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="rounded-2xl border bg-gradient-to-r from-sky-500/10 via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${STRIP_BADGE_CLASS[tier]}`}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {personal ? '我的考试' : '考试季'} · {exam.shortName}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {exam.name} · {exam.tagline} · {exam.examDateLabel}
            </p>
            {nextNode ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {reminder ? (
                  <>
                    <span className={`font-semibold ${REMINDER_TEXT_CLASS[reminder]}`}>
                      {EXAM_REMINDER_TIER_LABEL[reminder]}
                    </span>
                    {' · '}
                  </>
                ) : null}
                下一步：{nextNode.label} · {nextNode.detail}
              </p>
            ) : null}
          </div>
          <ExamCountdown exam={exam} />
          <Link
            href="/exam"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
          >
            考试日历 <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  )
}
