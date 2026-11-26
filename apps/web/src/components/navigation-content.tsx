'use client'

import { useState, useMemo, useCallback, useRef, useEffect, startTransition, type ReactNode } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { DragEndEvent } from '@dnd-kit/react'
import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import type { CinemaInitialData } from '@/components/home-drama-cinema'
import { Sidebar } from '@/components/sidebar'
import { NavigationToolbar } from '@/components/navigation-toolbar'
import { HalfScreenDock } from '@/components/half-screen-dock'
import { NavigationCategorySection } from '@/components/navigation-category-section'
import { LazyMountSection } from '@/components/lazy-mount-section'
import { HomeDIYTrigger } from '@/components/home-diy-trigger'
import { HomeCapsuleRow } from '@/components/home-capsule-row'
import { HomeSubtitleHint } from '@/components/home-subtitle-hint'
import { HomeQuickDock } from '@/components/home-quick-dock'
import type { TodayCenterTab } from '@/components/home-windows/today-center-dialog'
import type { HomeTodayBadgeSummary } from '@/lib/home-today-summary'
import type { HubPluginItem } from '@/lib/navhub-api'
import { usePinnedCornerWidgets } from '@/lib/modular/pinned-widgets-store'
import { DirectoryPillToolbar } from '@/components/directory-pill-toolbar'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import {
  getGridClassForCardMode,
  normalizeCardDisplayMode,
  resolveEffectiveViewMode,
  type CanonicalCardDisplayMode,
} from '@/lib/modular/card-display-modes'
import {
  InitialViewModeProvider,
  useIsMobileViewport,
} from '@/components/initial-view-mode-context'
import { buildSceneSiteIndex, registerSceneSiteIndex } from '@/lib/modular/scene-apply'
import { SCENE_WORKSPACE_CHANGE_EVENT } from '@/lib/modular/scene-apply-live'
import { useHomeDiyGrid } from '@/lib/modular/use-home-diy-grid'
import { readDiyDragData } from '@/lib/modular/diy-drag'
import {
  useFeatureMask,
  stripFeaturePrefix,
  syncHiddenCategoriesFromDIY,
} from '@/lib/modular/feature-mask-store'
import { Footer } from '@/components/footer'
import { BentoStaticGrid } from '@/components/diy/bento-static-grid'
import {
  BentoDockBlock,
  BentoHotlistBlock,
  BentoSearchBlock,
} from '@/components/diy/bento-block-widgets'
import {
  migrateLayoutToV2,
  reconcileBreakpointBlocks,
  type AvailableWorkspaceBlock,
  type LayoutBlock,
  type WorkspaceBreakpointKey,
} from '@/lib/modular/workspace-layout-v2'
const BentoWorkspaceCanvas = dynamic(
  () => import('@/components/diy/bento-workspace-canvas').then((m) => m.BentoWorkspaceCanvas),
  { ssr: false, loading: () => null },
)
const BentoBlockInspector = dynamic(
  () => import('@/components/diy/bento-block-inspector').then((m) => m.BentoBlockInspector),
  { ssr: false, loading: () => null },
)
const TodayCenterDialog = dynamic(
  () => import('@/components/home-windows/today-center-dialog').then((m) => m.TodayCenterDialog),
  { ssr: false, loading: () => null },
)
// U-358：今日中心四区此前由 page.tsx（服务端）静态 import 后经内容槽位透传，
// 服务端每请求都渲染进 RSC payload、客户端叶子（daily-focus、exam-countdown、
// handoff 云同步等）也随首屏 JS 下发，尽管小窗默认关闭（todayOpen=false）。
// 改为这里 ssr:false 动态加载：四区只在小窗首次打开时才下载，首屏不再付这份体积。
// 三区外壳原为服务端组件，已转为客户端组件（见各文件头注释），内容与取数口径不变。
const TodayZoneContent = dynamic(
  () => import('@/components/home-today-zone').then((m) => m.HomeTodayZone),
  { ssr: false, loading: () => null },
)
const BriefStripContent = dynamic(
  () => import('@/components/home-brief-strip').then((m) => m.HomeBriefStrip),
  { ssr: false, loading: () => null },
)
const ExamStripContent = dynamic(
  () => import('@/components/home-exam-strip').then((m) => m.HomeExamStrip),
  { ssr: false, loading: () => null },
)
const HandoffCardWithCloudContent = dynamic(
  () => import('@/components/handoff-card-with-cloud').then((m) => m.HandoffCardWithCloud),
  { ssr: false, loading: () => null },
)
const StreakBarContent = dynamic(
  () => import('@/components/growth/streak-bar').then((m) => m.StreakBar),
  { ssr: false, loading: () => null },
)
const WidgetBoxDialog = dynamic(
  () => import('@/components/home-windows/widget-box-dialog').then((m) => m.WidgetBoxDialog),
  { ssr: false, loading: () => null },
)
const PinnedCornerWidgets = dynamic(
  () => import('@/components/home-windows/pinned-corner-widgets').then((m) => m.PinnedCornerWidgets),
  { ssr: false, loading: () => null },
)
const AppearanceGuideDialog = dynamic(
  () => import('@/components/home-windows/appearance-guide-dialog').then((m) => m.AppearanceGuideDialog),
  { ssr: false, loading: () => null },
)
const AiFinderDialog = dynamic(
  () => import('@/components/home-windows/ai-finder-dialog').then((m) => m.AiFinderDialog),
  { ssr: false, loading: () => null },
)
// 拖拽 provider 边界（DRAG-2 接线）：dnd-kit 约 133KB，绝不能静态进首屏。
// kit 在挂载后后台 import。P1-6：provider 只在编辑态挂载——
// 旧写法是 kit 一到就包上 provider，首屏水合后不久整片网格子树会被卸载重建一次
// （白白付一份完整渲染，还可能闪一下），而拖拽手柄只在编辑态才出现，
// 非编辑态包 provider 纯属浪费。改后：后台 chunk 到达时（非编辑态）
// 边界仍直接渲染 children，元素类型不变、零 remount；进入编辑态时才包 provider，
// 该 remount 并入编辑态切换（本来就要重渲染出拖拽手柄），不再是无意义的额外一次。
// 极少数情况（1 秒内就进编辑态、kit 尚在路上）：provider 在编辑中途到达时
// 仍会 remount 一次，属可接受的边界情形。
function DiyGridDragBoundary({
  kit,
  enabled,
  onDragEnd,
  children,
}: {
  kit: typeof import('@/components/diy/diy-drag-kit') | null
  /** 拖拽是否激活（编辑态）。非编辑态不包 provider，避免后台 chunk 到达时整树 remount。 */
  enabled: boolean
  onDragEnd: (event: DragEndEvent) => void
  children: ReactNode
}) {
  if (!enabled || !kit) return <>{children}</>
  const { DiyDragProvider } = kit
  return <DiyDragProvider onDragEnd={onDragEnd}>{children}</DiyDragProvider>
}

import { useOverlayBehavior } from '@/components/ui/overlay'
import {
  normalizeSettings,
  type FeatureKey,
} from '@/lib/site-settings'
import { readLocalHiddenHomeModules } from '@/lib/personal-home-modules'
import { CategoryQuickJumpBar } from '@/components/category-quick-jump-bar'

// 性能优化：动态懒加载大型组件，大幅缩减首屏 JS 体积与主线程阻塞时间
const ModularCanvas = dynamic(
  () => import('@/components/modular/modular-canvas').then((m) => m.ModularCanvas),
  { ssr: false }
)
const KeyboardShortcutsDialog = dynamic(
  () => import('@/components/keyboard-shortcuts-dialog').then((m) => m.KeyboardShortcutsDialog),
  { ssr: false }
)
const SitePeekDialog = dynamic(
  () => import('@/components/site-peek-dialog').then((m) => m.SitePeekDialog),
  { ssr: false }
)
const AddSiteDialog = dynamic(
  () => import('@/components/add-site-dialog').then((m) => m.AddSiteDialog),
  { ssr: false }
)
const QuickToolsDrawer = dynamic(
  () => import('@/components/quick-tools-drawer').then((m) => m.QuickToolsDrawer),
  { ssr: false }
)
// 浮动托盘与批量操作坞：都是「交互后才出现」的 UI。
// 之前静态导入会把 1,365 行的工具栏与批量引擎一起塞进首页初始包；
// 改为客户端懒加载后，首屏只留一个同高占位（不产生 CLS）。
const HomeDIYToolbar = dynamic(
  () => import('@/components/home-diy-toolbar').then((m) => m.HomeDIYToolbar),
  { ssr: false }
)
const BatchOperationDock = dynamic(
  () => import('@/components/batch-operation-dock').then((m) => m.BatchOperationDock),
  { ssr: false }
)
import { Button } from '@/registry/new-york/ui/button'

import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Menu, RotateCcw, Trash2 } from 'lucide-react'
import { preferredScrollBehavior } from '@/lib/motion'

import { cn } from '@/lib/utils'
import { type WorkspaceId } from '@/components/workspace-filter'
import {
  suggestCategoryForSite,
  clampCardOpacity,
  isSafeWallpaperUrl,
  isSafeSiteHref,
} from '@/lib/modular/diy-presets'
import { filterNavigationByWorkspace } from '@/lib/modular/workspace-matching'
import { countCategorySites, estimateTruncatedSectionHeight } from '@/lib/modular/category-counts'
import {
  combineAndSortCategories,
  customCategoriesToNavigation,
} from '@/lib/modular/category-combine'
import { useSiteSelection } from '@/lib/modular/use-site-selection'
import { useExternalLinkTarget, useUserPreference } from '@/lib/user-preferences'
import { readOfflineVisits, type RecentVisit } from '@/lib/offline-recent'
import { buildDialMap } from '@/lib/number-dial'
import { batchExportSitesToMarkdown } from '@/lib/batch-operations'
import { copyText } from '@/lib/clipboard'
import { computeSpeedDialSites } from '@/lib/speed-dial-order'
import { useNumberDial } from '@/hooks/use-number-dial'
import { useBatchKeyboard } from '@/hooks/use-batch-keyboard'
import { createCustomSiteId, normalizeCustomSiteHref } from '@/lib/modular/custom-site-input'
import { useToast } from '@/components/ui/use-toast'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { pinSiteToWorkbench } from '@/lib/modular/workbench-bridge'
import { pushGlobalUndo } from '@/lib/undo-stack'
import {
  buildHomeBatchAddUndoEntry,
  buildHomeBatchPinUndoEntry,
  buildHomeBatchRemoveUndoEntry,
} from '@/lib/home-batch-undo'
import { buildBatchPinToast } from '@/lib/batch-pin-toast'
import type { LocalFavorite } from '@/hooks/useFavorites'

interface DirectoryLink {
  id: string
  /** URL 标识（slug；历史行没 slug 时是 id） */
  slug: string
  title: string
  count: number
}

interface NavigationContentProps {
  navigationData: NavigationData
  siteData: SiteConfig
  /** 服务端生成的达标分类入口（首页目录带）；中枢失败时为空数组 */
  directoryLinks?: DirectoryLink[]
  /**
   * 每组首屏渲染的卡片数（超出部分点「展开全部」客户端揭示）。
   * 由服务端按 NAVHUB_HOME_CARDS_PER_GROUP 注入；<=0 表示不限制。
   */
  cardsPerGroup?: number
  /**
   * 首页首屏渲染的分类数上限（超出部分在客户端挂载后即时渲染）。
   * 由服务端按 NAVHUB_HOME_INITIAL_SSR_CATEGORIES 注入；<=0 表示不限制。
   */
  initialCategoryLimit?: number
  /**
   * 服务端从 `nav_view_mode` Cookie 解析出的初始网址展示模式（Zero-CLS SSR 渲染）。
   */
  initialCardDisplayMode?: CanonicalCardDisplayMode
  /**
   * 影院区首屏初始数据（page.tsx 传给短剧微胶囊 + 迷你剧场小窗）
   */
  cinemaInitial?: CinemaInitialData
  /** 插件精选微胶囊与小窗数据 */
  pluginItems?: HubPluginItem[] | null
  /** 顶栏「📅 今日」角标摘要 */
  todayBadge?: HomeTodayBadgeSummary
}

