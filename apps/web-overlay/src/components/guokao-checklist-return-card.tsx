'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import {
  EXAMS,
  daysUntil,
  firstExamDay,
  guokaoAdmissionPhase,
  isGuokaoAdmissionClosed,
} from '@/lib/exam-calendar'
import { recordOfflineVisit } from '@/lib/offline-recent'

/**
 * C1 国考准考证打印回访卡（首页内联轻卡，2026-11-23 10:22 轮重建）。
 *
 * 定稿依据：evolution-round-2026-11-23-0422-w3.md（§1.3 挂载写法、§3.3
 * 三分支文案、§4 C-G1–C-G7）；重建依据：0822-W2 §2（组件草稿要点）——
 * 0822 轮 /tmp 草稿已随机器重启丢失，本文件按笔记重新著码，与定稿逐项对齐。
 *
 * 口径（实现轮不得自创第四种分支）：
 *  - 门控唯一事实源是 guokaoAdmissionPhase()，仅 open / last-call 渲染
 *    正常卡；11-29 15:00 后（phase 为 null）正常卡消失，改由收尾行承接
 *    （2026-11-23 15:22 轮 W3 R1）：同一位置留一句收尾文案 + 去 /exam
 *    的接续入口，收尾门控只认 isGuokaoAdmissionClosed()（与 phase 同一
 *    门控、同一截止常量），不另写日期字面量做门控。
 *  - 倒计时锚首考日 11-28（firstExamDay(guokao)），不是 11-29；天数用
 *    daysUntil 实算，不写死。
 *  - 外壳/布局照抄 home-exam-strip-view.tsx（section 外壳、flex 行、文案块
 *    basis-full sm:basis-0、CTA min-h-11 pill）；徽章红档沿用条带 urgent /
 *    today 同款配色，徽章文案取「国考 · 准考证打印」。
 *  - 卡片正文一律 text-sm；徽章本身沿用条带同款小字（C-G6 的禁令只限正文）。
 *  - CTA 文案复用 /exam 清单入口原句，同页跳；点击只调 recordOfflineVisit
 *   （合成 id，写本机快照），不调 reportClick（清单页不是收录站点）。
 *  - 不含 N3/N4；exam-calendar.ts 零改动。
 */
export type GuokaoReturnCardContent =
  | { phase: 'open' | 'last-call'; title: string; label: string }
  | null

const LAST_CALL_TITLE = '末班提醒：准考证打印 11 月 29 日 15:00 截止'

/**
 * 回访卡内容纯函数（与渲染同文件，供单测直接 import）。
 *
 * 分支（设 d = daysUntil(firstExamDay(guokao), now)）：
 *  - phase 为 null（11-23 前或 11-29 15:00 后）→ null，整卡不渲染；
 *  - d > 0 且 open（11-23–11-26）→ 标题「准考证打印已开放」，标签实算天数；
 *  - d > 0 且 last-call（仅 11-27）→ eveLabel 全句，不显示天数；
 *  - d === 0（11-28）→ firstDayLabel 全句，不显示天数；
 *  - d < 0 且 phase 非 null（仅 11-29，15:00 前）→ 「今天笔试」，不出现 0 天/负数。
 */
export function guokaoReturnCardContent(nowMs: number): GuokaoReturnCardContent {
  const phase = guokaoAdmissionPhase(nowMs)
  if (phase !== 'open' && phase !== 'last-call') return null
  const guokao = EXAMS.find((exam) => exam.id === 'guokao')
  if (!guokao) return null
  const d = daysUntil(firstExamDay(guokao), nowMs)
  if (d > 0 && phase === 'open') {
    return { phase, title: '准考证打印已开放', label: `距国考 ${d} 天` }
  }
  if (d > 0) {
    return { phase, title: LAST_CALL_TITLE, label: guokao.eveLabel ?? `明天${guokao.shortName}` }
  }
  if (d === 0) {
    return { phase, title: LAST_CALL_TITLE, label: guokao.firstDayLabel ?? `今天${guokao.shortName}` }
  }
  return { phase, title: LAST_CALL_TITLE, label: '今天笔试' }
}

