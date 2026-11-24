'use client'

/**
 * 三合一单行「高频直达」坞（A4）：
 * 将原先纵向串行的 SpeedDialDock（179px）、HomeFrequentVisits 与 HomeRecentVisits
 * 合并为单个 ~56px 紧凑单行坞，支持内联切换「⚡ 极速置顶 | ⭐ 我的常用 | 🕒 最近访问」，
 * 并支持右侧「全部 ▾」按需打开完整清单小窗口。
 * 保持 `id="quick-access-tray"` 与 `data-speed-dial="true"` 兼容 DIY 与直达规范。
 *
 * 默认 tab 契约（D-W3-Tier1，选项 ii 钉选优先）：仅当无钉选且有最近访问时默认
 * 「最近」；有钉选的用户首屏不变（钉选是显式表达）。三 tab 顺序固定为
 * 极速置顶 / 常用 / 最近；数字直达角标只在「极速置顶」渲染，不要“统一”到三 tab。
 */
import { useEffect, useMemo, useRef, useState, memo } from 'react'
import dynamic from 'next/dynamic'
import { ChevronRight, History, Star, Zap } from 'lucide-react'
import { SiteFavicon } from '@/components/site-favicon'
import { HorizontalScrollFade } from '@/components/horizontal-scroll-fade'
import { NumberDialBadge } from '@/components/number-dial-badge'
import { safeHref } from '@/lib/safe-url'
import type { SpeedDialSite } from '@/lib/speed-dial-order'
import { formatRelativeTime } from '@/lib/format-relative-time'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import {
  OFFLINE_RECENT_LIMIT,
  readOfflineVisits,
  recordOfflineVisit,
  topFrequentVisits,
  type RecentVisit,
} from '@/lib/offline-recent'
import { useExternalLinkTarget } from '@/lib/user-preferences'

const QuickDockAllDialog = dynamic(
  () => import('@/components/home-windows/quick-dock-all-dialog').then((m) => m.QuickDockAllDialog),
  { ssr: false, loading: () => null },
)

type DockTab = 'speed' | 'frequent' | 'recent'

/**
 * 默认 tab 规则（D-W3-Tier1，选项 ii 钉选优先）：
 * 仅当无钉选且有最近访问时默认「最近」；有钉选的用户首屏不变。
 * 为什么是钉选优先：钉选是用户在 DIY 里做的唯一显式表达，最近访问只是
 * 隐式信号（一次误点即进榜）；且「极速置顶」里已内嵌最近前 3
 * （speed-dial-order.ts 的 RECENT_VISIT_TOP_N），回访优先相对钉选优先的
 * 增量收益只剩“第 4 个以后的最近站 + 时间 meta”；数字直达角标只在
 * 「极速置顶」渲染，回访优先会把它藏到第二 tab 之后，削弱 Batch 1 第 04 项
 * （MRU + Alt+数字）的可发现性。纯函数：仓库 vitest 是 node 环境、无 jsdom，
 * 组件挂载测不了，规则放纯函数里单测。
 */
export function resolveDefaultDockTab(pinnedCount: number, recentCount: number): DockTab {
  return pinnedCount === 0 && recentCount > 0 ? 'recent' : 'speed'
}

/**
 * 「最近」tab 的相对时间 meta。formatRelativeTime 对非法值返回“—”，
 * 脏数据（NaN / Infinity / 0 / 负数）不能渲染成“—”或 1970 年日期，留空。
 */
export function recentVisitMeta(v: RecentVisit): string | undefined {
  return Number.isFinite(v.visitedAt) && v.visitedAt > 0
    ? formatRelativeTime(v.visitedAt)
    : undefined
}

export interface HomeQuickDockProps {
  dialDigitById?: ReadonlyMap<string, number | string>
  /**
   * P2-14：速拨顺序（Top 9）由父级 navigation-content 的 dialSites 一次算好透传，
   * 坞不再自己调 computeSpeedDialSites 重算（同一输入、同一纯函数算两遍）。
   * 父级在窗口获焦时重读最近访问，dialSites 随之刷新，坞的速拨页签同步更新。
   */
  speedSites: SpeedDialSite[]
  /** 首行默认最多展示数量，避免折叠换行推高首屏 */
  maxInlineItems?: number
}

