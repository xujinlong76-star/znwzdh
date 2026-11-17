import Link from 'next/link'
import { ArrowRight, CalendarDays, Clapperboard } from 'lucide-react'
import DailyFocus from '@/components/daily-focus'
import BriefResurface from '@/app/brief/brief-resurface'
import { safeHref } from '@/lib/safe-url'
import { loadDramaFeatured } from '@/lib/drama-featured'
import {
  nearestExamCountdown,
  nextExamNode,
  type ExamUrgencyTier,
} from '@/lib/exam-calendar'

/**
 * 首页「今日一件事」区（U-24，首屏第一位）。
 *
 * 只拼四个已有零件，不新增零件、不新增资讯流、不加广告：
 *   - 今日专注（DailyFocus 岛，本机 localStorage，明天自动清空）；
 *   - 考试倒计时（exam-calendar 的 nearestExamCountdown / nextExamNode，
 *     服务端纯函数直出，不挂每秒 tick 的倒计时岛——tick 岛仍只在折叠区
 *     的完整考试条里；四场全结束时整行不渲染，不挂空态占位）；
 *   - 今日短剧（drama-featured 清单首部 1 部，标题旁如实标 linkNote，
 *     榜单页 / 报道页 / 百科页不是正片，不写成直达正片）；
 *   - 今日重温（BriefResurface 岛，无可重温收藏时它自己返回 null）。
 *
 * 日期行按 Asia/Shanghai 时区算（“今天”是用户的日子，不写死）；
 * 考试与短剧都不写死日期、考试 id、剧名、URL——事实源只读，
 * 考试数据文件一律不动（U-31 并行在做考试数据入口）。
 */

// 倒计时 lead 文案配色：与 ExamCountdown 岛同档（今天/明天/≤3 天红、
// ≤7 天琥珀、其余默认色），只上色、不改文案。
const COUNTDOWN_LABEL_CLASS: Record<ExamUrgencyTier, string> = {
  today: 'text-red-600 dark:text-red-400',
  tomorrow: 'text-red-600 dark:text-red-400',
  urgent: 'text-red-600 dark:text-red-400',
  soon: 'text-amber-700 dark:text-amber-400',
  relaxed: 'text-foreground',
}

/** 今日日期行：北京时间「11月17日周二」，服务端算、不写死。 */
function todayLabel(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  // Node 的 zh-CN numeric 月日会拼成「11/17」（CLDR 短格式），这里按站内
  // 惯用写法拼回「11月17日周二」，不依赖运行时的 Intl 字面形态。
  return `${get('month')}月${get('day')}日${get('weekday')}`
}

export function HomeTodayZone() {
  const countdown = nearestExamCountdown()
  const nextNode = countdown ? nextExamNode(countdown.exam) : undefined
  const { dramas } = loadDramaFeatured()
  const drama = dramas[0]

  return (
    <section aria-label="今日一件事" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <p className="mb-2 text-sm font-semibold">今日一件事 · {todayLabel()}</p>
      <div className="space-y-3">
        <DailyFocus />
        {countdown || drama ? (
          <div className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="space-y-4">
              {countdown ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <CalendarDays className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden />
                    <span className={COUNTDOWN_LABEL_CLASS[countdown.tier]}>{countdown.label}</span>
                    <span className="font-normal text-muted-foreground">
                      · {countdown.exam.name} · {countdown.exam.examDateLabel}
                    </span>
                  </span>
                  {nextNode ? (
                    <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                      下一步：{nextNode.label} · {nextNode.detail}
                    </p>
                  ) : null}
                  <Link
                    href="/exam"
                    className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    考试日历 <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              ) : null}
              {drama ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Clapperboard className="h-4 w-4 text-rose-500" aria-hidden />
                    今日短剧
                  </span>
                  <a
                    href={safeHref(drama.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 min-w-0 max-w-full items-center truncate text-sm font-medium hover:text-primary"
                  >
                    {drama.title}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {drama.platformTitle} · {drama.linkNote}
                  </span>
                  <Link
                    href="/drama"
                    className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    短剧专区 <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <BriefResurface />
      </div>
    </section>
  )
}
