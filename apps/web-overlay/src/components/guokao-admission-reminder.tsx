'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import {
  admissionReminderFor,
  type ExamInfo,
  type GuokaoAdmissionReminder as GuokaoAdmissionReminderData,
} from '@/lib/exam-calendar'
import { safeHref } from '@/lib/safe-url'

/**
 * 国考准考证打印提醒（纯展示：提醒对象由调用方按门控算好传进来，
 * 窗口外传 null 时渲染 nothing，不出空壳）。
 *
 * 两种形态：
 *  - 'strip'：首页考试条带的副行，替代「下一步」——提醒期国考的下一步
 *    本来就是准考证打印，不丢信息；小字用 red-700 / dark red-400，
 *    与条带现有的提醒小字同档（白底 ≥4.8:1）；
 *  - 'card'：/exam 国考卡片内的提醒块，A 版全句 + 打印入口。
 * 官方链接只走 exam-calendar 里的 GUOKAO_ADMISSION_URL 常量（唯一事实源，
 * U-59：直链为报名确认及准考证打印系统，写 http；专题网站门户入口另见
 * 同一文件的 GUOKAO_PORTAL_URL 常量），本文件不写死域名；外链一律过
 * safeHref，target _blank + noopener noreferrer。
 */
export function GuokaoAdmissionReminder({
  reminder,
  variant,
}: {
  reminder: GuokaoAdmissionReminderData | null
  variant: 'strip' | 'card'
}) {
  if (!reminder) return null

  if (variant === 'strip') {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        <span className="font-semibold text-red-700 dark:text-red-400">准考证打印提醒</span>
        {' · '}
        {reminder.stripLine}
        {' '}
        <a
          href={safeHref(reminder.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-sky-700 hover:underline dark:text-sky-400"
        >
          去打印准考证
          <ArrowUpRight className="ml-0.5 inline h-3.5 w-3.5" aria-hidden />
        </a>
      </p>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/5 p-3.5">
      <p className="text-sm font-semibold text-red-700 dark:text-red-400">准考证打印提醒</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground">{reminder.cardLine}</p>
      <a
        href={safeHref(reminder.url)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
      >
        去打印准考证
        <ArrowUpRight className="h-4 w-4" aria-hidden />
      </a>
    </div>
  )
}

/**
 * /exam 国考卡片用的提醒岛（服务端页内挂载）。
 *
 * 模式照抄 ExamCountdown：挂载前渲染 null（倒计时/提醒依赖客户端时间，
 * SSR 直出会在午夜边界与水合结果差一天）；挂载后按当前时刻算门控，
 * 窗口内渲染 card 形态，窗口外渲染 nothing。15:00 截止是时刻级门控，
 * 客户端岛比分段缓存的服务端直出翻得准（服务端页 revalidate 1 小时，
 * 15:00 后最多迟 1 小时下线，岛是准点下线）。
 */
export function GuokaoAdmissionReminderIsland({ exam }: { exam: ExamInfo }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
  }, [])

  if (now === null) return null
  return <GuokaoAdmissionReminder reminder={admissionReminderFor(exam, now)} variant="card" />
}