/**
 * 首屏立即挂载的分类数（2026-11-08 深度扫描 P0-1）。
 *
 * 其余分类交给 LazyMountSection 视口触发——水合后一次性挂载全部分类会把
 * 首页撑到 42,803 个 DOM 节点（Lighthouse 阈值 3,000）。
 * 注意这只影响「客户端第二次渲染」：服务端 HTML 的卡片链接数量由
 * app/page.tsx 的 HOME_INITIAL_SSR_CATEGORIES 决定，与本常量无关。
 */
const EAGER_CATEGORY_COUNT = 2

/**
 * 子分类拖拽的落点换算（指针/键盘通用）：子分组没有自己的 droppable，
 * 落点事件的目标是父级 section；按指针 y 在同级分组里定位。
 * - 指针在某分组框内 → 该分组 + 半区（上半插前，下半插后）；
 * - 指针在间隙/分组外 → 纵向最近的分组，半区按指针相对该分组中心算。
 * 键盘拖拽的虚拟指针也在 operation.position.current 里（从手柄中心起，
 * 方向键每次移 10px / Shift+方向键 50px），同样走这条路。
 * 返回 null = 同级里没有任何已挂载的分组元素（父级折叠/未渲染）。
 */
function resolveSubDropTarget(
  siblingIds: readonly string[],
  pointerY: number,
): { targetId: string; after: boolean } | null {
  if (typeof document === 'undefined') return null
  let best: { id: string; rect: DOMRect; distance: number } | null = null
  for (const id of siblingIds) {
    const el = document.getElementById(id)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) continue
    const distance =
      pointerY < rect.top ? rect.top - pointerY : pointerY > rect.bottom ? pointerY - rect.bottom : 0
    if (!best || distance < best.distance) best = { id, rect, distance }
  }
  if (!best) return null
  return { targetId: best.id, after: pointerY >= best.rect.top + best.rect.height / 2 }
}

