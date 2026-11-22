'use client'

/**
 * 首页「今日」小部件（进化轮 2026-11-22-0822，规格书 today-widget-spec-0422.md）。
 *
 * 一行轻量条：日期段（公历 + 农历 + 星座，点开今日中心）+ 热点段（飙升榜 1 条，
 * 换一换只在服务端随 RSC 下发的 30 条里轮换下标，客户端零新增请求）+「热榜 ›」入口。
 *  - 农历：复用 formatLunarDate 同步直出；水合后沿用 clock-widget.tsx 同款模式，
 *    东八区调一次 formatLunarDateExact 动态 import 校正（lunar-javascript 304KB
 *    不进首屏包）；按上海日期换算（见 src/lib/today-widget.ts 的 shanghaiNoonDate）。
 *  - 不渲染考试 / 专注 / 短剧 / 简报（仍只在今日中心小窗里）；不复用
 *    home-today-summary（它是计数与倒计时文案，不是日期）。
 *  - 只在 viewMode !== 'workbench' 时由 NavigationContent 挂载；工作台不渲染。
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Flame } from 'lucide-react'
import { formatLunarDate, formatLunarDateExact } from '@/lib/lunar-date'
import { safeHref } from '@/lib/safe-url'
import {
  buildTodayDateText,
  nextHotIndex,
  shanghaiNoonDate,
  type TodayHotItem,
} from '@/lib/today-widget'

export interface HomeTodayWidgetProps {
  /** 服务端注入的此刻毫秒数（测试可传 fake now；缺省为 Date.now()）。 */
  nowMs?: number
  /** 服务端随 RSC 下发的飙升榜前 30 条最小形状（与 /hot 同口径，page.tsx 投影）；取数失败时为 null/[]。 */
  trendingSites?: TodayHotItem[] | null
  /** 点日期段打开今日中心小窗（复用 NavigationContent 的 handleOpenTodayCenter）。 */
  onOpenTodayCenter?: () => void
}

export function HomeTodayWidget({
  nowMs = Date.now(),
  trendingSites = null,
  onOpenTodayCenter,
}: HomeTodayWidgetProps) {
  const date = useMemo(() => new Date(nowMs), [nowMs])
  const noonDate = useMemo(() => shanghaiNoonDate(date), [date])
  const [lunarLabel, setLunarLabel] = useState(() => formatLunarDate(noonDate))
  // 水合校正（clock-widget.tsx:72-85 同款模式）：东八区用 lunar-javascript 精确源
  // 校正一次，修 Intl 在 2027-02-06~03-07 整月差一天的已知偏差；非东八区时
  // formatLunarDateExact 内部回退到 Intl 源（仍按上海中午日期算，不差天）。
  useEffect(() => {
    let cancelled = false
    formatLunarDateExact(noonDate).then((exact) => {
      if (!cancelled && exact) setLunarLabel(exact)
    })
    return () => {
      cancelled = true
    }
  }, [noonDate])
  const dateText = useMemo(() => buildTodayDateText(date, lunarLabel), [date, lunarLabel])

  const sites = useMemo(
    () =>
      (Array.isArray(trendingSites) ? trendingSites : []).filter(
        (s): s is TodayHotItem => Boolean(s) && typeof s.title === 'string' && s.title.length > 0,
      ),
    [trendingSites],
  )
  const [hotIndex, setHotIndex] = useState(0)
  const currentHot = sites.length > 0 ? sites[hotIndex % sites.length] : null
  const hotHref = currentHot?.url ? safeHref(currentHot.url) : ''

  return (
    <section
      aria-label="今日"
      className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5"
    >
      <div className="flex flex-col gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 text-sm sm:min-h-11 sm:flex-row sm:items-center sm:justify-between">
        {onOpenTodayCenter ? (
          <button
            type="button"
            onClick={onOpenTodayCenter}
            aria-haspopup="dialog"
            aria-label="打开今日中心小窗"
            className="flex min-w-0 items-center gap-2 text-left text-foreground hover:text-foreground focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{dateText}</span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-2 text-foreground">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{dateText}</span>
          </span>
        )}

        <div className="flex min-w-0 items-center gap-2">
          {currentHot ? (
            <>
              <Flame className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {hotHref && hotHref !== '#' ? (
                <a
                  href={hotHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${currentHot.title}（新窗口打开）`}
                  className="min-w-0 flex-1 truncate text-foreground hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {currentHot.title}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-foreground">{currentHot.title}</span>
              )}
              <button
                type="button"
                onClick={() => setHotIndex((i) => nextHotIndex(i, sites.length))}
                aria-label="换一条热点"
                className="flex min-h-11 shrink-0 items-center text-muted-foreground hover:text-foreground focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-0"
              >
                换一换
              </button>
              {/* 只读屏播报当前热点标题，不视觉闪烁。 */}
              <span aria-live="polite" className="sr-only">
                {currentHot.title}
              </span>
            </>
          ) : null}
          <Link
            href="/hot"
            className="shrink-0 text-link hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            热榜 ›
          </Link>
        </div>
      </div>
    </section>
  )
}
