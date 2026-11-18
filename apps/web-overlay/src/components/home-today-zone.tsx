import Link from 'next/link'
import { ArrowRight, ArrowUpRight, BellRing, CalendarDays, Clapperboard } from 'lucide-react'
import DailyFocus from '@/components/daily-focus'
import BriefResurface from '@/app/brief/brief-resurface'
import { safeHref } from '@/lib/safe-url'
import { loadDramaFeatured } from '@/lib/drama-featured'
import {
  nearestExamCountdown,
  nextExamNode,
  todayNodeDeadlineMs,
  todayFollowUpNodes,
  todayNodes,
  type ExamInfo,
  type ExamNode,
  type ExamUrgencyTier,
} from '@/lib/exam-calendar'
import { HomeTodayCountdown } from '@/components/home-today-countdown'

/**
 * 首页「今日一件事」区（U-24，首屏第一位）。
 *
 * 只拼已有零件，不新增零件、不新增资讯流、不加广告：
 *   - 今日专注（DailyFocus 岛，本机 localStorage，明天自动清空）；
 *   - 考试倒计时（exam-calendar 的 nearestExamCountdown / nextExamNode，
 *     服务端纯函数直出，不挂每秒 tick 的倒计时岛——tick 岛仍只在折叠区
 *     的完整考试条里；十一场全结束时整行不渲染，不挂空态占位）；
 *   - 今日提醒（U-102：exam-calendar 的 todayNodes / todayFollowUpNodes，
 *     服务端纯函数直出；有今日节点时才渲染今日行，无节点时整行不渲染、
 *     不挂空态占位；节点行有已核实官方 URL 的挂行内直达链接（U-31 配方），
 *     无 URL 的行仍是纯文本；唯一站内 CTA 只指 /exam；
 *     窗口末日节点只写「今日截止」，时点只以节点 detail 原文呈现；
 *     接续节点收进展开区，同样取自节点数据、同规则挂链）；
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

/**
 * 今日行节点 label（U-155）：有已核实官方 URL 的节点行挂行内直达链接
 * （U-31 配方：safeHref + 新窗口 + min-h-11 + sky-700 + ArrowUpRight）；
 * 无 URL 的行仍是纯文本，不编链接。今日行与接续区共用同一规则。
 * aria-label 用「官方入口」兜底文案（研究 §1.5 允许的分支：nodeLinkCopy
 * 在 'use client' 的岛文件里，U-124 守卫又把它钉在岛内，不宜抽离；
 * 11-19 行读作「江西成绩复核官方入口（新窗口打开）」）。行内 label
 * 不占 flex-1（detail 保留 flex-1），class 其余照抄配方。
 */
function TodayNodeLabel({ exam, node }: { exam: ExamInfo; node: ExamNode }) {
  const label = `${exam.shortName} · ${node.label}`
  if (!node.url) {
    return <span className="font-medium">{label}</span>
  }
  return (
    <a
      href={safeHref(node.url)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${node.label}官方入口（新窗口打开）`}
      className="inline-flex min-h-11 items-center gap-1 font-medium text-sky-700 hover:underline dark:text-sky-400"
    >
      {label}
      <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
    </a>
  )
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

export interface HomeTodayZoneProps {
  /** 注入用时刻（毫秒）：只为测试传 fake now；page.tsx 不传，默认当前时刻。 */
  nowMs?: number
}

export function HomeTodayZone({ nowMs = Date.now() }: HomeTodayZoneProps) {
  const countdown = nearestExamCountdown(nowMs)
  const nextNode = countdown ? nextExamNode(countdown.exam, nowMs) : undefined
  const todayItems = todayNodes(nowMs)
  const followUps = todayFollowUpNodes(nowMs)
  const { dramas } = loadDramaFeatured()
  const drama = dramas[0]

  return (
    <section aria-label="今日一件事" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <p className="mb-2 text-sm font-semibold">今日一件事 · {todayLabel(new Date(nowMs))}</p>
      <div className="space-y-3">
        <DailyFocus />
        {countdown || drama || todayItems.length > 0 ? (
          <div className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="space-y-4">
              {todayItems.length > 0 ? (
                <div aria-label="今日节点" className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                      <BellRing className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden />
                      今日提醒
                    </span>
                    <Link
                      href="/exam"
                      className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      考试日历 <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                  <ul className="space-y-1.5">
                    {todayItems.map(({ exam, node, kind }) => {
                      // 峰值日包 W10：有已核实目标时刻的节点（11-18 七项）在
                      // 徽章与 detail 之间挂倒计时 chip；表外节点（undefined）
                      // 不渲染。target 是 todayNodeDeadlineMs 的毫秒值转 ISO，
                      // 绝不拿 endISO 当天 00:00 冒充。kind === 'today' 的行
                      // （查分节点，「距开通」语义）过期后 chip 直接消失
                      // （hideWhenPassed），不显示 endedLabel 缺省文案；
                      // endsToday 的行过期仍显示 endedLabel 缺省文案。
                      const deadlineMs = todayNodeDeadlineMs({ exam, node, kind })
                      return (
                        <li
                          key={`${exam.id}:${node.label}`}
                          className="flex flex-wrap items-baseline gap-x-2 text-sm"
                        >
                          <TodayNodeLabel exam={exam} node={node} />
                          {kind === 'endsToday' ? (
                            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                              今日截止
                            </span>
                          ) : null}
                          {deadlineMs !== undefined ? (
                            <HomeTodayCountdown
                              target={new Date(deadlineMs).toISOString()}
                              {...(kind === 'today' ? { hideWhenPassed: true } : {})}
                            />
                          ) : null}
                          <span className="min-w-0 flex-1 basis-full text-muted-foreground">{node.detail}</span>
                        </li>
                      )
                    })}
                  </ul>
                  {followUps.length > 0 ? (
                    <details className="text-sm">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 font-medium text-primary hover:underline">
                        接续安排
                      </summary>
                      <ul className="mt-1 space-y-1.5">
                        {followUps.map(({ exam, node }) => (
                          <li
                            key={`${exam.id}:${node.label}`}
                            className="flex flex-wrap items-baseline gap-x-2"
                          >
                            <TodayNodeLabel exam={exam} node={node} />
                            <span className="min-w-0 flex-1 basis-full text-muted-foreground">
                              {node.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
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
                    nextNode.url ? (
                      // 问题⑪：下一步节点挂了已核实官方 url 的，渲染为可点直达
                      //（U-31 行内直达配方：safeHref + 新窗口 + min-h-11 + sky-700）；
                      // 无 url 的节点（成考成绩）仍是纯文本，不编链接。
                      <a
                        href={safeHref(nextNode.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-1 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
                      >
                        下一步：{nextNode.label} · {nextNode.detail}
                        <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
                      </a>
                    ) : (
                      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                        下一步：{nextNode.label} · {nextNode.detail}
                      </p>
                    )
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
