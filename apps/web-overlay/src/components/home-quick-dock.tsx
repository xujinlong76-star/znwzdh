'use client'

/**
 * 三合一单行「高频直达」坞（A4）：
 * 将原先纵向串行的 SpeedDialDock（179px）、HomeFrequentVisits 与 HomeRecentVisits
 * 合并为单个 ~56px 紧凑单行坞，支持内联切换「⚡ 极速置顶 | ⭐ 我的常用 | 🕒 最近访问」，
 * 并支持右侧「全部 ▾」按需打开完整清单小窗口。
 * 保持 `id="quick-access-tray"` 与 `data-speed-dial="true"` 兼容 DIY 与直达规范。
 */
import { useEffect, useMemo, useState, memo } from 'react'
import dynamic from 'next/dynamic'
import { ChevronRight, History, Star, Zap } from 'lucide-react'
import { SiteFavicon } from '@/components/site-favicon'
import { HorizontalScrollFade } from '@/components/horizontal-scroll-fade'
import { NumberDialBadge } from '@/components/number-dial-badge'
import { safeHref } from '@/lib/safe-url'
import type { SpeedDialSite } from '@/lib/speed-dial-order'
import {
  OFFLINE_RECENT_LIMIT,
  readOfflineVisits,
  recordOfflineVisit,
  topFrequentVisits,
  type RecentVisit,
} from '@/lib/offline-recent'
import type { DialSite } from '@/lib/number-dial'
import { useExternalLinkTarget } from '@/lib/user-preferences'
import type { WorkspaceId } from '@/components/workspace-filter'

const QuickDockAllDialog = dynamic(
  () => import('@/components/home-windows/quick-dock-all-dialog').then((m) => m.QuickDockAllDialog),
  { ssr: false, loading: () => null },
)

type DockTab = 'speed' | 'frequent' | 'recent'

export interface HomeQuickDockProps {
  allSites: DialSite[]
  activeWorkspace: WorkspaceId
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

// P0-2：包 memo——父组件传的 allSites/activeWorkspace/dialDigitById/speedSites 均已稳定。
export const HomeQuickDock = memo(function HomeQuickDock({
  allSites,
  activeWorkspace,
  dialDigitById,
  speedSites,
  maxInlineItems = 7,
}: HomeQuickDockProps) {
  const externalTarget = useExternalLinkTarget()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<DockTab>('speed')
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  const [allDialogOpen, setAllDialogOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
    let cancelled = false
    const sync = () => {
      void readOfflineVisits(OFFLINE_RECENT_LIMIT)
        .then((rows) => {
          if (!cancelled) setRecentVisits(rows)
        })
        .catch(() => {
          // 离线存储不可用时不阻断直达坞展示
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
        meta: undefined as string | undefined,
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
        className="mb-1 flex h-12 items-center gap-2 rounded-xl border border-border/60 bg-card/75 px-3 backdrop-blur-xs"
      >
        {/* 首屏瘦身：单行 48px（h-12）——左紧凑 tab + 中间横向滚动胶囊区 +
            右「展开全部」。胶囊区已接入 HorizontalScrollFade 横向滚动渐隐
            （2026-11-20 合入合并：首屏单行布局 + 顶栏渐隐包装，两者都保留）。 */}
        <div className="flex shrink-0 items-center gap-1" role="tablist" aria-label="高频直达分类">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'speed'}
              onClick={() => setActiveTab('speed')}
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
              aria-selected={activeTab === 'frequent'}
              disabled={!mounted || frequentVisits.length === 0}
              onClick={() => setActiveTab('frequent')}
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
              aria-selected={activeTab === 'recent'}
              disabled={!mounted || recentVisits.length === 0}
              onClick={() => setActiveTab('recent')}
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
          className="min-w-0 flex-1"
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
          className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
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
