'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, CalendarDays } from 'lucide-react'
import {
  GUANGDONG_ZIKAO_SCORE_URL,
  guangdongZikaoSignupPhase,
  type GuangdongZikaoSignupPhase,
} from '@/lib/exam-calendar'
import { safeHref } from '@/lib/safe-url'

/**
 * 广东自考 2027 年 1 月报名报考卡（C4，2026-11-23 10:22 轮实现，全程卡 P0–P6）。
 *
 * 定稿依据：evolution-round-2026-11-23-0922-w2.md（§4.2 七相位、§4.5 验收）+
 * evolution-round-2026-11-23-1022-w2.md（§2 D1–D4 裁决、§3 RW-C4-01–04 修补、
 * §5.5 逐相位文案表、§5.6 高度预算 220px、§5.7 18 个单测点）。
 * 事实源：省考试院 2026-11-10 报名报考须知与粤考办〔2026〕16 号；
 * 门控唯一事实源是 exam-calendar.ts 里的 guangdongZikaoSignupPhase，
 * 本文件不写日期字面量做门控，不算天数倒计时。
 *
 * 落点：首页 navigation-content.tsx 一处，dynamic(ssr: false)；
 * /brief 不上，AnnouncementBar 不挂。CTA 是站外直链（无站 id 可报），
 * 点击不记录、不上报（D3 定稿）。外链一律过 safeHref，
 * target _blank + noopener noreferrer。整卡不可点，只有 CTA 是链接；
 * 无入场动画，无闪烁徽章。
 */

export interface GuangdongZikaoSignupCardCopy {
  /** 徽章（常驻，sky 档，与 C1 红系双通道区分） */
  badge: string
  /** 相位标题行 */
  title: string
  /** 截止时刻行（静态时刻 + 相位状态，不含天数倒计时） */
  statusLines: string[]
  /** 副行（双受众分流 / 报考规则 / 缴费确认提醒） */
  subLines: string[]
  /** CTA 文案；P3 等报考期为 null（无 CTA，只留提醒行，D1 定稿） */
  ctaLabel: string | null
  /** 防仿冒行（常驻） */
  antiFraudLine: string
}

const BADGE = '广东自考 · 报名报考'
const ANTI_FRAUD_LINE = '唯一官方入口，认准 eeagd.edu.cn · 新页面打开'

/**
 * 相位文案纯函数（与渲染放同一文件，供单测 import；C1 同款）。
 * 文案逐字取自 1022-W2 §5.5 定稿表；P3 返回完整提醒文案、ctaLabel 为 null。
 */
export function guangdongZikaoSignupCardCopy(
  phase: GuangdongZikaoSignupPhase,
): GuangdongZikaoSignupCardCopy {
  switch (phase) {
    case 'signup':
      return {
        badge: BADGE,
        title: '新生报名进行中',
        statusLines: ['预报名 11 月 27 日 12:00 截止，正式报名同日 17:00 截止；相片审核需时间，别拖到最后一天'],
        subLines: ['老生不用报名，12 月 1 日 14:00 再来报考'],
        ctaLabel: '去广东省自学考试管理系统报名 →',
        antiFraudLine: ANTI_FRAUD_LINE,
      }
    case 'signup-last-call':
      return {
        badge: BADGE,
        title: '今天截止：正式报名 17:00 截止',
        statusLines: ['预报名已截止，正式报名今天 17:00 截止，11 月 28 日后不再受理'],
        subLines: ['还没预报名的，本次 1 月考期已无法报名；已拿到预报名号的，今天 17:00 前去正式报名。'],
        ctaLabel: '去正式报名（凭预报名号）→',
        antiFraudLine: ANTI_FRAUD_LINE,
      }
    case 'waiting':
      return {
        badge: BADGE,
        title: '报名已截止',
        statusLines: ['报考 12 月 1 日 14:00 开始，缴费 12 月 2 日 10:00 开始'],
        subLines: ['还没预报名的，本次 1 月考期已无法报名；已拿到准考证号的，12 月 1 日 14:00 回来报考'],
        ctaLabel: null,
        antiFraudLine: ANTI_FRAUD_LINE,
      }
    case 'apply':
      return {
        badge: BADGE,
        title: '报考进行中 · 最多 4 门',
        statusLines: ['报考 12 月 4 日 17:00 截止；缴费 12 月 2 日 10:00 至 12 月 5 日 17:00'],
        subLines: [
          '每次只限报考一次、只能选一个考区、最多 4 门',
          '一经确认不得增减更改，缴费不退；缴费后须回系统确认已缴费',
        ],
        ctaLabel: '去报考选课 →',
        antiFraudLine: ANTI_FRAUD_LINE,
      }
    case 'pay-last-call':
      return {
        badge: BADGE,
        title: '今天截止：缴费 17:00 截止',
        statusLines: ['报考已截止；未缴费 = 报考不成功'],
        subLines: ['缴费后须回系统确认已缴费'],
        ctaLabel: '去缴费 →',
        antiFraudLine: ANTI_FRAUD_LINE,
      }
  }
}

/**
 * 纯展示视图（内部函数）：调用方按门控算好 copy 传进来。
 * 外壳照抄 home-exam-strip-view.tsx 同款 section + 渐变卡片容器与 flex-wrap
 * 结构（wrap-guard 教训：文案块含 basis-full sm:basis-0，360px 窄屏不逐字竖排）。
 * 徽章 chip 用 sky 档（与 C1 红系拉开，RW-C4-03/S5 定稿）；正文一律 text-sm，
 * CTA min-h-11（44px），只在 ctaLabel 非空时渲染（P3 无链接）。
 */
function GuangdongZikaoSignupCardView({ copy }: { copy: GuangdongZikaoSignupCardCopy }) {
  return (
    <section
      aria-label="广东自考 2027 年 1 月报名报考"
      className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5"
    >
      <div className="rounded-2xl border bg-gradient-to-r from-card via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/5 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-400">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {copy.badge}
          </span>
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <p className="text-sm font-semibold text-sky-700 dark:text-sky-400">{copy.title}</p>
            {copy.statusLines.map((line) => (
              <p key={line} className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                {line}
              </p>
            ))}
            {copy.subLines.map((line) => (
              <p key={line} className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                {line}
              </p>
            ))}
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{copy.antiFraudLine}</p>
          </div>
          {copy.ctaLabel ? (
            <a
              href={safeHref(GUANGDONG_ZIKAO_SCORE_URL)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
            >
              {copy.ctaLabel}
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/**
 * 首页挂载用的提醒岛（模式照抄 GuokaoAdmissionReminderIsland，无 props）。
 *
 * 挂载前渲染 null（门控依赖客户端时间，SSR 直出会在时刻边界与水合结果
 * 错位）；挂载后按当前时刻算门控，窗口内渲染卡片，窗口外渲染 nothing。
 * 60 秒 tick（U-235 同款）：时刻边界最长迟 1 分钟翻态，不许 1 秒 tick。
 * 高度预算 220px（390px，RW-C4-04 裁决，待 live L1 实测登记实际值）。
 */
export function GuangdongZikaoSignupCard() {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (now === null) return null
  const phase = guangdongZikaoSignupPhase(now)
  if (!phase) return null
  return <GuangdongZikaoSignupCardView copy={guangdongZikaoSignupCardCopy(phase)} />
}
