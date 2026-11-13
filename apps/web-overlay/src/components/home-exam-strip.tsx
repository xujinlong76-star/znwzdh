import Link from 'next/link'
import { ArrowRight, CalendarDays } from 'lucide-react'
import { ExamCountdown } from '@/app/exam/exam-countdown'
import { nearestExam, nextExamNode } from '@/lib/exam-calendar'

/**
 * 首页「考试季」运营条（服务端渲染 + 倒计时客户端岛）。
 *
 * 只放真实内容：最近一场考试（名/科目/日期均取 exam-calendar 事实源，
 * 不硬编码日期）+ 实时倒计时 + 下一步节点提醒（准考证打印等）；四场
 * 全结束时整条不渲染，考试季结束自然下线。入口唯一链接指向 /exam。
 * 结构仿 HomeBriefStrip：无数据不渲染、不开天窗、不放占位假数据。
 */
export function HomeExamStrip() {
  const nearest = nearestExam()
  if (!nearest) return null
  const nextNode = nextExamNode(nearest)

  return (
    <section aria-label="考试季" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="rounded-2xl border bg-gradient-to-r from-sky-500/10 via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/5 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-400">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            考试季 · {nearest.shortName}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {nearest.name} · {nearest.tagline} · {nearest.examDateLabel}
            </p>
            {nextNode ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                下一步：{nextNode.label} · {nextNode.detail}
              </p>
            ) : null}
          </div>
          <ExamCountdown exam={nearest} />
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
