import Link from 'next/link'
import { ArrowRight, CalendarDays } from 'lucide-react'
import { nearestExam, nextExamNode } from '@/lib/exam-calendar'
import { HomeExamStripView } from './home-exam-strip-view'

/**
 * 首页「考试季」运营条（服务端外壳）。
 *
 * 服务端只做一件事：按事实源挑全局最近一场；四场全结束时不再整条
 * 消失，改渲染静态空态条带（2026-12-21 起）：不挂倒计时岛、不读
 * localStorage、不挂载客户端视图，纯服务端静态直出，SSR 一致。
 * 空态只说已核实的事实——本轮考试已结束、2027 日程以官方公告为准，
 * 不写任何未公布的日期，也不写场次数字（防 EXAMS 扩充后文案失实）。
 * 入口保留，指向 /exam；结构仿 HomeBriefStrip。
 */
export function HomeExamStrip() {
  const nearest = nearestExam()
  if (!nearest) return <HomeExamStripEmptyState />
  return <HomeExamStripView exam={nearest} nextNode={nextExamNode(nearest)} />
}

/**
 * 考试季空态条带：与正常条带同款外壳与 sky 配方（浅色/深色已合规），
 * 徽章只写「考试季」（无场次可标），主标题说 2027 日程待公布，
 * 副文案说本轮已结束。纯服务端静态，不含倒计时、不含客户端视图。
 */
function HomeExamStripEmptyState() {
  return (
    <section aria-label="考试季" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="rounded-2xl border bg-gradient-to-r from-sky-500/10 via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/5 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-400">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            考试季
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">2027 年考试日程陆续公布中</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              本轮考试已结束 · 新日程以官方公告为准
            </p>
          </div>
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