export function NavigationContent({
  navigationData,
  siteData,
  directoryLinks = [],
  cardsPerGroup = 0,
  initialCategoryLimit = 0,
  initialCardDisplayMode,
  cinemaInitial,
  pluginItems = null,
  todayBadge,
}: NavigationContentProps) {
  const ssrCardDisplayMode = normalizeCardDisplayMode(initialCardDisplayMode)
  const isMobileViewport = useIsMobileViewport()
  const { toast } = useToast()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  // 2026-11-25 左侧分类点击直达聚焦：点哪个分类就直接完整展示该分类全部子分类与全部站点（不截断折叠），
  // 同时自动收起首页顶部无关窗口（工作区切换 + 高频直达坞），按需通过下拉按钮展开显示。
  const [focusedCategoryId, setFocusedCategoryId] = useState<string | null>(null)
  const [focusedSubCategoryId, setFocusedSubCategoryId] = useState<string | null>(null)
  const [focusedQuickDrawerOpen, setFocusedQuickDrawerOpen] = useState(false)
  const focusedQuickDrawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  // P1-5：移动抽屉闭合时不挂载 Sidebar（省一份完整分类树）。
  // 抽屉容器本身常驻 DOM（useOverlayBehavior 需要稳定节点做焦点圈养），
  // 但其内的 Sidebar 只在打开时挂载；关闭后延迟 200ms 卸载，
  // 与面板的 translate-x-full 关闭动画（duration-[--duration-base]，即 200ms）对齐，避免空面板滑出。
  const [drawerSidebarMounted, setDrawerSidebarMounted] = useState(false)
  useEffect(() => {
    if (isSidebarOpen) {
      setDrawerSidebarMounted(true)
      return
    }
    const t = setTimeout(() => setDrawerSidebarMounted(false), 200)
    return () => clearTimeout(t)
  }, [isSidebarOpen])
  const [todayOpen, setTodayOpen] = useState(false)
  const [todayTab, setTodayTab] = useState<TodayCenterTab>('focus')
  const [widgetBoxOpen, setWidgetBoxOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [appearanceTab, setAppearanceTab] = useState<'appearance' | 'guide'>('appearance')
  const [toolbarAiOpen, setToolbarAiOpen] = useState(false)
  const [toolbarAiMode, setToolbarAiMode] = useState<'ai' | 'similar'>('ai')
  const [toolbarAiQuery, setToolbarAiQuery] = useState('')
  /* 顶栏铃铛红点（2026-11-21 顶栏收敛）：与侧栏通知铃共用同一个订阅源，
     没有第二份轮询。eligibility 交给 useIdentityReady，匿名/未登录时不请求。 */
  const identityState = useIdentityReady()
  const unreadNotifications = useUnreadNotifications(identityState)
  const [sceneParam, setSceneParam] = useState<string | null>(null)
  const { mounted: pinnedMounted, pinned: pinnedCornerWidgets } = usePinnedCornerWidgets()

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const sc = sp.get('scene')
      if (sc) setSceneParam(sc)

      // 成长任务跨页语义微引导：识别 ?from=growth_task 参数后执行聚焦搜索框或高亮未访问分类，
      // 随后用 history.replaceState 清理 URL 参数，不污染历史记录。
      if (sp.get('from') === 'growth_task') {
        const focusTarget = sp.get('focus')
        const hint = sp.get('hint')
        const highlight = sp.get('highlight')

        if (focusTarget === 'search') {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('navhub:focus-search', {
                detail: { ai: hint === 'ai' },
              }),
            )
            const input = document.querySelector<HTMLInputElement>(
              'input[type="search"], input[placeholder*="搜索"]',
            )
            if (input) {
              input.focus({ preventScroll: false })
            }
          }, 260)
          toast({
            title: hint === 'ai' ? '✨ 已为你定位到 AI 智能搜索' : '🔍 已为你聚焦搜索框',
            description: '输入任意关键词或需求即可自动完成成长任务进度。',
          })
        } else if (highlight === 'unvisited_category' || highlight === 'explore_sites' || highlight === 'favorite_site') {
          window.setTimeout(() => {
            const sections = Array.from(document.querySelectorAll<HTMLElement>('section[id]'))
            const targetSection =
              highlight === 'unvisited_category' && sections.length > 1
                ? sections[1]
                : sections[0]
            if (targetSection) {
              targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
              targetSection.classList.add('ring-2', 'ring-amber-500/60', 'ring-offset-4', 'rounded-2xl', 'transition-all')
              window.setTimeout(() => {
                targetSection.classList.remove('ring-2', 'ring-amber-500/60', 'ring-offset-4', 'rounded-2xl')
              }, 2200)
            }
          }, 280)
          toast({
            title:
              highlight === 'unvisited_category'
                ? '🧭 已为你定位到待探索分类'
                : highlight === 'favorite_site'
                  ? '⭐ 点击任意卡片右上角星标即可收藏'
                  : '✨ 点开任意站点卡片即可累计成长进度',
            description: '完成动作后成长任务会自动同步入账。',
          })
        }

        // 清理成长任务引导 query 参数，避免刷新重复触发
        try {
          const cleanUrl = new URL(window.location.href)
          cleanUrl.searchParams.delete('from')
          cleanUrl.searchParams.delete('focus')
          cleanUrl.searchParams.delete('hint')
          cleanUrl.searchParams.delete('highlight')
          window.history.replaceState(
            window.history.state,
            '',
            cleanUrl.pathname + cleanUrl.search + cleanUrl.hash,
          )
        } catch {
          // 忽略 history 限制
        }
      }
    } catch {
      // 忽略异常 URL 查询参数解析
    }
  }, [toast])
  // 抽屉的公共行为：Esc 关、点遮罩关、锁背景滚动、焦点圈养与还原、role=dialog
  const { containerProps, scrimProps } = useOverlayBehavior({
    open: isSidebarOpen,
    onClose: () => setIsSidebarOpen(false),
    // 抽屉常驻 DOM，读屏需要一个稳定名称来说明「这是分类导航」
    ariaLabel: '分类导航抽屉',
  })
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('all')
  const [isToolsOpen, setIsToolsOpen] = useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  /**
   * 速览弹窗的上下文：除了站点本身，还要记住它来自哪个分类——
   * 弹窗里的「置顶」需要 categoryId 才能落到正确的分类。
   */
  const [peek, setPeek] = useState<{ item: NavigationSubItem; categoryId?: string } | null>(null)
  /** 打开速览前的焦点：关闭弹窗后必须还回去，否则键盘用户被丢回页面顶部 */
  const peekReturnFocusRef = useRef<{ el: HTMLElement | null; siteId: string | null }>({
    el: null,
    siteId: null,
  })
  const openPeek = useCallback((item: NavigationSubItem | null, categoryId?: string) => {
    const active = document.activeElement as HTMLElement | null
    // 只存节点不够：速览打开会让卡片列表重渲染、主链接 DOM 节点被替换，
    // 关闭时旧节点已不在文档里（document.contains 为 false），焦点就丢到 body。
    // 因此同时记下站点 id，归还时按 id 重新找当前节点。
    peekReturnFocusRef.current = { el: active, siteId: item?.id ?? null }
    setPeek(item ? { item, categoryId } : null)
  }, [])
  const restorePeekFocus = useCallback(() => {
    const { el, siteId } = peekReturnFocusRef.current
    peekReturnFocusRef.current = { el: null, siteId: null }
    // 弹窗卸载是异步的，焦点归还要等一帧，否则会被 Radix 的卸载流程覆盖
    requestAnimationFrame(() => {
      if (el && document.contains(el)) {
        el.focus()
        return
      }
      if (siteId) {
        const link = document.querySelector(
          `[data-navhub-site-id="${CSS.escape(siteId)}"] a[data-prefetch-target]`,
        ) as HTMLElement | null
        link?.focus()
      }
    })
  }, [])

  // 添加自定义网址到专属分类状态
  const [addSiteTargetCatId, setAddSiteTargetCatId] = useState<string | null>(null)
  const [customSiteTitle, setCustomSiteTitle] = useState('')
  const [customSiteHref, setCustomSiteHref] = useState('')
  const [customSiteDesc, setCustomSiteDesc] = useState('')

  const {
    mounted,
    config: homeDiyConfig,
    viewMode,
    cardDisplayMode,
    canvasBackground,
    categoryOrder,
    pinnedCategoryIds,
    hiddenCategoryIds,
    collapsedCategoryIds,
    collapseAllCategories,
    expandAllCategories,
    expandCategory,
    setCollapsedCategoryIds,
    customCategories,
    addSiteToCustomCategory,
    addSitesToCustomCategory,
    removeSitesFromCustomCategories,
    siteCategoryOverrides,
    pinnedSiteIdsByCategory,
    togglePinSiteInCategory,
    reorderCategory,
    customWallpaperUrl,
    glassmorphismBlur,
    cardOpacity,
    isEditingLayout,
    setIsEditingLayout,
    unhideCategory,
    unhideAllCategories,
    speedDialPinnedIds,
    quickDialSlots,
    workspaceLayoutV2,
    activeDragLayer,
    setActiveDragLayer,
    outlineMode,
    selectedBlockId,
    setSelectedBlockId,
    commitWorkspaceBreakpointLayout,
    updateWorkspaceBlock,
    syncBlockAutoHeight,
    trashWorkspaceBlock,
  } = useHomeDIY(ssrCardDisplayMode)
  const [activeBentoBreakpoint, setActiveBentoBreakpoint] = useState<WorkspaceBreakpointKey>('lg')

  const activeCardDisplayMode = mounted
    ? normalizeCardDisplayMode(cardDisplayMode)
    : ssrCardDisplayMode
  const effectiveCardDisplayMode = mounted
    ? resolveEffectiveViewMode(activeCardDisplayMode, isMobileViewport)
    : activeCardDisplayMode

  const {
    hiddenCategories: maskHiddenCategories,
    trashBin,
    totalPrunedCount,
    bypassMaskTemporarily,
    isModuleHidden,
    isFeatureHidden,
    removeFeature,
    undoLastRemove,
    restoreAll,
    restoreFeature,
    setBypassMaskTemporarily,
  } = useFeatureMask()

  // 全站配置（后台「站点设置」）：功能开关 + 首页板块顺序。siteData 是上游
  // SiteConfig 形状，用客户端安全的 normalizeSettings 收口（脏值回退默认全开）。
  const homeControl = useMemo(() => normalizeSettings(siteData as unknown), [siteData])
  // 个人隐藏（账号级偏好，登录后同步到本机）：全站开启之上再叠一层，
  // 个人设置优先于全站默认。水合后再读本机值，避免 SSR/CSR 首帧不一致。
  const [personalHidden, setPersonalHidden] = useState<ReadonlySet<FeatureKey>>(new Set())
  useEffect(() => {
    setPersonalHidden(new Set(readLocalHiddenHomeModules()))
  }, [])
  const sectionOn = useCallback(
    (key: FeatureKey) => homeControl.features[key] && !personalHidden.has(key),
    [homeControl, personalHidden],
  )

  // 1. 场景工作台动态过滤（纯函数见 lib/modular/workspace-matching.ts，判定有单测）
  const filteredNavigationItems = useMemo(
    () => filterNavigationByWorkspace(navigationData.navigationItems, activeWorkspace),
    [navigationData.navigationItems, activeWorkspace],
  )

  // 2. 自定义专属分类 → 导航形状 + 合并/重映射/隐藏/排序
  //    （纯函数见 lib/modular/category-combine.ts）
  const customAsCategories = useMemo(
    () => customCategoriesToNavigation(customCategories),
    [customCategories],
  )

  const effectiveHiddenCategoryIds = useMemo(() => {
    if (isEditingLayout || bypassMaskTemporarily) return []
    const merged = new Set<string>(hiddenCategoryIds)
    for (const item of maskHiddenCategories) {
      merged.add(stripFeaturePrefix(item))
    }
    return Array.from(merged)
  }, [isEditingLayout, bypassMaskTemporarily, hiddenCategoryIds, maskHiddenCategories])

  const { allCategoryIds, categoryTitleMap, sortedCategories } = useMemo(
    () =>
      combineAndSortCategories({
        custom: customAsCategories,
        navigation: filteredNavigationItems,
        siteCategoryOverrides,
        hiddenCategoryIds: effectiveHiddenCategoryIds,
        pinnedCategoryIds,
        categoryOrder,
      }),
    [customAsCategories, filteredNavigationItems, effectiveHiddenCategoryIds, pinnedCategoryIds, categoryOrder, siteCategoryOverrides],
  )

  // 空态是否由「全部分类被隐藏」造成（W2-10）：渲染列表为空，且每个分类
  // 都在两份隐藏账本（DIY / 掩码，掩码 id 带 cat: 前缀，先剥掉）里。
  // 编辑态与临时绕过掩码时隐藏分类本来就显示，空态不可能是隐藏造成的，
  // 直接排除——别在那时把「恢复隐藏分类」当成工作区筛选无结果的解法。
  const allCategoriesHidden = useMemo(() => {
    if (isEditingLayout || bypassMaskTemporarily) return false
    if (sortedCategories.length !== 0 || allCategoryIds.length === 0) return false
    const hidden = new Set<string>(hiddenCategoryIds)
    for (const id of maskHiddenCategories) hidden.add(stripFeaturePrefix(id))
    return allCategoryIds.every((id) => hidden.has(id))
  }, [isEditingLayout, bypassMaskTemporarily, sortedCategories.length, allCategoryIds, hiddenCategoryIds, maskHiddenCategories])

  // dnd-kit 重型层（~133KB）：仅在进入 DIY 排版编辑态时按需动态加载，
  // 彻底消除普通浏览态首屏水合后的后台大包下载与跨区块 setDragKit 重渲染。
  type DiyDragKitModule = typeof import('@/components/diy/diy-drag-kit')
  const [dragKit, setDragKit] = useState<DiyDragKitModule | null>(null)
  useEffect(() => {
    if (!isEditingLayout || dragKit) return
    let cancelled = false
    import('@/components/diy/diy-drag-kit')
      .then((mod) => {
        if (!cancelled) setDragKit(mod)
      })
      .catch(() => {
        // 拖拽库加载失败：菜单仍可用，不弹错打扰用户
      })
    return () => {
      cancelled = true
    }
  }, [isEditingLayout, dragKit])

  // 子分类 → 父分类查找表（子分类拖拽用）：同父校验与同级列表都从这里取。
  // sortedCategories 里的 subCategories 含被隐藏的子分类——拖拽只认
  // 已挂载的分组（指针定位时 getElementById 找不到未渲染的），多出来的
  // id 只占 flat order 里的一个位置，不影响可见同级的相对顺序。
  const subCategoryParents = useMemo(() => {
    const map = new Map<string, { parentId: string; siblingIds: string[] }>()
    for (const cat of sortedCategories) {
      const subs = (cat.subCategories || []) as Array<{ id: string }>
      if (subs.length === 0) continue
      const siblingIds = subs.map((s) => s.id)
      for (const sub of subs) {
        map.set(sub.id, { parentId: cat.id, siblingIds })
      }
    }
    return map
  }, [sortedCategories])

  // 分类拖拽落点：provider 的 onDragEnd 先于内置卡片处理调用；只处理
  // category→category，卡片落点走内置逻辑。目标 id 不在列表里时不动
  // （moveCategoryToIndex 会把 -1 夹到 0 误插到顶部，所以这里先拦住）。
  //
  // 落点按指针在目标内的上下半区算（W2-7）：上半区插到目标之前，下半区
  // 插到目标之后——旧实现直接拿目标序号当插入序号，先移除再插入让同一
  // 个落点在上移时等于「之前」、下移时等于「之后」。指针位置取
  // operation.position.current（dnd-kit 的指针客户端坐标）；键盘拖拽
  // 没有指针（activator 是键盘事件），afterTarget 不传，沿用旧语义。
  // 目标元素取 droppable 的 element，拿不到时按 id 查 section（两处
  // 渲染都给了 id={category.id}）。
  //
  // 子分类拖拽（同父内重排）：源是子分类手柄（DiyCategoryDragGrip，
  // data 与顶级同一格式），落点是父级 section 的 droppable——子分组
  // 没有自己的 droppable（注册了会让卡片拖到子分组上也被重归类到子分
  // 类 id，combineAndSortCategories 不消费它，卡片直接消失；见
  // navigation-category-section 二级分类处的注释）。所以这里用指针
  // 在同级分组里的位置定位目标子分组（resolveSubDropTarget）：键盘
  // 拖拽的虚拟指针也在 operation.position.current 里，同样走这条路；
  // 半区规则与顶级一致，键盘没有指针半区时按移动方向落远端。跨父 /
  // 与顶级互拖一律忽略。
  const { moveCategoryToIndex } = useHomeDiyGrid(allCategoryIds)
  const handleCategoryDragEnd = useCallback(
    (event: DragEndEvent) => {
      const source = readDiyDragData(event.operation.source)
      const target = readDiyDragData(event.operation.target)
      if (event.canceled || source?.kind !== 'category' || target?.kind !== 'category') return
      let afterTarget: boolean | undefined
      const activator = event.operation.activatorEvent
      const isPointerDrag = typeof PointerEvent !== 'undefined' && activator instanceof PointerEvent
      const pointerY = event.operation.position?.current?.y
      if (isPointerDrag) {
        const targetEl =
          event.operation.target?.element ??
          (typeof document !== 'undefined' ? document.getElementById(target.categoryId) : null)
        if (typeof pointerY === 'number' && targetEl) {
          const rect = targetEl.getBoundingClientRect()
          if (rect.height > 0) {
            afterTarget = pointerY >= rect.top + rect.height / 2
          }
        }
      }

      // 子分类：只在同一父分类内重排；跨父、与顶级互拖一律不动。
      const sourceSub = subCategoryParents.get(source.categoryId)
      const targetSub = subCategoryParents.get(target.categoryId)
      if (sourceSub || targetSub) {
        if (!sourceSub || !targetSub || sourceSub.parentId !== targetSub.parentId) return
        const siblingIds = sourceSub.siblingIds
        const fromIndex = siblingIds.indexOf(source.categoryId)
        if (fromIndex === -1 || typeof pointerY !== 'number') return
        const resolved = resolveSubDropTarget(siblingIds, pointerY)
        if (!resolved) return
        if (resolved.targetId === source.categoryId) return
        const targetIndex = siblingIds.indexOf(resolved.targetId)
        if (targetIndex === -1) return
        // 指针拖拽用半区；键盘拖拽按移动方向落远端（与顶级旧语义一致）。
        const after = isPointerDrag ? resolved.after : fromIndex < targetIndex
        reorderCategory(source.categoryId, resolved.targetId, after ? 'after' : 'before', siblingIds)
        return
      }

      const toIndex = allCategoryIds.indexOf(target.categoryId)
      if (toIndex === -1) return
      moveCategoryToIndex(source.categoryId, toIndex, afterTarget)
    },
    [allCategoryIds, moveCategoryToIndex, reorderCategory, subCategoryParents],
  )

  // 双向同步传统分类隐藏列表与增量掩码回收站
  useEffect(() => {
    syncHiddenCategoriesFromDIY(hiddenCategoryIds, categoryTitleMap)
  }, [hiddenCategoryIds, categoryTitleMap])

  const handleUndoPrune = useCallback(() => {
    const restored = undoLastRemove()
    if (restored) {
      if (restored.level === 'L2_CATEGORY') {
        unhideCategory(stripFeaturePrefix(restored.id))
      }
      toast({
        title: `↩ 已撤销移除「${restored.title}」`,
        description: '该模块/分类已无损还原至原位。',
      })
    }
  }, [undoLastRemove, unhideCategory, toast])

  // 空态恢复（W2-10）：「所有分类都被隐藏」时只切工作区救不回来——
  // 隐藏有两份账本（DIY hiddenCategoryIds + 掩码 hiddenCategories），
  // 这里两份一起清，再切回全部工作区；不同步等 effect，显式清干净。
  const handleRecoverHiddenCategories = useCallback(() => {
    for (const id of maskHiddenCategories) {
      restoreFeature(id)
    }
    unhideAllCategories()
    setActiveWorkspace('all')
    toast({
      title: '已恢复全部隐藏分类',
      description: '所有被隐藏的分类都已恢复显示。',
    })
  }, [maskHiddenCategories, restoreFeature, unhideAllCategories, setActiveWorkspace, toast])

  const handleOpenRecoveryCenter = useCallback(() => {
    setIsEditingLayout(true)
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('navhub:open-recovery-center', { detail: { tab: 'trash' } }))
      }
    }, 80)
  }, [setIsEditingLayout])

  // 全局 Ctrl/Cmd+Z 撤销监听：已收敛到 hooks/use-global-undo（Providers 里
  // 只挂一次）。这里不再挂 window keydown——旧监听与画布/排版的监听各
  // 自判定"输入框"，一次按键会撤两步。handleUndoPrune 留给回收站按钮用，
  // 分发时全局 hook 直接调 undoLastFeatureRemove + 分类双写。

  const handleWorkspaceChange = useCallback((nextWorkspace: WorkspaceId) => {
    setFocusedQuickDrawerOpen(false)
    setFocusedCategoryId(null)
    setFocusedSubCategoryId(null)
    setActiveWorkspace(nextWorkspace)
    if (nextWorkspace === 'all') {
      expandAllCategories()
    } else {
      const matchedCats = filterNavigationByWorkspace(navigationData.navigationItems, nextWorkspace)
      const matchedCatIds = new Set(matchedCats.map((c) => c.id))
      const allIds = navigationData.navigationItems.map((c) => c.id)
      const toCollapse = allIds.filter((id) => !matchedCatIds.has(id))
      setCollapsedCategoryIds(toCollapse)
    }
  }, [expandAllCategories, setCollapsedCategoryIds, navigationData.navigationItems])

  const handleSelectSidebarCategory = useCallback(
    (categoryId: string | null, subCategoryId?: string | null) => {
      // 点击/切换任何分类时，自动收起所有无关窗口（顶部快捷面板、今日中心、工具箱、外观面板、AI小窗、速览等）
      setFocusedQuickDrawerOpen(false)
      setTodayOpen(false)
      setWidgetBoxOpen(false)
      setAppearanceOpen(false)
      setToolbarAiOpen(false)
      setIsToolsOpen(false)
      setIsShortcutsOpen(false)
      setPeek(null)

      if (!categoryId) {
        startTransition(() => {
          setFocusedCategoryId(null)
          setFocusedSubCategoryId(null)
        })
        return
      }
      expandCategory(categoryId)
      startTransition(() => {
        setFocusedCategoryId(categoryId)
        setFocusedSubCategoryId(subCategoryId ?? null)
      })
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: preferredScrollBehavior() })
      }
    },
    [expandCategory],
  )

  const handleClearFocusedCategory = useCallback(() => {
    setFocusedQuickDrawerOpen(false)
    setFocusedCategoryId(null)
    setFocusedSubCategoryId(null)
  }, [])

  const handleFocusedSubCategoryChange = useCallback((subId: string | null) => {
    setFocusedSubCategoryId(subId)
  }, [])

  const handleToggleFocusedQuickDrawer = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    focusedQuickDrawerTriggerRef.current = event.currentTarget
    setFocusedQuickDrawerOpen((prev) => !prev)
  }, [])

  // 快捷抽屉关闭提交后，Drawer 内的焦点节点才会卸载；等一帧再把焦点还给触发钮。
  useEffect(() => {
    if (focusedQuickDrawerOpen) return
    const trigger = focusedQuickDrawerTriggerRef.current
    if (!trigger) return
    const frame = window.requestAnimationFrame(() => {
      focusedQuickDrawerTriggerRef.current = null
      if (document.contains(trigger)) trigger.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusedQuickDrawerOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      const inEditable = Boolean(
        active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable),
      )
      if (e.key === 'Escape' && focusedQuickDrawerOpen && !inEditable) {
        setFocusedQuickDrawerOpen(false)
        return
      }
      // 分类聚焦态顶栏收起时，按 / 或 Ctrl/Cmd+K 自动下拉展开顶栏并聚焦搜索框
      if (
        focusedCategoryId &&
        !focusedQuickDrawerOpen &&
        !inEditable &&
        ((e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) ||
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))
      ) {
        e.preventDefault()
        setFocusedQuickDrawerOpen(true)
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('navhub:focus-search'))
        }, 90)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedCategoryId, focusedQuickDrawerOpen])

  /**
   * P0-2：工具栏 7 个打开/切换回调全部 useCallback 化——它们传给 memo 的
   * NavigationToolbar（onOpenTools 与 HalfScreenDock 共用），内联写法每轮
   * 新建身份会让工具栏 memo 恒失效。setX 均为 React 稳定 setter，空依赖即可。
   * handleCloseSidebar 同理服务 memo 的 Sidebar（onClose）。
   */
  const handleToggleSidebar = useCallback(() => setIsSidebarOpen((open) => !open), [])
  const handleCloseSidebar = useCallback(() => setIsSidebarOpen(false), [])
  const handleOpenTools = useCallback(() => setIsToolsOpen(true), [])
  const handleOpenShortcuts = useCallback(() => setIsShortcutsOpen(true), [])
  const handleOpenTodayCenter = useCallback(() => {
    setTodayTab('focus')
    setTodayOpen(true)
  }, [])
  const handleOpenWidgetBox = useCallback(() => {
    setTodayTab('widgets')
    setTodayOpen(true)
  }, [])
  const handleOpenAppearanceGuide = useCallback(() => {
    setAppearanceTab('appearance')
    setAppearanceOpen(true)
  }, [])
  const handleOpenAiFinder = useCallback((mode?: 'ai' | 'similar', initialQuery?: string) => {
    setToolbarAiMode(mode ?? 'ai')
    setToolbarAiQuery(initialQuery ?? '')
    setToolbarAiOpen(true)
  }, [])

  /**
   * P0-2：Sidebar 的 navigationData 对象字面量每轮新建会击穿 memo，
   * 在此 memo 化（sortedCategories 本身已是 useMemo，身份稳定）。
   */
  const sidebarNavigationData = useMemo(
    () => ({ navigationItems: sortedCategories as unknown as NavigationItem[] }),
    [sortedCategories]
  )

  // 我的场景接线：① 把全站站点→分类索引登记到场景注册表（置顶派生用，
  //    用未经过滤的原始分类建，置顶站点所在分类被隐藏/折叠也要能解析）；
  //    ② 监听场景切换派发的 workspace 事件，走上面同一条 handleWorkspaceChange。
  useEffect(() => {
    registerSceneSiteIndex(
      buildSceneSiteIndex(navigationData.navigationItems, customCategories),
    )
  }, [navigationData.navigationItems, customCategories])
  useEffect(() => {
    const onSceneWorkspace = (event: Event) => {
      const filter = (event as CustomEvent<{ filter?: string }>).detail?.filter
      if (filter === 'all' || filter === 'dev' || filter === 'design' || filter === 'ai' || filter === 'efficiency') {
        handleWorkspaceChange(filter)
      }
    }
    window.addEventListener(SCENE_WORKSPACE_CHANGE_EVENT, onSceneWorkspace)
    return () => window.removeEventListener(SCENE_WORKSPACE_CHANGE_EVENT, onSceneWorkspace)
  }, [handleWorkspaceChange])

  /**
   * 首屏分类分批渲染（首页 HTML 预算哨兵与 CWV 首屏加速）。
   * 
   * SSR / 初始水合仅渲染前 initialCategoryLimit 个分类，
   * 避免 100+ 分类、700+ 卡片把未压缩 HTML 撑到 7.5MB。
   * 客户端水合后（mounted === true）立即揭示全部分类，
   * 既保证 SSR HTML 控制在预算内（< 2MB），又保证客户端交互与滚动完整无缝。
   */
  const renderedCategories = useMemo(() => {
    const list = !isEditingLayout
      ? sortedCategories.filter((cat) => countCategorySites(cat) > 0 && cat.title !== '未分类')
      : sortedCategories
    if (mounted || !initialCategoryLimit || initialCategoryLimit <= 0) {
      return list
    }
    return list.slice(0, initialCategoryLimit)
  }, [mounted, initialCategoryLimit, sortedCategories, isEditingLayout])

  /**
   * 分类 id → 本页真正渲染出来的站点数（算式见 lib/modular/category-counts.ts）。
   *
   * 站内目录带的链接由服务端按中枢权威类目树生成，它自带的数字是中枢的 active 计数，
   * 与本页区块头的「树口径」差着坏链与快照新鲜度两件事——同屏并排就是数字打架。
   * 目录带的数字改用这份映射；`link.count` 只留给树里找不到对应分类时的回退
   * （自定义分类、被隐藏的分类）。
   */
  const treeSiteCounts = useMemo(
    () => new Map(sortedCategories.map((cat) => [cat.id, countCategorySites(cat)] as const)),
    [sortedCategories],
  )

  /* ------------------------- 多选批量操作 -------------------------
   *
   * 批量操作坞（`components/batch-operation-dock.tsx`）与批量引擎
   * （`lib/batch-operations.ts`：批量导出 / 复制成 Markdown / 置顶 /
   * 移动 / 删除）已挂载：入口是工具栏的「多选」开关（快捷键 M，
   * 见 hooks/use-batch-keyboard.ts）+ 卡片选中态 + 底部操作坞。
   *
   * 选中态本身（可见站点收集 / 剪枝 / 切换 / 全选）已抽到
   * `lib/modular/use-site-selection.ts`，组件只消费返回值。
   */
  const selectionCategories = useMemo(() => {
    const category = sortedCategories.find((item) => item.id === focusedCategoryId)
    if (!category) return sortedCategories
    if (!focusedSubCategoryId) return [category]
    if (focusedSubCategoryId === '__direct__') return [{ ...category, subCategories: [] }]
    const subCategory = category.subCategories?.find((sub) => sub.id === focusedSubCategoryId)
    if (!subCategory) return [category]
    return [{ ...category, items: [], subCategories: [subCategory] }]
  }, [sortedCategories, focusedCategoryId, focusedSubCategoryId])

  const {
    selectionMode,
    selectedIds,
    selectedSites,
    visibleSites,
    clearSelection,
    toggleSelectMode,
    toggleSelectOne,
    selectAllVisible,
  } = useSiteSelection(selectionCategories, collapsedCategoryIds)

  /* ------------------------- 首屏数字直达 -------------------------
   *
   * 映射源 = 速览坞 Top 9（computeSpeedDialSites，与坞同一份纯函数、
   * 同一份输入：visibleSites + speedDialPinnedIds + 最近访问 + 工作区）。
   * 映射由这里一个 useMemo 算出，经 props 透传给分类区 → 卡片（角标）与
   * 坞（角标），同时给 useNumberDial 用——禁止任何一方自己重算顺序。
   * visibleSites 跳过折叠分类，dialSites / siteIndex / siteTitleById 都源自它：
   * 某钉选站所在分类被折叠时，该站不在数字直达映射里，裸数字与
   * Ctrl+Shift+数字都静默无操作；角标在卡片不可见时自然不显示。
   *
   * 水合安全：映射依赖 localStorage（钉选、最近访问），SSR 与首帧一律
   * 不传 dialDigit（mounted 前传 undefined），角标只在挂载后出现；
   * 数字键监听同样只在 mounted 后才启用。
   */
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  useEffect(() => {
    let active = true
    // P2-14：窗口获焦时重读最近访问（与坞旧有的 focus 同步一致），使 dialSites
    // 随之刷新——坞不再自己重算速拨顺序，改由父级透传 dialSites，获焦刷新不能丢。
    const sync = () => {
      readOfflineVisits(20)
        .then((rows) => {
          if (active && Array.isArray(rows)) setRecentVisits(rows)
        })
        .catch(() => {
          // 降级容错：离线最近访问读取失败时映射退回「钉选 + 工作区 + 全站顺序」
        })
    }
    sync()
    window.addEventListener('focus', sync)
    return () => {
      active = false
      window.removeEventListener('focus', sync)
    }
  }, [])

  const dialSites = useMemo(
    () =>
      computeSpeedDialSites({
        allSites: visibleSites,
        speedDialPinnedIds,
        recentVisits,
        activeWorkspace,
      }),
    [visibleSites, speedDialPinnedIds, recentVisits, activeWorkspace],
  )
  const dialMap = useMemo(() => buildDialMap(dialSites), [dialSites])
  /** 全站索引：自定义快拨位解析（id → 站点）与卡片菜单的被顶掉站名都读它 */
  const siteIndex = useMemo(
    () => new Map(visibleSites.map((s) => [s.id, s] as const)),
    [visibleSites],
  )
  const siteTitleById = useMemo(
    () => new Map(visibleSites.map((s) => [s.id, s.title] as const)),
    [visibleSites],
  )
  const linkTarget = useExternalLinkTarget(siteData?.navigation?.linkTarget)
  const numberDialEnabled = useUserPreference('numberDialEnabled')
  useNumberDial({
    enabled: mounted && numberDialEnabled,
    dialSites,
    quickDialSlots,
    siteIndex,
    linkTarget,
    selectionMode,
    editingLayout: isEditingLayout,
  })

  /* ------------------------- 批量键盘（M / P / E / F / Esc 等） -------------------------
   *
   * 判定全在 lib/batch-keyboard.ts 的纯函数里，这里只接线已有的批量能力。
   * E / Shift+E 的导出复用坞里同一份逻辑（batch-operation-dock.tsx 的
   * handleCopyMarkdown / handleDownloadMarkdown），坞不暴露回调，这里镜像一份，
   * 文案与文件名与坞保持一致；P 的固定回调抽成具名函数，坞与键盘共用同一份。
   * 首页 Delete/Backspace 在多选态走批量移除（11b 已补撤销，见 lib/batch-keyboard.ts
   * 文件头）：纯函数返回 batch-remove，卡片级 handleKeyDown 不拦冒泡，
   * window 层 useBatchKeyboard 经 onBatchRemove 分发到这里。
   * 三个批量处理器都是单提交（批量版 API 一次 persistConfig），处理器里
   * 不得再出现逐站提交的循环；每批至多推一条全局撤销条目。
   */
  const handleBatchPinToWorkbench = () => {
    // pinSiteToWorkbench 是单站 API（每调一次返回本站的收据）；
    // 批量固定把各站收据聚合成一份 BatchPinReceipt，整批只推一条撤销条目
    // （设计 §2.1：每批独立一条），逆操作只删本次新建的收藏条目，dock 留下。
    const addedSiteIds: string[] = []
    const addedItems: LocalFavorite[] = []
    let createdDockWidgetId: string | null = null
    // newlyPinned 只计本次新建的站；alreadyPinned 计 ok 但未新加的站
    // （pinSiteToWorkbench 对已固定过的站也返回 ok，见 workbench-bridge）。
    // toast 必须按这两数如实报，不能把 ok 数当新增数。
    let newlyPinned = 0
    let alreadyPinned = 0
    for (const site of selectedSites) {
      if (!isSafeSiteHref(site.href)) continue
      const res = pinSiteToWorkbench({
        siteId: site.id,
        title: site.title,
        href: site.href,
        icon: site.icon,
        description: site.description,
      })
      if (!res.ok) continue
      if (res.receipt) {
        if (res.receipt.addedSiteIds.length > 0) {
          newlyPinned++
          addedSiteIds.push(...res.receipt.addedSiteIds)
          addedItems.push(...res.receipt.addedItems)
        } else {
          alreadyPinned++
        }
        if (createdDockWidgetId === null) createdDockWidgetId = res.receipt.createdDockWidgetId
      }
    }
    if (addedSiteIds.length > 0) {
      const entry = buildHomeBatchPinUndoEntry({
        addedSiteIds,
        addedItems,
        createdDockWidgetId,
        // pinnedCount 是 ok 的站数（收据约定，见 BatchPinReceipt）：
        // 新建 + 已在 = 本批 ok 总数。
        pinnedCount: newlyPinned + alreadyPinned,
      })
      if (entry) pushGlobalUndo(entry)
    }
    toast(buildBatchPinToast(newlyPinned, alreadyPinned))
  }

  const handleBatchAddToCustomCategory = (categoryId: string) => {
    const usable = selectedSites.filter((site) => isSafeSiteHref(site.href))
    if (usable.length === 0) {
      toast({ title: '⚠️ 没有可收录的站点', description: '选中的站点网址不合法。' })
      return
    }
    const receipt = addSitesToCustomCategory(
      categoryId,
      usable.map((site) => ({
        title: site.title,
        href: site.href,
        description: site.description,
      })),
    )
    // 写盘失败时收据的 addedCount 已清零（failedCount 计命中数），
    // builder 同样返回 null：天然不推撤销条目，不再加别的判断。
    if (receipt.addedCount > 0) {
      const entry = buildHomeBatchAddUndoEntry(receipt)
      if (entry) pushGlobalUndo(entry)
    }
    // 批量路径同样不能只说好话：失败与重复要如实计数
    if (receipt.failedCount > 0) {
      toast({
        title: `只收录了 ${receipt.addedCount} 个`,
        description: `${receipt.failedCount} 个没能写入本地存储（隐私模式或空间已满），刷新后会丢失；${receipt.duplicateCount} 个已在分类中。`,
        variant: 'destructive',
      })
    } else if (receipt.duplicateCount > 0) {
      toast({
        title: `已收录 ${receipt.addedCount} 个站点`,
        description: `另有 ${receipt.duplicateCount} 个已在所选分类中，未重复添加。`,
      })
    } else {
      toast({
        title: '✨ 已收录 ' + receipt.addedCount + ' 个站点',
        description: '已批量加入所选专属分类。',
      })
    }
    clearSelection()
  }

  const handleBatchRemoveFromCustomCategories = () => {
    // 只处理「自定义分类里的卡片」：这些是用户自建的本地条目，删了能重建；
    // 内置站点库的条目不在这个作用域里（那是回收站/管理端的职责）。
    const receipt = removeSitesFromCustomCategories(selectedSites.map((site) => site.id))
    if (receipt.removedCount > 0) {
      const entry = buildHomeBatchRemoveUndoEntry(receipt)
      if (entry) pushGlobalUndo(entry)
    }
    if (receipt.failedCount > 0) {
      toast({
        title: `只移除了 ${receipt.removedCount} 个站点`,
        description: `${receipt.failedCount} 个没能写入本地存储（隐私模式或空间已满），刷新后会丢失。`,
        variant: 'destructive',
      })
    } else {
      toast(
        receipt.removedCount > 0
          ? { title: '🗑️ 已移除 ' + receipt.removedCount + ' 个站点', description: '仅从你的专属分类中移除，站点库本身不受影响。' }
          : { title: '⚠️ 没有可移除的站点', description: '所选站点都不在自定义分类里。' },
      )
    }
    // 删掉的站已不在分类里，选中态随之清空（与收录后清空同款）；
    // 否则坞还挂着一批已不存在的选中，第二次 Delete 只会空转报错。
    clearSelection()
  }

  const handleBatchCopyMarkdown = async () => {
    const count = selectedSites.length
    if (count === 0) {
      toast({ title: '请先选中站点', description: '按 E 之前，先用 Tab + 空格选中至少一张卡片。' })
      return
    }
    try {
      const md = batchExportSitesToMarkdown(selectedSites, {
        categoryTitle: `山羊胡批量导读书签 (${count}项)`,
      })
      const result = await copyText(md)
      if (!result.ok) throw new Error(result.reason)
      toast({
        title: '📋 Markdown 已复制',
        description: `已成功将 ${count} 个站点的 Markdown 清单写入系统剪贴板。`,
      })
    } catch {
      toast({
        title: '复制失败',
        description: '请检查浏览器剪贴板写入权限。',
        variant: 'destructive',
      })
    }
  }

  const handleBatchDownloadMarkdown = () => {
    const count = selectedSites.length
    if (count === 0) {
      toast({ title: '请先选中站点', description: '按 Shift+E 之前，先用 Tab + 空格选中至少一张卡片。' })
      return
    }
    const md = batchExportSitesToMarkdown(selectedSites, {
      categoryTitle: `山羊胡批量导读书签 (${count}项)`,
    })
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `navhub-export-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast({
      title: '📥 Markdown 文件已下载',
      description: `已保存 ${count} 个站点到本地文件。`,
    })
  }

  const focusBatchMoveTarget = () => {
    if (selectedSites.length === 0) {
      toast({ title: '请先选中站点', description: '按 F 之前，先用 Tab + 空格选中至少一张卡片。' })
      return
    }
    const el = document.querySelector<HTMLElement>('[data-batch-move-target]')
    if (el) {
      el.focus()
      return
    }
    toast({ title: '没有可收录的分类', description: '先在 DIY 里新建一个专属分类，再用 F 聚焦收录。' })
  }

  useBatchKeyboard({
    surface: 'home',
    inBatchMode: selectionMode,
    hasSelection: selectedIds.length > 0,
    editingLayout: isEditingLayout,
    enabled: mounted,
    callbacks: {
      onToggleMode: toggleSelectMode,
      onClearSelection: clearSelection,
      // exit-mode 只在模式内发出，此时 toggle 即退出并清空选中。
      onExitMode: toggleSelectMode,
      onToggleFocused: toggleSelectOne,
      onSelectAllVisible: selectAllVisible,
      onPin: handleBatchPinToWorkbench,
      onBatchRemove: handleBatchRemoveFromCustomCategories,
      onExportMarkdown: handleBatchCopyMarkdown,
      onDownloadMarkdown: handleBatchDownloadMarkdown,
      onFocusMoveTarget: focusBatchMoveTarget,
    },
  })

  // 4. 画布背景类名
  const canvasBgClass = useMemo(() => {
    switch (canvasBackground) {
      case 'dots':
        return 'canvas-bg-dots'
      case 'grid':
        return 'canvas-bg-grid'
      case 'aurora':
        return 'canvas-bg-aurora'
      case 'clean':
        return 'canvas-bg-clean'
      case 'mesh':
      default:
        return 'subtle-mesh canvas-bg-mesh'
    }
  }, [canvasBackground])

  // 5. 根据多态卡片选择自适应网格列数（走统一容器查询 token + <640px 自动降级）
  const gridColumnsClass = useMemo(
    () => getGridClassForCardMode(effectiveCardDisplayMode, 12),
    [effectiveCardDisplayMode],
  )

  // 提交添加自定义站点
  const handleAddCustomSiteSubmit = () => {
    if (!addSiteTargetCatId || !customSiteTitle.trim() || !customSiteHref.trim()) return

    // 伪协议拦截 + 协议补全 + 白名单校验统一在纯函数里（有单测，见 custom-site-input.test.ts）
    const normalized = normalizeCustomSiteHref(customSiteHref)
    if (!normalized.ok) {
      if (normalized.reason === 'unsafe-protocol') {
        toast({ title: '⚠️ 网址不安全', description: '仅允许 http/https 或站内相对路径。' })
      } else {
        toast({ title: '⚠️ 网址不合法', description: '请输入合法的 http(s) 网址。' })
      }
      return
    }

    const outcome = addSiteToCustomCategory(addSiteTargetCatId, {
      id: createCustomSiteId(),
      title: customSiteTitle.trim(),
      href: normalized.href,
      description: customSiteDesc.trim() || undefined,
    })

    if (outcome === 'failed') {
      // 写盘失败时不能关弹窗、更不能清输入：用户至少还能把内容复制走
      toast({
        title: '这一下没能保存',
        description: '浏览器拒绝写入本地存储（可能是隐私模式或空间已满）。站点只在当前页面生效，刷新后会消失。',
        variant: 'destructive',
      })
      return
    }
    if (outcome === 'duplicate') {
      toast({
        title: '站点已在分类里',
        description: `「${customSiteTitle.trim()}」没有重复添加。`,
      })
      setAddSiteTargetCatId(null)
      return
    }

    toast({
      title: '✨ 自定义站点已添加',
      description: `站点「${customSiteTitle.trim()}」已成功收录至该分类。`,
    })

    setAddSiteTargetCatId(null)
    setCustomSiteTitle('')
    setCustomSiteHref('')
    setCustomSiteDesc('')
  }

  // 6. 自定义站点录入时的关键词重合度分类推荐（本地启发式，界面上要如实标注）
  const categorySuggestion = useMemo(() => {
    if (!customSiteTitle.trim() && !customSiteHref.trim()) return null
    return suggestCategoryForSite(
      { title: customSiteTitle, href: customSiteHref, description: customSiteDesc },
      sortedCategories
    )
  }, [customSiteTitle, customSiteHref, customSiteDesc, sortedCategories])

  // 7. 分类直达聚焦态上下文（用于自动收起无关顶部窗口、渲染面包屑与邻近分类切换）
  const focusedIndex = useMemo(
    () => (focusedCategoryId ? sortedCategories.findIndex((c) => c.id === focusedCategoryId) : -1),
    [focusedCategoryId, sortedCategories],
  )
  const focusedCategory = focusedIndex >= 0 ? sortedCategories[focusedIndex] : null
  const isCategoryFocused = Boolean(focusedCategory) && viewMode !== 'workbench'
  const focusedSubCategoryTitle = useMemo(() => {
    if (!focusedCategory || !focusedSubCategoryId) return null
    if (focusedSubCategoryId === '__direct__') return '精选直属'
    return focusedCategory.subCategories?.find((sub) => sub.id === focusedSubCategoryId)?.title ?? null
  }, [focusedCategory, focusedSubCategoryId])

  const effectiveWorkspaceLayoutV2 = useMemo(
    () =>
      workspaceLayoutV2 ??
      migrateLayoutToV2(homeDiyConfig, {
        catalogCategoryIds: allCategoryIds,
      }),
    [workspaceLayoutV2, homeDiyConfig, allCategoryIds],
  )

  const categoryByIdMap = useMemo(() => {
    const map = new Map<string, (typeof renderedCategories)[number]>()
    for (const cat of renderedCategories) {
      map.set(cat.id, cat)
    }
    return map
  }, [renderedCategories])

  const availableWorkspaceBlocks = useMemo<AvailableWorkspaceBlock[]>(() => {
    const blocks: AvailableWorkspaceBlock[] = []
    // 若 V2 配置里包含统一顶层模块（search / dock / hotlist），优先纳入统一区块列表
    const savedLg = effectiveWorkspaceLayoutV2.breakpoints.lg
    for (const saved of savedLg) {
      if (saved.type === 'search' || saved.type === 'dock' || saved.type === 'hotlist') {
        blocks.push({ id: saved.id, type: saved.type, refId: saved.refId, defaultW: saved.w, defaultH: saved.h })
      }
    }
    for (const cat of renderedCategories) {
      blocks.push({
        id: cat.id,
        type: (cat as { isCustom?: boolean }).isCustom ? 'custom_group' : 'category',
        refId: cat.id,
      })
    }
    return blocks
  }, [effectiveWorkspaceLayoutV2.breakpoints.lg, renderedCategories])

  const selectedBentoBlock = useMemo(() => {
    if (!isEditingLayout || !selectedBlockId) return null
    const list = reconcileBreakpointBlocks(
      effectiveWorkspaceLayoutV2,
      activeBentoBreakpoint,
      availableWorkspaceBlocks,
    )
    return list.find((b) => b.id === selectedBlockId) ?? null
  }, [isEditingLayout, selectedBlockId, effectiveWorkspaceLayoutV2, activeBentoBreakpoint, availableWorkspaceBlocks])

  const renderUnifiedBentoBlock = useCallback(
    (
      block: LayoutBlock,
      meta: {
        breakpoint: WorkspaceBreakpointKey
        totalCols: number
        index: number
        isCompactOutline?: boolean
      },
    ) => {
      if (block.type === 'search') {
        return (
          <BentoSearchBlock
            block={block}
            isEditing={isEditingLayout}
            isSelected={selectedBlockId === block.id}
            isCompactOutline={Boolean(meta.isCompactOutline)}
            totalCols={meta.totalCols}
            onSelect={setSelectedBlockId}
            onTriggerSearch={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
              }
            }}
          />
        )
      }
      if (block.type === 'dock') {
        return (
          <BentoDockBlock
            block={block}
            isEditing={isEditingLayout}
            isSelected={selectedBlockId === block.id}
            isCompactOutline={Boolean(meta.isCompactOutline)}
            totalCols={meta.totalCols}
            onSelect={setSelectedBlockId}
            speedSites={dialSites}
            dialDigitById={mounted ? dialMap.digitById : undefined}
          />
        )
      }
      if (block.type === 'hotlist') {
        return (
          <BentoHotlistBlock
            block={block}
            isEditing={isEditingLayout}
            isSelected={selectedBlockId === block.id}
            isCompactOutline={Boolean(meta.isCompactOutline)}
            totalCols={meta.totalCols}
            onSelect={setSelectedBlockId}
            hotSites={dialSites}
          />
        )
      }

      const category = categoryByIdMap.get(block.refId || block.id)
      if (!category) return null
      const section = (
        <NavigationCategorySection
          key={category.id}
          category={category}
          index={meta.index}
          totalCategories={sortedCategories.length}
          allCategoryIds={allCategoryIds}
          gridColumnsClass={gridColumnsClass}
          cardDisplayMode={effectiveCardDisplayMode}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          siteData={siteData}
          setAddSiteTargetCatId={setAddSiteTargetCatId}
          setPeekItem={openPeek}
          keyboardHintId="navhub-card-keyboard-hint"
          toggleSelectOne={toggleSelectOne}
          cardsPerGroup={cardsPerGroup}
          dialDigitById={mounted ? dialMap.digitById : undefined}
          siteTitleById={siteTitleById}
          embeddedInBento
          bentoBlock={block}
          bentoTotalCols={meta.totalCols}
          isBlockSelected={selectedBlockId === block.id}
          onSelectBlock={setSelectedBlockId}
          isCompactOutline={Boolean(meta.isCompactOutline)}
        />
      )

      const isFreshCustom = Boolean((category as { isCustom?: boolean }).isCustom)
      const isSideBySide = block.w < meta.totalCols
      if (isEditingLayout || isFreshCustom || isSideBySide || meta.index < EAGER_CATEGORY_COUNT) {
        return section
      }
      return (
        <LazyMountSection
          key={category.id}
          sectionId={category.id}
          title={category.title}
          count={countCategorySites(category)}
          estimatedHeight={estimateTruncatedSectionHeight(category, cardsPerGroup)}
          force={false}
        >
          {section}
        </LazyMountSection>
      )
    },
    [
      isEditingLayout,
      selectedBlockId,
      setSelectedBlockId,
      dialSites,
      mounted,
      dialMap.digitById,
      categoryByIdMap,
      sortedCategories.length,
      allCategoryIds,
      gridColumnsClass,
      effectiveCardDisplayMode,
      selectionMode,
      selectedIds,
      siteData,
      setAddSiteTargetCatId,
      openPeek,
      toggleSelectOne,
      cardsPerGroup,
      siteTitleById,
    ],
  )

  // P0-2 / Step 2：移动端顶行「快捷坞」入口与坞内「展开全部」共用同一个弹窗开关。
  const [quickDockOpen, setQuickDockOpen] = useState(false)

  const renderHomeQuickToolsRow = () => (
    <div className="flex flex-col gap-1.5 min-[1400px]:flex-row min-[1400px]:items-center min-[1400px]:gap-2.5">
      <div className="min-w-0 min-[1400px]:shrink-0">
        <HomeCapsuleRow
          cinemaInitial={cinemaInitial}
          pluginItems={pluginItems}
          showDramaCapsule={sectionOn('dramaCinema')}
          showAiCapsule={sectionOn('aiFinder')}
          showGuideBadge={!isModuleHidden('mod:onboarding-card')}
          activeWorkspace={activeWorkspace}
          onWorkspaceChange={handleWorkspaceChange}
          initialSceneParam={sceneParam}
          onOpenQuickDock={() => setQuickDockOpen(true)}
          onOpenGuideTab={() => {
            setAppearanceTab('guide')
            setAppearanceOpen(true)
          }}
        />
      </div>
      {/* 三合一单行高频直达坞（A4：合并 SpeedDialDock / 常用 / 最近访问） */}
      {!isModuleHidden('mod:speed-dial') && (
        <>
          {/* P0-2 / A′：工作区（页面级视角）与快捷坞（局部模式）之间的语义分隔线。
              只在 ≥1400 两者并排时出现；竖排（<1400）时由行距天然分组，无需分隔。 */}
          <span aria-hidden className="hidden min-[1400px]:block h-5 w-px shrink-0 bg-border" />
          <div data-feature-id="mod:speed-dial" className="relative min-w-0 min-[1400px]:flex-1">
            <HomeQuickDock
              dialDigitById={mounted ? dialMap.digitById : undefined}
              // P2-14：速拨顺序由父级 dialSites 一次算好透传，坞不再自己重算。
              speedSites={dialSites}
              // P0-2 / Step 2 在途（并行会话）：quickDockOpen 父级提升草稿保留；
              // 远端 731bdf82 的 HomeQuickDock 暂为弹窗内部自管（allDialogOpen/
              // onAllDialogOpenChange props 已删），两边对齐由该草稿收尾时定夺。
            />
          </div>
        </>
      )}
    </div>
  )

  return (
    <InitialViewModeProvider value={ssrCardDisplayMode}>
    <div className="flex flex-col md:flex-row min-h-screen">
      <nav aria-label="站点分类导航" className="hidden md:block relative z-20">
        <Sidebar
          navigationData={sidebarNavigationData}
          siteInfo={siteData}
          focusedCategoryId={focusedCategoryId}
          focusedSubCategoryId={focusedSubCategoryId}
          onSelectCategory={handleSelectSidebarCategory}
          className="sticky top-0 h-screen"
        />
      </nav>

      <div className={cn(
        "fixed inset-0 z-50 md:hidden",
        isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
      )}>
        <div
          {...scrimProps}
          className="absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
        />
        <div
          {...containerProps}
          id="mobile-nav-drawer"
          aria-label="站点导航"
          className={cn(
            "fixed inset-y-0 left-0 w-3/4 max-w-xs bg-background depth-modal transform transition-transform duration-[--duration-base] ease-in-out outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {drawerSidebarMounted && (
            <Sidebar
              navigationData={sidebarNavigationData}
              siteInfo={siteData}
              brandAsHeading={false}
              focusedCategoryId={focusedCategoryId}
              focusedSubCategoryId={focusedSubCategoryId}
              onSelectCategory={handleSelectSidebarCategory}
              onClose={handleCloseSidebar}
            />
          )}
        </div>
      </div>

      <main
        id="main-content"
        data-card-mode={effectiveCardDisplayMode}
        /* @container：卡片网格改用容器查询（2026-11-21）。
           为什么必须用容器而不是视口：左侧栏可拖拽、宽度可变，视口宽推不出
           主区宽。同一 1280px 视口下，侧栏 210px 与 320px 时主区差 110px，
           按视口断点会给出同一个列数，要么挤要么空。
           container-type: inline-size 让内部 @2xl/@5xl 断点按主区真实宽度求值。 */
        className={cn("flex-1 min-h-screen flex flex-col min-w-0 @container transition-colors duration-[--duration-slow]", canvasBgClass)}
        // 水合安全：壁纸来自 localStorage（仅客户端），首帧与 SSR 保持一致（undefined），
        // 挂载后再上壁纸，避免 style 分叉触发 hydration mismatch；URL 白名单防 CSS url() 注入
        style={{
          ...(mounted && customWallpaperUrl && isSafeWallpaperUrl(customWallpaperUrl) ? {
            backgroundImage: `url(${customWallpaperUrl})`,
            backgroundSize: 'cover',
            backgroundAttachment: 'fixed',
            backgroundPosition: 'center',
            backdropFilter: `blur(${glassmorphismBlur || 0}px)`
          } : {}),
          // P1 接线：DIY 卡片不透明度经 CSS 变量驱动 .nav-card-deferred 底色；
          // JS 侧 clamp 0.88~1.0（0.88 为壁纸实测可读性下限，0.85 外推 ≈4.4:1 跌破 AA）
          '--card-alpha': String(clampCardOpacity(cardOpacity)),
        } as React.CSSProperties}
      >
        {/* 卡片键盘模型说明：所有卡片通过 aria-describedby 指向这一条 */}
        {!isFeatureHidden('feat:keyboard-hint') && (
          <p id="navhub-card-keyboard-hint" data-feature-id="feat:keyboard-hint" className="sr-only">
            站点卡片：按空格打开速览与微动作；按右方向键进入卡片操作区（标签、平替与底栏按钮都在内），左右方向键切换，Esc 返回卡片。按数字键 1 到 9 直接打开速览坞对应站点；Shift+数字在新标签页打开；Ctrl+Shift+数字打开自定义快拨位。
          </p>
        )}

        {/* 未聚焦单分类时正常展示顶部搜索工具栏；点击任意分类后与工作区、高频直达坞一并自动收起，
            用户可随时通过顶部聚焦条的「展开顶栏 ▾」下拉显示。 */}
        {!isCategoryFocused && (
          <NavigationToolbar
            siteConfig={siteData}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={handleToggleSidebar}
            onOpenTools={handleOpenTools}
            onOpenShortcuts={handleOpenShortcuts}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            visibleSiteCount={visibleSites.length}
            onToggleSelectMode={toggleSelectMode}
            onSelectAllVisible={selectAllVisible}
            todayBadge={todayBadge}
            pinnedWidgetCount={pinnedMounted ? pinnedCornerWidgets.length : 0}
            /* 接受上游把内联箭头抽成 handleXxx 回调（更利于 memo 稳定）；
               本分支新增的 unreadNotifications（铃铛红点）追加在末尾。 */
            onOpenTodayCenter={handleOpenTodayCenter}
            onOpenWidgetBox={handleOpenWidgetBox}
            onOpenAppearanceGuide={handleOpenAppearanceGuide}
            onOpenAiFinder={handleOpenAiFinder}
            unreadNotifications={unreadNotifications}
          />
        )}

        {/* 单分类聚焦吸顶极简操控条：顶栏/工作区/直达坞三块无关窗口全收起后直接顶到视口最上方，
            提供一键「展开顶栏 ▾」下拉显示全部顶栏与快捷坞、返回全部以及上/下一类切换 */}
        {isCategoryFocused && focusedCategory && (
          <div className="sticky top-0 z-30">
            <div
              data-testid="focused-category-bar"
              className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-background/92 px-3 py-1.5 pt-[max(env(safe-area-inset-top,0px),0.375rem)] backdrop-blur-md sm:px-6 md:px-8"
            >
              <div className="flex min-w-0 items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={handleToggleSidebar}
                  aria-label="打开分类导航"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 md:hidden cursor-pointer"
                >
                  <Menu className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={handleClearFocusedCategory}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-background px-2.5 font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary pointer-coarse:min-h-11 pointer-coarse:min-w-11 cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>返回全部</span>
                </button>
                <span aria-hidden="true" className="px-0.5 text-muted-foreground">/</span>
                {focusedSubCategoryTitle ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setFocusedSubCategoryId(null)}
                      className="truncate font-medium text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                      title={`查看「${focusedCategory.title}」全部分组`}
                    >
                      {focusedCategory.title}
                    </button>
                    <span aria-hidden="true" className="px-0.5 text-muted-foreground">/</span>
                    <span className="truncate font-semibold text-foreground">{focusedSubCategoryTitle}</span>
                  </>
                ) : (
                  <span className="truncate font-semibold text-foreground">{focusedCategory.title}</span>
                )}
                <span className="hidden sm:inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  完整展示
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {/* 下拉按钮：一键下拉展开已收起的顶部搜索工具栏 + 工作区切换 + 高频直达坞 */}
                <button
                  type="button"
                  data-testid="focused-tools-dropdown-toggle"
                  onClick={handleToggleFocusedQuickDrawer}
                  aria-expanded={focusedQuickDrawerOpen}
                  aria-controls="focused-quick-tools-drawer"
                  title={focusedQuickDrawerOpen ? '收起顶部搜索栏、工作区与高频直达坞' : '下拉显示顶部搜索栏、工作区与高频直达坞'}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11 cursor-pointer",
                    focusedQuickDrawerOpen
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  <span>{focusedQuickDrawerOpen ? '收起顶栏' : '展开顶栏'}</span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      focusedQuickDrawerOpen && "rotate-180"
                    )}
                    aria-hidden="true"
                  />
                </button>

                <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border/60" />

                {(() => {
                  const prevCat = focusedIndex > 0 ? sortedCategories[focusedIndex - 1] : null
                  const nextCat =
                    focusedIndex < sortedCategories.length - 1 ? sortedCategories[focusedIndex + 1] : null
                  return (
                    <>
                      <button
                        type="button"
                        disabled={!prevCat}
                        onClick={() => prevCat && handleSelectSidebarCategory(prevCat.id, null)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/60 bg-background px-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        title={prevCat ? `上一分类：${prevCat.title}` : '已是首个分类'}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="hidden sm:inline max-w-[84px] truncate">{prevCat ? prevCat.title : '上一类'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!nextCat}
                        onClick={() => nextCat && handleSelectSidebarCategory(nextCat.id, null)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/60 bg-background px-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        title={nextCat ? `下一分类：${nextCat.title}` : '已是最后一个分类'}
                      >
                        <span className="hidden sm:inline max-w-[84px] truncate">{nextCat ? nextCat.title : '下一类'}</span>
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </>
                  )
                })()}
              </div>
            </div>

            {/* 下拉抽屉：点击「展开顶栏 ▾」后一次性显示搜索顶栏 + 工作区视图切换 + 高频直达坞 */}
            {focusedQuickDrawerOpen && (
              <div
                id="focused-quick-tools-drawer"
                data-testid="focused-quick-tools-drawer"
                className="border-b border-border/60 bg-background/98 shadow-md backdrop-blur-md animate-in fade-in-0 slide-in-from-top-1 duration-150"
              >
                <NavigationToolbar
                  embedded
                  siteConfig={siteData}
                  isSidebarOpen={isSidebarOpen}
                  onToggleSidebar={handleToggleSidebar}
                  onOpenTools={handleOpenTools}
                  onOpenShortcuts={handleOpenShortcuts}
                  selectionMode={selectionMode}
                  selectedIds={selectedIds}
                  visibleSiteCount={visibleSites.length}
                  onToggleSelectMode={toggleSelectMode}
                  onSelectAllVisible={selectAllVisible}
                  todayBadge={todayBadge}
                  pinnedWidgetCount={pinnedMounted ? pinnedCornerWidgets.length : 0}
                  onOpenTodayCenter={handleOpenTodayCenter}
                  onOpenWidgetBox={handleOpenWidgetBox}
                  onOpenAppearanceGuide={handleOpenAppearanceGuide}
                  onOpenAiFinder={handleOpenAiFinder}
                  unreadNotifications={unreadNotifications}
                  // 聚焦抽屉内搜索限定到当前分类：子分类优先；'__direct__'（精选直属）
                  // 是前端哨兵值、不是真实分类 id，原样传会让中枢解析失败、零命中后
                  // 误挂放宽横幅，故回落父级。已知近似：回落时搜索范围是父级整树
                  // （含各子分类），比可见的「仅直属」略宽——中枢没有「仅直属」
                  // 检索模式，可接受，不是 bug。
                  categoryId={
                    focusedSubCategoryId && focusedSubCategoryId !== '__direct__'
                      ? focusedSubCategoryId
                      : (focusedCategoryId ?? undefined)
                  }
                />
                <div className="px-3 py-2 sm:px-6 md:px-8">
                  {renderHomeQuickToolsRow()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 半屏下沉栏（Batch 3 第 12 项）：仅全景浏览态挂载，单分类聚焦时收起避免视觉干扰 */}
        {!isCategoryFocused && (
          <HalfScreenDock
            activeWorkspace={activeWorkspace}
            onOpenTools={handleOpenTools}
            isEditingLayout={isEditingLayout}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
          />
        )}

        {/* 吸顶分类快捷直达导航轨（聚焦单分类时自动收起，避免与聚焦导航条重复占高） */}
        {viewMode !== 'workbench' && !isCategoryFocused && sortedCategories.length > 0 && !isModuleHidden('mod:workspace-bar') && (
          <div data-feature-id="mod:workspace-bar" className="relative">
            <CategoryQuickJumpBar
              className="md:hidden"
              categories={sortedCategories.map((cat) => ({
                id: cat.id,
                title: cat.title,
                count: countCategorySites(cat),
              }))}
              isAllCollapsed={sortedCategories.length > 0 && sortedCategories.every((cat) => collapsedCategoryIds.includes(cat.id))}
              onToggleAllCollapsed={() => {
                const allCollapsed = sortedCategories.every((cat) => collapsedCategoryIds.includes(cat.id))
                if (allCollapsed) {
                  expandAllCategories()
                } else {
                  collapseAllCategories(sortedCategories.map((c) => c.id))
                }
              }}
            />
          </div>
        )}

        <div className="px-3 sm:px-6 md:px-8 pt-2 sm:pt-2 pb-8 flex-1">
          {/* 增量掩码与时间轴回收站快捷感知条（当用户存在已删减功能或处于 DIY 编辑态时呈现） */}
          {(totalPrunedCount > 0 || isEditingLayout) && (
            <div
              data-pruning-status-bar=""
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs backdrop-blur-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
                <span className="font-semibold text-foreground">
                  {totalPrunedCount > 0
                    ? bypassMaskTemporarily
                      ? `👁️ 正在临时透视完整版（您原有的 ${totalPrunedCount} 项删减配置已安全保留）`
                      : `✂️ 已按您的偏好精简 ${totalPrunedCount} 项功能/模块`
                    : '🛠️ 模块化自由裁剪模式：点击任意区块右上角「－ 移除」即可无损隐藏，随时可在回收站一键还原'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {totalPrunedCount > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const next = !bypassMaskTemporarily
                      setBypassMaskTemporarily(next)
                      toast({
                        title: next ? '👁️ 已开启完整版临时透视' : '✂️ 已切回您的专属精简视图',
                        description: next
                          ? '当前展示全站完整模块与分类，您的自定义删减掩码未丢失。'
                          : '已重新应用您的增量裁剪掩码。',
                      })
                    }}
                    className="h-7 px-2.5 text-xs rounded-lg gap-1"
                  >
                    {bypassMaskTemporarily ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{bypassMaskTemporarily ? '切回精简视图' : '全部探索（临时透视）'}</span>
                  </Button>
                )}
                {trashBin.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleUndoPrune}
                    className="h-7 px-2.5 text-xs rounded-lg gap-1"
                    title="撤销最近一次删减 (快捷键: Ctrl/Cmd + Z)"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>↩ 撤销上一步</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenRecoveryCenter}
                  className="h-7 px-2.5 text-xs rounded-lg gap-1 border-border-strong text-primary hover:bg-primary/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>🗑️ 回收站与功能矩阵 ({trashBin.length})</span>
                </Button>
                {totalPrunedCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      restoreAll()
                      unhideAllCategories()
                      toast({
                        title: '🔄 已无损恢复全站所有默认功能',
                        description: '全部模块、分类、子分类、站点与卡片微元素已回到初始状态。',
                      })
                    }}
                    className="h-7 px-2 text-xs rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    全部恢复默认
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* 首屏瘦身：主内容区不再渲染大号 H1 标题块（品牌 h1 已移到左侧边栏，
              见 sidebar.tsx；不走 sr-only 隐藏术）。副标题只在首次访问或搜索
              聚焦时以单行轻量条出现，可关闭（见 home-subtitle-hint.tsx）。
              点击单分类直达时一并自动收起，聚焦当前分类内容。 */}
          {!isCategoryFocused && (
            <HomeSubtitleHint
              tagline={homeControl.basic.tagline || siteData.basic.description || 'AI 原生智能网址导航与研发效率中枢'}
            />
          )}

          {/* P1-3 首屏再瘦身（2026-11-24）：未聚焦单分类时正常展示工作区与高频直达坞；
              点击具体分类后自动收起此行，通过 focused-category-bar 的「快捷栏 ▾」下拉按钮按需展开。 */}
          {viewMode !== 'workbench' && !isCategoryFocused ? (
            <div className="mb-2">
              {renderHomeQuickToolsRow()}
            </div>
          ) : null}

          {viewMode === 'workbench' ? (
            <div className="space-y-6">
              {/* 移动端品牌主标题（P2-5：常规目录融合在 HomeCapsuleRow 单行顶栏，工作台模式由此承接） */}
              <p role="heading" aria-level={1} className="md:hidden text-lg font-bold tracking-tight text-foreground">山羊胡导航</p>
              <div className="flex items-center justify-between pb-1">
                <div>
                  <h2 className="text-base sm:text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                    <span className="w-1.5 h-4.5 rounded-full bg-success" />
                    <span>模块化工作台主页</span>
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    当前处于工作台模式。模块支持自由拖拽换位、双轴尺寸调整，并在本地实时持久化。
                  </p>
                </div>
              </div>
              <ModularCanvas />
            </div>
          ) : (
            <>
              <DiyGridDragBoundary kit={dragKit} enabled={isEditingLayout} onDragEnd={handleCategoryDragEnd}>
              {(() => {
                if (focusedCategory) {
                  return (
                    <div className="grid grid-cols-12 gap-6 sm:gap-8 items-start pt-1">
                      <NavigationCategorySection
                        key={focusedCategory.id}
                        category={focusedCategory}
                        index={focusedIndex}
                        totalCategories={sortedCategories.length}
                        allCategoryIds={allCategoryIds}
                        gridColumnsClass={gridColumnsClass}
                        cardDisplayMode={effectiveCardDisplayMode}
                        selectionMode={selectionMode}
                        selectedIds={selectedIds}
                        siteData={siteData}
                        setAddSiteTargetCatId={setAddSiteTargetCatId}
                        setPeekItem={openPeek}
                        keyboardHintId="navhub-card-keyboard-hint"
                        toggleSelectOne={toggleSelectOne}
                        cardsPerGroup={0}
                        showCompleteContent
                        initialSelectedSubCatId={focusedSubCategoryId}
                        onSubCategoryChange={handleFocusedSubCategoryChange}
                        dialDigitById={mounted ? dialMap.digitById : undefined}
                        siteTitleById={siteTitleById}
                      />
                    </div>
                  )
                }

                return (
                  <div className="w-full">
                    {renderedCategories.length > 0 && (
                      isEditingLayout ? (
                        <BentoWorkspaceCanvas
                          layout={effectiveWorkspaceLayoutV2}
                          availableBlocks={availableWorkspaceBlocks}
                          isEditing={isEditingLayout}
                          activeDragLayer={activeDragLayer}
                          outlineMode={outlineMode}
                          selectedBlockId={selectedBlockId}
                          onActiveDragLayerChange={setActiveDragLayer}
                          onSelectBlock={setSelectedBlockId}
                          onCommitBreakpointLayout={(bp, committed, opts) => {
                            commitWorkspaceBreakpointLayout(bp, committed, availableWorkspaceBlocks, opts)
                          }}
                          onSyncAutoHeight={(bp, blockId, nextH) => {
                            syncBlockAutoHeight(bp, blockId, nextH, availableWorkspaceBlocks)
                          }}
                          onBreakpointChange={setActiveBentoBreakpoint}
                          renderBlock={(block, meta) => renderUnifiedBentoBlock(block, meta)}
                        />
                      ) : (
                        <BentoStaticGrid
                          layout={effectiveWorkspaceLayoutV2}
                          availableBlocks={availableWorkspaceBlocks}
                          renderBlock={(block, meta) => renderUnifiedBentoBlock(block, meta)}
                        />
                      )
                    )}

                    {sortedCategories.length === 0 && (
                      <div className="text-center py-16 text-muted-foreground space-y-3">
                        <p className="text-sm">
                          {allCategoriesHidden
                            ? '当前所有分类已被隐藏'
                            : '当前所有分类已被隐藏或工作台下暂无匹配站点'}
                        </p>
                        {allCategoriesHidden ? (
                          <Button variant="outline" size="sm" onClick={handleRecoverHiddenCategories}>
                            恢复全部隐藏分类
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => setActiveWorkspace('all')}>
                            查看全部站点
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Phase 2：右侧轻量区块属性检查器（窄屏底部抽屉） */}
                    {isEditingLayout && selectedBentoBlock && (
                      <BentoBlockInspector
                        block={selectedBentoBlock}
                        title={
                          selectedBentoBlock.type === 'search'
                            ? '聚合搜索'
                            : selectedBentoBlock.type === 'dock'
                              ? '高频速览坞'
                              : selectedBentoBlock.type === 'hotlist'
                                ? '全站热榜精选'
                                : categoryTitleMap[selectedBentoBlock.id] || selectedBentoBlock.id
                        }
                        breakpoint={activeBentoBreakpoint}
                        canDelete={selectedBentoBlock.type !== 'search'}
                        onUpdate={(patch) => {
                          updateWorkspaceBlock(
                            activeBentoBreakpoint,
                            selectedBentoBlock.id,
                            patch,
                            availableWorkspaceBlocks,
                          )
                        }}
                        onTrash={() => {
                          const label =
                            categoryTitleMap[selectedBentoBlock.id] || selectedBentoBlock.id
                          trashWorkspaceBlock(selectedBentoBlock.id, label, availableWorkspaceBlocks)
                          if (
                            selectedBentoBlock.type === 'category' ||
                            selectedBentoBlock.type === 'custom_group'
                          ) {
                            removeFeature({
                              id: `cat:${selectedBentoBlock.id}`,
                              level: 'L2_CATEGORY',
                              title: label,
                            })
                          }
                          toast({
                            title: `🗑️ 已移入回收站：${label}`,
                            description: '已保存原坐标，随时可在回收站一键原位恢复或按 Ctrl+Z 撤销。',
                          })
                        }}
                        onClose={() => setSelectedBlockId(null)}
                      />
                    )}
                  </div>
                )
              })()}
              </DiyGridDragBoundary>
            </>
          )}

          {/*
            站内目录带是首页 HTML 里权重最高的一批 /category 内链（F1，2026-10-22：
            改版前首页 0 条分类内链，hub 只能靠 sitemap 被发现），判据由
            home-directory.test.ts 锁死，不能删。但它同时是首屏的第五层导航，
            于是放在分类正文之后：内链照常 SSR 直出，首屏留给内容。
          */}
          <nav
            aria-labelledby="home-directory-title"
            data-feature-id="mod:footer-directory"
            className={cn(
              "mt-10 sm:mt-12 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 backdrop-blur-sm relative",
              isModuleHidden('mod:footer-directory') && "hidden"
            )}
          >
            {isEditingLayout && (
              <button
                type="button"
                onClick={() => {
                  removeFeature({
                    id: 'mod:footer-directory',
                    level: 'L1_MODULE',
                    title: '底部站内目录（全部分类索引带）',
                    parentTitle: 'L1 全局功能组件',
                  })
                  toast({
                    title: '已移除「底部站内目录」',
                    description: '按 Ctrl/Cmd+Z 可立即撤销，或在回收站随时恢复。',
                  })
                }}
                className="mb-1.5 ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-destructive-text bg-destructive/15 hover:bg-destructive/20 border border-destructive/30 transition-colors cursor-pointer"
              >
                <EyeOff className="w-3 h-3" />
                <span>－ 移除站内目录</span>
              </button>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span id="home-directory-title" className="text-xs font-semibold text-foreground">
                站内目录
              </span>
              <Link href="/category" className="inline-flex items-center min-h-6 py-0.5 px-1.5 rounded-md text-xs text-link hover:bg-primary/5 hover:underline transition-colors">
                全部分类
              </Link>
              <Link href="/sites" className="inline-flex items-center min-h-6 py-0.5 px-1.5 rounded-md text-xs text-link hover:bg-primary/5 hover:underline transition-colors">
                全部站点
              </Link>
              <Link href="/tags" className="inline-flex items-center min-h-6 py-0.5 px-1.5 rounded-md text-xs text-link hover:bg-primary/5 hover:underline transition-colors">
                按标签浏览
              </Link>
              {directoryLinks.length > 0 && (
                <DirectoryPillToolbar links={directoryLinks} counts={treeSiteCounts} />
              )}
            </div>
          </nav>
        </div>

        {/*
          首页 DIY 排版工坊拆成两块（2026-11-08 P0-3）：
            · HomeDIYTrigger —— 轻量静息入口，静态导入随首屏渲染，不等懒加载 chunk；
            · HomeDIYToolbar —— 重量级 HUD（下拉菜单 / 多个 Dialog / 备份弹窗），
              只在真正进入编辑态时才挂载并下载该 chunk。
          拆之前整包 HUD 在首屏就参与主线程竞争，移动端实测 DIY 按钮 12.5s 才可点。
        */}
        {!isFeatureHidden('feat:diy-fab') && (
          <div data-feature-id="feat:diy-fab">
            <HomeDIYTrigger hideStaticButton />
          </div>
        )}
        {isEditingLayout && (
          <HomeDIYToolbar
            allCategoryIds={allCategoryIds}
            categoryTitleMap={categoryTitleMap}
            categories={sortedCategories}
            raised={selectionMode}
            activeWorkspace={activeWorkspace}
          />
        )}

        {/* 页脚 */}
        {!isModuleHidden('mod:footer') && (
          <div data-feature-id="mod:footer" className="relative">
            {isEditingLayout && (
              <div className="px-4 sm:px-8 pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    removeFeature({
                      id: 'mod:footer',
                      level: 'L1_MODULE',
                      title: '底部生态入口与页脚',
                      parentTitle: 'L1 全局功能组件',
                    })
                    toast({
                      title: '已移除「底部生态入口与页脚」',
                      description: '按 Ctrl/Cmd+Z 可立即撤销，或在回收站随时恢复。',
                    })
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium text-destructive-text bg-destructive/15 hover:bg-destructive/20 border border-destructive/30 transition-colors cursor-pointer"
                >
                  <EyeOff className="w-3 h-3" />
                  <span>－ 移除页脚与生态入口</span>
                </button>
              </div>
            )}
            <Footer siteInfo={siteData} />
          </div>
        )}

        {/* 4.0 弹窗：空格键沙箱速览与行动视窗 */}
        {peek ? (
          <SitePeekDialog
            item={peek.item}
            open
            onOpenChange={(open) => !open && setPeek(null)}
            onCloseAutoFocus={() => restorePeekFocus()}
            categoryId={peek.categoryId}
            isPinnedInCategory={
              peek.categoryId
                ? (pinnedSiteIdsByCategory[peek.categoryId] ?? []).includes(peek.item.id)
                : false
            }
            onTogglePinInCategory={
              peek.categoryId
                ? (siteId) => togglePinSiteInCategory(peek.categoryId!, siteId)
                : undefined
            }
          />
        ) : null}

        {/* 4.0 弹窗：内置开发者微工具抽屉 */}
        {isToolsOpen ? (
          <QuickToolsDrawer open onOpenChange={setIsToolsOpen} />
        ) : null}

        {/* 首屏瘦身：底部悬浮快捷导航胶囊已移除（回顶 / 呼出超级搜索 / 微工具
            三键已由顶栏搜索 + ⌘K 命令面板 + T 键覆盖；回顶另见命令面板
            「回到页面顶部」。见 floating-quick-nav 退役说明）。 */}

        {/* 4.0 弹窗：快捷键指南与 Maestro 监听 */}
        {/* T 键打开微工具箱的键盘入口由这里接线（若 L4 禁用了 feat:keyboard-nav 则卸载监听） */}
        {!isFeatureHidden('feat:keyboard-nav') && (
          <KeyboardShortcutsDialog
            open={isShortcutsOpen}
            onOpenChange={setIsShortcutsOpen}
            onOpenTools={handleOpenTools}
          />
        )}

        {/* 多选批量操作坞：选中任意卡片后自底部升起（批量导出 / 复制 / 置顶） */}
        {selectionMode && (
          <BatchOperationDock
            selectedSites={selectedSites}
            customCategories={customAsCategories.map((c: any) => ({
              id: c.id,
              title: c.title,
              items: (c.items as any[]) || [],
            }))}
            onClearSelection={clearSelection}
            onSelectAll={selectAllVisible}
            totalCount={visibleSites.length}
            onBatchAddToCustomCategory={handleBatchAddToCustomCategory}
            onBatchPinToWorkbench={handleBatchPinToWorkbench}
            onBatchDeleteFromCustomCategories={handleBatchRemoveFromCustomCategories}
          />
        )}

        {/* 按需小窗口弹出层：全部动态懒加载，零首屏占高与体积膨胀 */}
        {todayOpen ? (
          <TodayCenterDialog
            open={todayOpen}
            onOpenChange={setTodayOpen}
            todayContent={<TodayZoneContent />}
            briefContent={<BriefStripContent />}
            examContent={<ExamStripContent />}
            handoffContent={
              <>
                <HandoffCardWithCloudContent />
                <StreakBarContent />
              </>
            }
            countdownLabel={todayBadge?.countdownLabel}
            todayCount={todayBadge?.todayCount}
            pinnedWidgetCount={pinnedMounted ? pinnedCornerWidgets.length : 0}
            defaultTab={todayTab}
          />
        ) : null}

        {widgetBoxOpen ? (
          <WidgetBoxDialog
            open={widgetBoxOpen}
            onOpenChange={setWidgetBoxOpen}
          />
        ) : null}

        {appearanceOpen ? (
          <AppearanceGuideDialog
            open={appearanceOpen}
            onOpenChange={setAppearanceOpen}
            defaultTab={appearanceTab}
          />
        ) : null}

        {toolbarAiOpen ? (
          <AiFinderDialog
            open={toolbarAiOpen}
            onOpenChange={setToolbarAiOpen}
            defaultMode={toolbarAiMode}
            initialQuery={toolbarAiQuery}
          />
        ) : null}

        {pinnedMounted && pinnedCornerWidgets.length > 0 ? (
          <PinnedCornerWidgets />
        ) : null}

        {/* 自定义站点录入弹窗（懒加载：Radix Dialog 约 144 KB 不再进首屏） */}
        {addSiteTargetCatId ? (
          <AddSiteDialog
            open
            onOpenChange={(open) => !open && setAddSiteTargetCatId(null)}
            title={customSiteTitle}
            href={customSiteHref}
            desc={customSiteDesc}
            onTitleChange={setCustomSiteTitle}
            onHrefChange={setCustomSiteHref}
            onDescChange={setCustomSiteDesc}
            suggestion={categorySuggestion}
            onPickSuggestion={setAddSiteTargetCatId}
            onSubmit={handleAddCustomSiteSubmit}
          />
        ) : null}
      </main>
    </div>
    </InitialViewModeProvider>
  )
}
