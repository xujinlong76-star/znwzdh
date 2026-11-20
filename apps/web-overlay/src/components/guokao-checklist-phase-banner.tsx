'use client'

import { useEffect, useState } from 'react'
import {
  daysUntil,
  guokaoAdmissionPhase,
  shanghaiMidnightMs,
  type GuokaoAdmissionPhase,
} from '@/lib/exam-calendar'

/**
 * 国考准考证「打印前清单」页的阶段横幅（U-285，D 步）。
 *
 * 复用 `guokaoAdmissionPhase`（唯一门控事实源，与提醒岛同一函数）：
 *  - countdown（11-15–11-21）：距打印开启 X 天；
 *  - warmup（11-22）：明天 0:00 开放打印；
 *  - open（11-23–11-26）：打印已开放；
 *  - last-call（11-27–11-29 15:00）：末班提醒；
 *  - null：门控窗口外——11-15 之前仍显示距开放天数（清单页 11-23 前
 *    即可访问，G3；横幅不随门控消失），11-29 15:00 之后显示已截止
 *    （与站内“已截止”口径一致，截止句只复用警示框已有事实，不新增主张）。
 *
 * 末班行不写“距关闭不足 X 天”：截止是 15:00 时刻级门控（非自然日），
 * `daysUntil` 按自然日算会把剩余时间说错；横幅只写确切的截止时刻。
 * 横幅不含任何链接：入口只在清单页入口区与 /exam 卡片，不写死域名。
 */

export type ChecklistBannerTone = 'info' | 'open' | 'last-call' | 'closed'

export interface ChecklistPhaseBanner {
  phase: GuokaoAdmissionPhase | 'pre-window' | 'closed'
  tone: ChecklistBannerTone
  label: string
  line: string
}

export function checklistPhaseBanner(nowMs: number): ChecklistPhaseBanner {
  const phase = guokaoAdmissionPhase(nowMs)
  if (phase === 'countdown') {
    const days = daysUntil('2026-11-23', nowMs)
    return {
      phase,
      tone: 'info',
      label: '打印阶段',
      line: `距打印开启 ${days} 天，11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止`,
    }
  }
  if (phase === 'warmup') {
    return {
      phase,
      tone: 'info',
      label: '打印阶段',
      line: '明天 0:00 开放打印，11 月 29 日 15:00 截止',
    }
  }
  if (phase === 'open') {
    return {
      phase,
      tone: 'open',
      label: '打印已开放',
      line: '打印已开放：11 月 23 日 0:00 一开就打，11 月 29 日 15:00 截止，逾期无法补打',
    }
  }
  if (phase === 'last-call') {
    return {
      phase,
      tone: 'last-call',
      label: '末班提醒',
      line: '末班提醒：11 月 29 日 15:00 截止，逾期系统关闭、无法补打',
    }
  }
  // phase === null：11-15 之前或 11-29 15:00 之后。
  if (nowMs < shanghaiMidnightMs('2026-11-15')) {
    const days = daysUntil('2026-11-23', nowMs)
    return {
      phase: 'pre-window',
      tone: 'info',
      label: '打印阶段',
      line: `距打印开启 ${days} 天，11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止`,
    }
  }
  return {
    phase: 'closed',
    tone: 'closed',
    label: '打印已截止',
    line: '打印已截止：11 月 29 日 15:00 后系统关闭、无法补打',
  }
}

const TONE_CLASS: Record<ChecklistBannerTone, { box: string; label: string }> = {
  info: {
    box: 'rounded-xl border border-border bg-card p-3.5',
    label: 'text-foreground',
  },
  open: {
    box: 'rounded-xl border border-sky-500/25 bg-sky-500/5 p-3.5',
    label: 'text-sky-700 dark:text-sky-400',
  },
  'last-call': {
    box: 'rounded-xl border border-red-500/25 bg-red-500/5 p-3.5',
    label: 'text-red-700 dark:text-red-400',
  },
  closed: {
    box: 'rounded-xl border border-border bg-card p-3.5',
    label: 'text-muted-foreground',
  },
}

/** 纯展示：给定时刻渲染横幅（可服务端渲染，供测试直接断言各阶段文案）。 */
export function GuokaoChecklistPhaseBannerView({ nowMs }: { nowMs: number }) {
  const banner = checklistPhaseBanner(nowMs)
  const tone = TONE_CLASS[banner.tone]
  return (
    <div role="status" data-checklist-phase-banner={banner.phase} className={tone.box}>
      <p className={`text-sm font-semibold ${tone.label}`}>{banner.label}</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground">{banner.line}</p>
    </div>
  )
}

/**
 * 清单页挂载的横幅岛。模式照抄 GuokaoAdmissionReminderIsland：挂载前
 * 渲染 null（阶段依赖客户端时间，SSR 直出会在午夜边界与水合结果差一天）；
 * 挂载后按当前时刻算门控，60 秒 tick（U-235 同款，15:00 边界最长迟 1 分钟翻态）。
 */
export function GuokaoChecklistPhaseBanner() {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (now === null) return null
  return <GuokaoChecklistPhaseBannerView nowMs={now} />
}