// P0-2：包 memo——父组件传的 dialDigitById/speedSites 均已稳定。
// U-358：allSites/activeWorkspace 曾随速拨重构传入、坞内从未使用，已删（lint 2 警告随之消失）。
export const HomeQuickDock = memo(function HomeQuickDock({
  dialDigitById,
  speedSites,
  maxInlineItems = 7,
}: HomeQuickDockProps) {
  const externalTarget = useExternalLinkTarget()
  // 默认 tab 决策只读钉选 id 列表；速拨顺序仍由父级透传（P2-14），此处不重算。
  const { speedDialPinnedIds } = useHomeDIY()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<DockTab>('speed')
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  const [recentLoaded, setRecentLoaded] = useState(false)
  const [allDialogOpen, setAllDialogOpen] = useState(false)
  // 用户手动切过 tab 后不再自动改默认 tab；默认 tab 只在最近访问首次回填后决定一次，
  // 此后 focus 回填 / 取消钉选都不再中途翻 tab。
  const userChoseTabRef = useRef(false)
  const defaultTabAppliedRef = useRef(false)

  // 手动切 tab 即显式选择：记下来，默认 tab 规则不再覆盖它。
  const chooseTab = (tab: DockTab) => {
    userChoseTabRef.current = true
    setActiveTab(tab)
  }

  useEffect(() => {
    setMounted(true)
    let cancelled = false
    const sync = () => {
      void readOfflineVisits(OFFLINE_RECENT_LIMIT)
        .then((rows) => {
          if (!cancelled) {
            setRecentVisits(rows)
            setRecentLoaded(true)
          }
        })
        .catch(() => {
          // 离线存储不可用时不阻断直达坞展示
          if (!cancelled) setRecentLoaded(true)
        })
    }
    sync()
    window.addEventListener('focus', sync)
    return () => {
      cancelled = true
      window.removeEventListener('focus', sync)
    }
  }, [])

  // P2-14：速拨顺序由父级透传 speedSites（见 props 注释），此处不再重算。
  // recentVisits 仍由坞自己维护，供「常用/最近」两个页签用。
  // 默认 tab（选项 ii）：最近访问是异步回填的，必须等回填后再定 tab，避免首屏闪跳；
  // 且不能放在挂载 effect 的闭包里读 speedDialPinnedIds——挂载 effect 闭包捕获的是
  // 首帧渲染时的值（DIY 配置在 effect 里水合，首帧默认空钉选），钉选用户会被误判为
  // 无钉选。决定只做一次。
  useEffect(() => {
    if (!mounted || !recentLoaded || defaultTabAppliedRef.current) return
    defaultTabAppliedRef.current = true
    if (userChoseTabRef.current) return
    const next = resolveDefaultDockTab(speedDialPinnedIds.length, recentVisits.length)
    if (next !== 'speed') setActiveTab(next)
  }, [mounted, recentLoaded, recentVisits, speedDialPinnedIds])
  const frequentVisits = useMemo(
    () => (mounted ? topFrequentVisits(recentVisits, 12) : []),
    [mounted, recentVisits],
  )

  const activeItems = useMemo(() => {
    if (activeTab === 'frequent') {
      return frequentVisits.slice(0, maxInlineItems).map((v) => ({
        id: v.id,
        title: v.title,
        href: v.href,
        icon: v.icon ?? null,
        digit: undefined as number | string | undefined,
        meta: v.count && v.count > 1 ? `${v.count}次` : undefined,
      }))
    }
    if (activeTab === 'recent') {
      return recentVisits.slice(0, maxInlineItems).map((v) => ({
        id: v.id,
        title: v.title,
        href: v.href,
        icon: v.icon ?? null,
        digit: undefined as number | string | undefined,
        meta: recentVisitMeta(v),
      }))
    }
    return speedSites.slice(0, maxInlineItems).map((s) => ({
      id: s.id,
      title: s.title,
      href: s.href,
      icon: s.icon ?? null,
      useDefaultIcon: s.useDefaultIcon,
      digit: dialDigitById?.get(s.id),
      meta: undefined as string | undefined,
    }))
  }, [activeTab, frequentVisits, recentVisits, speedSites, maxInlineItems, dialDigitById])

  if (speedSites.length === 0 && frequentVisits.length === 0 && recentVisits.length === 0) {
    return null
  }

  return (
    <>
      <section
        id="quick-access-tray"
        data-speed-dial="true"
        aria-label="高频直达与常用访问"
        className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-border/60 bg-card/75 px-3 py-2 backdrop-blur-xs sm:h-12 sm:flex-nowrap sm:py-0"
      >
        {/* 首屏瘦身：单行 48px（h-12）——左紧凑 tab + 中间横向滚动胶囊区 +
            右「展开全部」。胶囊区已接入 HorizontalScrollFade 横向滚动渐隐
            （2026-11-20 合入合并：首屏单行布局 + 顶栏渐隐包装，两者都保留）。 */}
        <div className="flex shrink-0 items-center gap-1" role="tablist" aria-label="高频直达分类">
            <button
              type="button"
              role="tab"
              id="quick-dock-tab-speed"
              aria-controls="quick-dock-panel"
              aria-selected={activeTab === 'speed'}
              onClick={() => chooseTab('speed')}
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'speed'
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>极速置顶</span>
            </button>
            <button
              type="button"
              role="tab"
              id="quick-dock-tab-frequent"
              aria-controls="quick-dock-panel"
              aria-selected={activeTab === 'frequent'}
              disabled={!mounted || frequentVisits.length === 0}
              onClick={() => chooseTab('frequent')}
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                activeTab === 'frequent'
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Star className="h-3.5 w-3.5" />
              <span>常用</span>
            </button>
            <button
              type="button"
              role="tab"
              id="quick-dock-tab-recent"
              aria-controls="quick-dock-panel"
              aria-selected={activeTab === 'recent'}
              disabled={!mounted || recentVisits.length === 0}
              onClick={() => chooseTab('recent')}
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                activeTab === 'recent'
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>最近</span>
            </button>
          </div>

        <HorizontalScrollFade
          id="quick-dock-panel"
          className="order-3 w-full basis-full min-w-0 sm:order-none sm:w-auto sm:basis-auto sm:flex-1"
          scrollClassName="flex items-center gap-1.5"
          ariaLabel="高频直达站点列表"
          prevAriaLabel="向左滚动直达站点"
          nextAriaLabel="向右滚动直达站点"
        >
          {activeItems.map((item) => (
            <a
              key={`${activeTab}-${item.id}`}
              href={safeHref(item.href)}
              target={externalTarget}
              rel="noopener noreferrer"
              onClick={() =>
                recordOfflineVisit({
                  id: item.id,
                  title: item.title,
                  href: item.href,
                  icon: item.icon,
                })
              }
              className="group relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border/50 bg-background/80 px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent/50"
            >
              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <SiteFavicon
                  icon={item.icon}
                  url={item.href}
                  title={item.title}
                  className="h-4 w-4"
                />
                <NumberDialBadge digit={item.digit} className="-bottom-1 -right-1" />
              </span>
              <span className="max-w-[96px] truncate">{item.title}</span>
              {item.meta ? (
                <span className="text-[10px] text-muted-foreground">{item.meta}</span>
              ) : null}
            </a>
          ))}
        </HorizontalScrollFade>

        <button
          type="button"
          onClick={() => setAllDialogOpen(true)}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer sm:ml-0"
        >
          <span>展开全部</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </section>

      {allDialogOpen ? (
        <QuickDockAllDialog
          open={allDialogOpen}
          onOpenChange={setAllDialogOpen}
          speedSites={speedSites}
          frequentVisits={frequentVisits}
          recentVisits={recentVisits}
          dialDigitById={dialDigitById}
          externalTarget={externalTarget}
        />
      ) : null}
    </>
  )
})
