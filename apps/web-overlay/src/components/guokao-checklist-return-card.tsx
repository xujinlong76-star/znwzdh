'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import {
  EXAMS,
  daysUntil,
  firstExamDay,
  guokaoAdmissionPhase,
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
 *  - 门控唯一事实源是 guokaoAdmissionPhase()，仅 open / last-call 渲染；
 *    11-29 15:00 后（phase 为 null）整卡消失，不另写日期字面量做门控。
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

/**
 * 首页回访卡客户端组件。模式照抄 GuokaoAdmissionReminderIsland：
 * 挂载前渲染 null（门控依赖客户端时间，SSR 直出会在午夜边界与水合结果差一天），
 * 挂载后 60 秒 tick 按绝对时刻重算门控（15:00 边界最长迟 1 分钟翻态）。
 * 挂载点（下一步，另轮）：navigation-content.tsx，HomeSubtitleHint 之后、
 * 胶囊行之前，dynamic(ssr: false) 按需加载，本文件不负责挂载。
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
  if (!content) return null

  return (
    <section aria-label="国考准考证打印前清单" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="rounded-2xl border bg-gradient-to-r from-card via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/5 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-400">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            国考 · 准考证打印
          </span>
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <p className="text-sm font-semibold text-foreground">
              {content.title}
              {' · '}
              {content.label}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">打印截止 11 月 29 日 15:00，逾期无法补打</p>
          </div>
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
        </div>
      </div>
    </section>
  )
}
