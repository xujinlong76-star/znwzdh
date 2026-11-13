'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays } from 'lucide-react'
import { ExamCountdown } from '@/app/exam/exam-countdown'
import { type ExamInfo, type ExamNode } from '@/lib/exam-calendar'
import {
  MY_EXAMS_STORAGE_KEY,
  nearestFollowedExam,
  nextTodoNode,
  parseMyExams,
} from '@/lib/my-exams'

/**
 * 首页「考试季」运营条客户端视图（挂载后个性化）。
 *
 * 挂载前只渲染服务端直出的默认视图（全局最近场 + 下一步节点），与 SSR
 * 一字不差；挂载后读一次本机关注状态（navhub.my-exams.v1），若用户关注
 * 了未结束的考试，整条切到已关注场中首日最早的一场，徽章变「我的考试」，
 * 「下一步」变该场第一个未勾选且未结束的节点——打开首页就能对上自己的
 * 考前清单。无关注、关注场全部已结束、存储不可用时一律静默回退默认视图；
 * 只读不写；关注与勾选只保存在本机浏览器。
 */
export function HomeExamStripView({
  exam: defaultExam,
  nextNode: defaultNextNode,
}: {
  exam: ExamInfo
  nextNode: ExamNode | undefined
}) {
  const [personal, setPersonal] = useState<{
    exam: ExamInfo
    nextNode: ExamNode | undefined
  } | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MY_EXAMS_STORAGE_KEY)
      if (!raw) return
      const state = parseMyExams(JSON.parse(raw))
      const preferred = nearestFollowedExam(state)
      if (!preferred) return
      setPersonal({ exam: preferred, nextNode: nextTodoNode(state, preferred) })
    } catch {
      // 存储被禁或数据损坏：静默回退默认视图，不拦首页渲染。
    }
  }, [])

  const exam = personal?.exam ?? defaultExam
  const nextNode = personal ? personal.nextNode : defaultNextNode

  return (
    <section aria-label="考试季" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="rounded-2xl border bg-gradient-to-r from-sky-500/10 via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/5 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-400">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {personal ? '我的考试' : '考试季'} · {exam.shortName}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {exam.name} · {exam.tagline} · {exam.examDateLabel}
            </p>
            {nextNode ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
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