export interface GuokaoReturnCardClosure {
  title: string
  label: string
  subline: string
}

/**
 * 回访卡收尾行纯函数（2026-11-23 15:22 轮 W3 R1，与渲染同文件，
 * 供单测直接 import）。
 *
 *  - 11-29 15:00 之前（含 open / last-call 与 11-15 前窗口外）→ null：
 *    不抢正常卡片的位置，窗口未开时也不提前显示「已截止」；
 *  - 11-29 15:00 之后 → 收尾文案：标题「准考证打印已截止」、
 *    标签「后续安排见考试日历」、副行写清关闭时刻；CTA 去 /exam。
 * 门控只认 isGuokaoAdmissionClosed()（与 guokaoAdmissionPhase()
 * 同一门控、同一截止常量），组件内不另写日期字面量。
 * 字宽预算（沿用 C-G8/C-G9 模型，14px 字号）：标题行 262px、副行
 * 288px、CTA 约 196px，360px 内容宽 302px 下均为 1 行。
 */
export function guokaoReturnCardClosure(nowMs: number): GuokaoReturnCardClosure | null {
  if (!isGuokaoAdmissionClosed(nowMs)) return null
  return {
    title: '准考证打印已截止',
    label: '后续安排见考试日历',
    subline: '系统 11 月 29 日 15:00 已关闭，无法补打',
  }
}

/**
 * 首页回访卡客户端组件。模式照抄 GuokaoAdmissionReminderIsland：
 * 挂载前渲染 null（门控依赖客户端时间，SSR 直出会在午夜边界与水合结果差一天），
 * 挂载后 60 秒 tick 按绝对时刻重算门控（15:00 边界最长迟 1 分钟翻态）。
 * 挂载点（已落地 2026-11-23）：navigation-content.tsx，HomeSubtitleHint 之后、
 * C4 卡之上（胶囊行之前），dynamic(ssr: false) 按需加载，本文件不负责挂载。
 *
 * 收尾（2026-11-23 15:22 轮 W3 R1）：11-29 15:00 后正常卡消失，同一位置
 * 改 render 收尾行（标题「准考证打印已截止」+ 去 /exam 的接续入口），
 * 而不是凭空消失；11-15 之前窗口未开时仍渲染 null，不提前显示收尾。
 * 正常卡与收尾行共用同一外壳、同一徽章、同一行结构（C-G8 行数守卫仍按
 * 2 个 text-sm <p>、1 个徽章、1 个 CTA 计数）；收尾 CTA 是普通 <a>
 *（去 /exam，服务端直出页，全页加载可接受），以保留正常卡 <Link> 唯一、
 * href 字面量守卫（#13）不变。
 */
export function GuokaoChecklistReturnCard() {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (now === null) return null
  const content = guokaoReturnCardContent(now)
  const closure = content === null ? guokaoReturnCardClosure(now) : null
  // 正常卡与收尾行二选一：两者都无（11-15 之前窗口未开）才渲染 null。
  const display = content
    ? {
        title: `${content.title} · ${content.label}`,
        subline: '打印截止 11 月 29 日 15:00，逾期无法补打',
        cta: 'checklist' as const,
      }
    : closure
      ? {
          title: `${closure.title} · ${closure.label}`,
          subline: closure.subline,
          cta: 'exam' as const,
        }
      : null
  if (!display) return null

  return (
    <section aria-label="国考准考证打印前清单" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="rounded-2xl border bg-gradient-to-r from-card via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/5 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-400">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            国考 · 准考证打印
          </span>
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <p className="text-sm font-semibold text-foreground">{display.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{display.subline}</p>
          </div>
          {display.cta === 'checklist' ? (
            <Link
              href="/exam/guokao-checklist"
              onClick={() =>
                recordOfflineVisit({
                  id: 'in-site:guokao-checklist',
                  title: '国考准考证打印前清单',
                  href: '/exam/guokao-checklist',
                  icon: null,
                })
              }
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
            >
              打印前清单：三件事先勾好 →
            </Link>
          ) : (
            <a
              href="/exam"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
            >
              去 /exam 看后续安排 →
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
