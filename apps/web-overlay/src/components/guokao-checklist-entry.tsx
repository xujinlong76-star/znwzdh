'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, Printer } from 'lucide-react'
import {
  GUOKAO_ADMISSION_URL,
  GUOKAO_PORTAL_URL,
  isGuokaoAdmissionClosed,
} from '@/lib/exam-calendar'
import { safeHref } from '@/lib/safe-url'

/**
 * 国考准考证「打印前清单」页的入口区岛（2026-11-23 15:22 轮 W3 R1 收尾）。
 *
 * 原为 page.tsx 里的服务端静态区（U-285 G8）：主按钮只挂打印系统直链
 * （读 GUOKAO_ADMISSION_URL 常量，不写死域名），门户只作文字链。
 * R1 把它改成客户端岛，理由与阶段横幅同款：截止是 15:00 时刻级门控，
 * 服务端 revalidate 3600 会让 CTA 在截止后最多迟 1 小时才置灰，期间
 * 仍链向已关的官方系统；岛内 60 秒 tick 最长迟 1 分钟翻态，与横幅同分钟。
 *
 * 门控只认 isGuokaoAdmissionClosed()（与 guokaoAdmissionPhase()
 * 同一门控、同一截止常量）：
 *  - 未截止：标题「去打印准考证」+ 可点主按钮（直链打印系统）+ 门户文字链；
 *  - 已截止：标题「准考证打印已截止」+ 置灰 disabled 按钮（无 href，
 *    不再链向已关系统）+ 门户文字链保留（报名/审查信息仍可走专题网站
 *    门户查询，门户本身不是打印系统；「进入打印系统」一句随之撤下，
 *    截止后不再作此主张）。
 */

export interface GuokaoChecklistEntryState {
  closed: boolean
}

/**
 * 入口区 section 的锚点 id（2026-11-23 16:22 轮 W3 R2）。
 * 清单岛 7/7 完成态的锚点链到这里；定义一次、两处引用，不各自写字面量。
 * 清单岛只引用该 id 字符串，不读入口岛内部——两岛零耦合。
 */
export const GUOKAO_CHECKLIST_ENTRY_SECTION_ID = 'guokao-checklist-entry'

export function guokaoChecklistEntry(nowMs: number): GuokaoChecklistEntryState {
  return { closed: isGuokaoAdmissionClosed(nowMs) }
}

/** 纯展示：给定时刻渲染入口区（可服务端渲染，供测试直接断言两态文案）。 */
export function GuokaoChecklistEntryView({ nowMs }: { nowMs: number }) {
  const { closed } = guokaoChecklistEntry(nowMs)
  return (
    <section
      id={GUOKAO_CHECKLIST_ENTRY_SECTION_ID}
      aria-labelledby="guokao-checklist-entry-heading"
      className="scroll-mt-20"
    >
      <h2 id="guokao-checklist-entry-heading" className="text-lg font-bold text-foreground">
        {closed ? '准考证打印已截止' : '去打印准考证'}
      </h2>
      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        {closed ? (
          <button
            type="button"
            disabled
            className="inline-flex min-h-11 cursor-not-allowed items-center gap-1 rounded-full border border-border bg-muted px-3.5 text-sm font-medium text-muted-foreground opacity-60"
          >
            <Printer className="h-4 w-4" aria-hidden />
            准考证打印已截止
          </button>
        ) : (
          <a
            href={safeHref(GUOKAO_ADMISSION_URL)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
          >
            <Printer className="h-4 w-4" aria-hidden />
            去打印准考证
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        )}
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {closed ? (
            <>
              打印系统已于 11 月 29 日 15:00 关闭，无法补打；报名/审查信息可走专题网站门户{' '}
              <a
                href={safeHref(GUOKAO_PORTAL_URL)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sky-700 hover:underline dark:text-sky-400"
              >
                bm.scs.gov.cn/kl2027
              </a>
              查询。
            </>
          ) : (
            <>
              报名/审查走专题网站门户{' '}
              <a
                href={safeHref(GUOKAO_PORTAL_URL)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sky-700 hover:underline dark:text-sky-400"
              >
                bm.scs.gov.cn/kl2027
              </a>
              ，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn）。
            </>
          )}
        </p>
      </div>
    </section>
  )
}

/**
 * 清单页挂载的入口岛。模式照抄 GuokaoChecklistPhaseBanner：挂载前
 * 渲染 null（阶段依赖客户端时间，SSR 直出会在午夜边界与水合结果差一天）；
 * 挂载后按当前时刻算门控，60 秒 tick（15:00 边界最长迟 1 分钟翻态）。
 */
export function GuokaoChecklistEntry() {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (now === null) return null
  return <GuokaoChecklistEntryView nowMs={now} />
}
