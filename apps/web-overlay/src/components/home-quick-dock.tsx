'use client'

/**
 * 三合一单行「高频直达」坞（A4）：
 * 将原先纵向串行的 SpeedDialDock（179px）、HomeFrequentVisits 与 HomeRecentVisits
 * 合并为单个 ~56px 紧凑单行坞，模式（⚡ 极速置顶 / ⭐ 常用 / 🕒 最近访问）收进
 * 一个下拉触发器（2026-11-25 UI 评审 P0-2 / 方案 A′），右侧「全部 ▾」按需打开
 * 完整清单小窗口。
 * 保持 `id="quick-access-tray"` 与 `data-speed-dial="true"` 兼容 DIY 与直达规范。
 * <md 整行隐藏（CSS 隐藏、DOM 锚点保留），顶行「快捷坞」入口与坞内「展开全部」
 * 共用同一个受控弹窗（开关由父级 navigation-content 的 quickDockOpen 管）。
 *
 * 默认 tab 契约（D-W3-Tier1，选项 ii 钉选优先）：仅当无钉选且有最近访问时默认
 * 「最近」；有钉选的用户首屏不变（钉选是显式表达）。三模式顺序固定为
 * 极速置顶 / 常用 / 最近；数字直达角标只在「极速置顶」渲染，不要“统一”到三模式。
 */
import { useEffect, useMemo, useRef, useState, memo } from 'react'
import dynamic from 'next/dynamic'
import { ChevronDown, ChevronRight, History, Star, Zap, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  /**
   * P0-2 / Step 2（U-445）：「全部站点」弹窗受控开关。父级 navigation-content
   * 传入时，顶行「快捷坞」入口与坞内「展开全部」共用同一个开关（quickDockOpen）；
   * 不传时坞内自管（DIY 预览等无父级开关的用法）。
   */
  allDialogOpen?: boolean
  onAllDialogOpenChange?: (open: boolean) => void
}

/** A′：三模式的触发器图标与文案（顺序固定：极速置顶 / 常用 / 最近）。 */
const DOCK_MODE_META: Record<DockTab, { label: string; Icon: LucideIcon }> = {
  speed: { label: '极速置顶', Icon: Zap },
  frequent: { label: '常用', Icon: Star },
  recent: { label: '最近', Icon: History },
}

// P0-2：包 memo——父组件传的 dialDigitById/speedSites 均已稳定。
// U-358：allSites/activeWorkspace 曾随速拨重构传入、坞内从未使用，已删（lint 2 警告随之消失）。
export const HomeQuickDock = memo(function HomeQuickDock({
  dialDigitById,
  speedSites,
  maxInlineItems = 7,
  allDialogOpen: allDialogOpenProp,
  onAllDialogOpenChange,
}: HomeQuickDockProps) {
  const externalTarget = useExternalLinkTarget()
  // 默认 tab 决策只读钉选 id 列表；速拨顺序仍由父级透传（P2-14），此处不重算。
  const { speedDialPinnedIds } = useHomeDIY()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<DockTab>('speed')
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  const [recentLoaded, setRecentLoaded] = useState(false)
  // P0-2 / Step 2：受控时开关归父级（quickDockOpen），否则坞内自管。
  const [internalAllDialogOpen, setInternalAllDialogOpen] = useState(false)
  const allDialogOpen = allDialogOpenProp ?? internalAllDialogOpen
  const setAllDialogOpen = (open: boolean) => {
    if (onAllDialogOpenChange) onAllDialogOpenChange(open)
    else setInternalAllDialogOpen(open)
  }
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
        useDefaultIcon: undefined as boolean | undefined,
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
        useDefaultIcon: undefined as boolean | undefined,
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

  const activeMode = DOCK_MODE_META[activeTab]

  return (
    <>
      <section
        id="quick-access-tray"
        data-speed-dial="true"
        aria-label="高频直达与常用访问"
        className="hidden md:flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-border/60 bg-card/85 px-2.5 py-1.5 sm:h-10 sm:flex-nowrap sm:py-0"
      >
        {/* 首屏瘦身：单行 40px（h-10，与左侧工作区胶囊行像素级同高对齐）——左模式下拉
            触发器 + 中间横向滚动胶囊区 + 右「展开全部」。胶囊区已接入 HorizontalScrollFade
            横向滚动渐隐（2026-11-20 合入合并：首屏单行布局 + 顶栏渐隐包装，两者都保留）。
            A′：三模式不再内联平铺成 tab（旧 tablist 无方向键漫游，见 U-394），只留
            一个下拉触发器（L2 虚线边界＝可点开的模式）；<md 整行隐藏，顶行「快捷坞」
            入口点开的是同一个受控弹窗（开关在父级）。 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`快捷坞模式：${activeMode.label}，点击切换`}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed border-border-strong px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 cursor-pointer"
            >
              <activeMode.Icon className="h-3.5 w-3.5" />
              <span>{activeMode.label}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-48 p-1.5 bg-popover text-popover-foreground border border-border shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
          >
            <DropdownMenuRadioGroup value={activeTab} onValueChange={(v) => chooseTab(v as DockTab)}>
              <DropdownMenuRadioItem value="speed" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground">极速置顶</span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="frequent"
                disabled={!mounted || frequentVisits.length === 0}
                className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent"
              >
                <Star className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground">常用</span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="recent"
                disabled={!mounted || recentVisits.length === 0}
                className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent"
              >
                <History className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground">最近</span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <HorizontalScrollFade
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
              className="group relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70"
            >
              {/* P0-B（2026-11-26）：线性 flex，角标永不盖图标——
                  旧结构是 16px 图标上压一只 16px 绝对定位 kbd（旧偏移 class
                  为 -bottom-1/-right-1），白色角标盖住图标约 3/4，只剩白色
                  碎片 / L 形（Claude / Midjourney / 元宝 / 星火 / Gemini /
                  Kimi 真机复现）。现改为流内三段：
                  [kbd 序号] + [18px 固定圆角 icon 容器 + 浅色兜底底色] + [站名]。
                  18px 容器用纯白底（深色主题亦然）：Gemini / Kimi 这类深色透明底
                  品牌标在深底上不可见，白底兜底才看得见；图标加载失败时
                  SiteFavicon 的渐变字母徽标盖住容器，不露白边。
                  NumberDialBadge 用 inline 模式（relative 流内），digit 为空不渲染。 */}
              <NumberDialBadge digit={item.digit} inline />
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-white ring-1 ring-border/40">
                <SiteFavicon
                  icon={item.icon}
                  url={item.href}
                  title={item.title}
                  useDefaultIcon={item.useDefaultIcon}
                  className="h-full w-full"
                />
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
