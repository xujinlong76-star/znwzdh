'use client'

import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { DragEndEvent } from '@dnd-kit/react'
import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { Sidebar } from '@/components/sidebar'
import { NavigationToolbar } from '@/components/navigation-toolbar'
import { NavigationCategorySection } from '@/components/navigation-category-section'
import { LazyMountSection } from '@/components/lazy-mount-section'
import { HomeDIYTrigger } from '@/components/home-diy-trigger'
import { DirectoryPillToolbar } from '@/components/directory-pill-toolbar'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { useHomeDiyGrid } from '@/lib/modular/use-home-diy-grid'
import { readDiyDragData } from '@/lib/modular/diy-drag'
import {
  useFeatureMask,
  stripFeaturePrefix,
  syncHiddenCategoriesFromDIY,
} from '@/lib/modular/feature-mask-store'
import { Footer } from '@/components/footer'
import { OnboardingCard } from '@/components/onboarding-card'
import { AiFinderPanel } from '@/components/ai/ai-finder-panel'
// 拖拽 provider 边界（DRAG-2 接线）：dnd-kit 约 133KB，绝不能静态进首屏。
// kit 在挂载后后台 import，到达前直接渲染 children；到达后包上
// DiyDragProvider。注意：切换瞬间 grid 子树会 remount 一次——只发生
// 在 chunk 到达后、用户操作前（与 section 里的后台 import 同一时机），
// 之后进出编辑态不再动 provider（卡片手柄的挂载/卸载是既有设计）。
// 若 Ryan 实测到加载闪烁，备选是静态 import provider（以首屏包体积换零闪烁）。
function DiyGridDragBoundary({
  kit,
  onDragEnd,
  children,
}: {
  kit: typeof import('@/components/diy/diy-drag-kit') | null
  onDragEnd: (event: DragEndEvent) => void
  children: ReactNode
}) {
  if (!kit) return <>{children}</>
  const { DiyDragProvider } = kit
  return <DiyDragProvider onDragEnd={onDragEnd}>{children}</DiyDragProvider>
}

// 沉浸影院带在首屏下方且自带懒挂载：动态导入，不占首页首屏包体积（预算紧）。
const HomeDramaCinema = dynamic(
  () => import('@/components/home-drama-cinema').then((m) => m.HomeDramaCinema),
  {
    ssr: false,
    /**
     * 等高骨架（Lighthouse Wave 1 CLS 修复）：影院区 chunk 晚到时先占满真实高度，
     * 落进再换真内容，整页不上下跳（旧版无 loading 占位，733px 级下推落在另一
     * 个 CLS 窗口）。骨架与真实结构逐项对齐——Playwright 实测生产构建：
     * 标题行 28px、aside 371px、总高移动 936px / 桌面 619px，海报用同款
     * aspect-[440/784]，横幅用同款 aspect-[1000/561]。
     * 改 home-drama-cinema.tsx 的结构时必须同步改这里，否则骨架与真身不等高。
     */
    loading: () => (
      <section aria-hidden className="mt-8 overflow-hidden rounded-3xl bg-zinc-950 text-zinc-100 shadow-xl">
        <div className="flex items-center justify-between px-4 pt-4 sm:px-6">
          <div className="h-7 w-44 rounded-md bg-white/10 animate-pulse" />
          <div className="hidden items-center gap-4 sm:flex">
            <div className="h-5 w-16 rounded-md bg-white/10 animate-pulse" />
            <div className="h-5 w-24 rounded-md bg-white/10 animate-pulse" />
          </div>
        </div>
        <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1fr_300px]">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="aspect-[440/784] w-36 shrink-0 rounded-2xl bg-white/10 animate-pulse sm:w-44"
              />
            ))}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="h-5 w-28 rounded bg-white/10 animate-pulse" />
            <div className="mt-3 space-y-2">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="h-6 w-full rounded bg-white/10 animate-pulse" />
              ))}
            </div>
            <div className="mt-3 border-t border-white/10 pt-2">
              <div className="h-10 w-full rounded bg-white/10 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="aspect-[1000/561] w-full rounded-2xl bg-white/10 animate-pulse"
            />
          ))}
        </div>
      </section>
    ),
  },
)
import { useOverlayBehavior } from '@/components/ui/overlay'
import {
  normalizeSettings,
  type FeatureKey,
} from '@/lib/site-settings'
import { readLocalHiddenHomeModules } from '@/lib/personal-home-modules'
import { CategoryInSituControls } from '@/components/category-in-situ-controls'
import { CategoryQuickJumpBar } from '@/components/category-quick-jump-bar'
import { FloatingQuickNav } from '@/components/floating-quick-nav'

// 性能优化：动态懒加载大型组件，大幅缩减首屏 JS 体积与主线程阻塞时间
const ModularCanvas = dynamic(
  () => import('@/components/modular/modular-canvas').then((m) => m.ModularCanvas),
  { ssr: false }
)
const HomeHeroDeck = dynamic(
  () => import('@/components/home-hero-deck').then((m) => m.HomeHeroDeck),
  {
    ssr: false,
    /**
     * 同高骨架。展板默认展开（4 张 min-h-[160px] 卡片 + 标题条），
     * 没有占位时首帧分类区贴顶、水合后整页下移约 200px——用户点到的
     * 可能是「刚被推下去」的另一张卡。骨架尺寸与真实展板对齐，不产生 CLS。
     */
    loading: () => (
      <div className="mb-6 sm:mb-8 space-y-3" aria-hidden>
        <div className="h-5 w-40 rounded-md bg-muted/60 animate-pulse" />
        <div className="grid grid-cols-12 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="col-span-12 sm:col-span-6 lg:col-span-3 min-h-[160px] rounded-2xl border border-border/60 bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      </div>
    ),
  }
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
import { SpeedDialDock } from '@/components/speed-dial-dock'
import { Button } from '@/registry/new-york/ui/button'

import { Input } from '@/registry/new-york/ui/input'
import { Plus, Tags, Eye, EyeOff, RotateCcw, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { type WorkspaceId } from '@/components/workspace-filter'
import {
  suggestCategoryForSite,
  clampCardOpacity,
  isSafeWallpaperUrl,
  isSafeSiteHref,
} from '@/lib/modular/diy-presets'
import { filterNavigationByWorkspace } from '@/lib/modular/workspace-matching'
import { countCategorySites } from '@/lib/modular/category-counts'
import {
  combineAndSortCategories,
  customCategoriesToNavigation,
} from '@/lib/modular/category-combine'
import { useSiteSelection } from '@/lib/modular/use-site-selection'
import { createCustomSiteId, normalizeCustomSiteHref } from '@/lib/modular/custom-site-input'
import { useToast } from '@/components/ui/use-toast'
import { pinSiteToWorkbench } from '@/lib/modular/workbench-bridge'

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

export function NavigationContent({
  navigationData,
  siteData,
  directoryLinks = [],
  cardsPerGroup = 0,
  initialCategoryLimit = 0,
}: NavigationContentProps) {
  const { toast } = useToast()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
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
  const peekReturnFocusRef = useRef<HTMLElement | null>(null)
  const openPeek = useCallback((item: NavigationSubItem | null, categoryId?: string) => {
    peekReturnFocusRef.current = document.activeElement as HTMLElement | null
    setPeek(item ? { item, categoryId } : null)
  }, [])
  const restorePeekFocus = useCallback(() => {
    const el = peekReturnFocusRef.current
    peekReturnFocusRef.current = null
    // 弹窗卸载是异步的，焦点归还要等一帧，否则会被 Radix 的卸载流程覆盖
    if (el && document.contains(el)) requestAnimationFrame(() => el.focus())
  }, [])

  // 添加自定义网址到专属分类状态
  const [addSiteTargetCatId, setAddSiteTargetCatId] = useState<string | null>(null)
  const [customSiteTitle, setCustomSiteTitle] = useState('')
  const [customSiteHref, setCustomSiteHref] = useState('')
  const [customSiteDesc, setCustomSiteDesc] = useState('')

  const {
    mounted,
    viewMode,
    cardDisplayMode,
    canvasBackground,
    categoryOrder,
    pinnedCategoryIds,
    hiddenCategoryIds,
    collapsedCategoryIds,
    collapseAllCategories,
    expandAllCategories,
    setCollapsedCategoryIds,
    customCategories,
    addSiteToCustomCategory,
    removeSiteFromCustomCategory,
    siteCategoryOverrides,
    pinnedSiteIdsByCategory,
    togglePinSiteInCategory,
    customWallpaperUrl,
    glassmorphismBlur,
    cardOpacity,
    isEditingLayout,
    setIsEditingLayout,
    unhideCategory,
    unhideAllCategories,
  } = useHomeDIY()

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

  // 拖拽卡片收录状态 (悬停的目标自定义分类 ID)
  const [dragOverCustomCatId, setDragOverCustomCatId] = useState<string | null>(null)

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

  // dnd-kit 重型层：挂载后在后台 import（不阻塞首屏；与 section 里的
  // 后台 import 同一个 chunk，到达后 DiyGridDragBoundary 包上 provider）。
  // 失败也不影响 ⋯ 菜单（拖拽是增强，不是必需）。
  type DiyDragKitModule = typeof import('@/components/diy/diy-drag-kit')
  const [dragKit, setDragKit] = useState<DiyDragKitModule | null>(null)
  useEffect(() => {
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
  }, [])

  // 分类拖拽落点：provider 的 onDragEnd 先于内置卡片处理调用；只处理
  // category→category，卡片落点走内置逻辑。目标 id 不在列表里时不动
  // （moveCategoryToIndex 会把 -1 夹到 0 误插到顶部，所以这里先拦住）。
  const { moveCategoryToIndex } = useHomeDiyGrid(allCategoryIds)
  const handleCategoryDragEnd = useCallback(
    (event: DragEndEvent) => {
      const source = readDiyDragData(event.operation.source)
      const target = readDiyDragData(event.operation.target)
      if (event.canceled || source?.kind !== 'category' || target?.kind !== 'category') return
      const toIndex = allCategoryIds.indexOf(target.categoryId)
      if (toIndex === -1) return
      moveCategoryToIndex(source.categoryId, toIndex)
    },
    [allCategoryIds, moveCategoryToIndex],
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

  const handleOpenRecoveryCenter = useCallback(() => {
    setIsEditingLayout(true)
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('navhub:open-recovery-center', { detail: { tab: 'trash' } }))
      }
    }, 80)
  }, [setIsEditingLayout])

  // 全局 Ctrl/Cmd+Z 撤销监听（删减进回收站后可撤销）。
  // 注意：这里曾经还有一个 Ctrl/Cmd+E 安全阀（右下角 DIY 按钮被隐藏时兜底呼出
  // 排版与恢复中心），因与快捷键帮助对话框的同一绑定重复触发、一次按键开关两次
  // 等于没按，已删除；Ctrl/Cmd+E 的唯一入口是 keyboard-shortcuts-dialog.tsx。
  // 单字符 E 已按 WCAG 2.1.4 废止：裸按 E 会与读屏软件冲突。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (trashBin.length > 0) {
          e.preventDefault()
          handleUndoPrune()
        }
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [trashBin.length, handleUndoPrune])

  const handleWorkspaceChange = useCallback((nextWorkspace: WorkspaceId) => {
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
   * 组件 `batch-operation-dock.tsx` 与 `lib/batch-operations.ts`（批量导出 /
   * 复制成 Markdown / 置顶 / 移动 / 删除）早就写好了，但**从未被挂载**：
   * 没有任何选中状态，也没有任何入口，用户「一次处理多个站点」的需求没有出口。
   * 这里补上入口：工具栏的「多选」开关 + 卡片选中态 + 底部操作坞。
   *
   * 选中态本身（可见站点收集 / 剪枝 / 切换 / 全选）已抽到
   * `lib/modular/use-site-selection.ts`，组件只消费返回值。
   */
  const {
    selectionMode,
    selectedIds,
    selectedSites,
    visibleSites,
    clearSelection,
    toggleSelectMode,
    toggleSelectOne,
    selectAllVisible,
  } = useSiteSelection(sortedCategories, collapsedCategoryIds)

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

  // 5. 根据多态卡片选择自适应网格列数
  const gridColumnsClass = useMemo(() => {
    if (cardDisplayMode === 'minimal' || (cardDisplayMode as any) === 'mini-chip') {
      return 'grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 min-[1536px]:grid-cols-7! min-[1920px]:grid-cols-8!'
    }
    if (cardDisplayMode === 'compact') {
      return 'grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 min-[1536px]:grid-cols-6! min-[1920px]:grid-cols-7!'
    }
    if (cardDisplayMode === 'rich') {
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-[1536px]:grid-cols-4! min-[1920px]:grid-cols-5!'
    }
    return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 min-[1536px]:grid-cols-5! min-[1920px]:grid-cols-6!'
  }, [cardDisplayMode])

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

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <div className="hidden md:block">
        <Sidebar
          navigationData={{ navigationItems: sortedCategories as unknown as NavigationItem[] }}
          siteInfo={siteData}
          className="sticky top-0 h-screen"
        />
      </div>

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
          aria-label="站点导航"
          className={cn(
            "fixed inset-y-0 left-0 w-3/4 max-w-xs bg-background shadow-lg transform transition-transform duration-200 ease-in-out outline-none",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <Sidebar
            navigationData={{ navigationItems: sortedCategories as unknown as NavigationItem[] }}
            siteInfo={siteData}
            onClose={() => setIsSidebarOpen(false)}
          />
        </div>
      </div>

      <main
        id="main-content"
        className={cn("flex-1 min-h-screen flex flex-col min-w-0 transition-colors duration-300", canvasBgClass)}
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
            站点卡片：按空格打开速览与微动作；按右方向键进入卡片操作区，左右方向键切换，Esc 返回卡片。
          </p>
        )}

        <NavigationToolbar
          siteConfig={siteData}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
          onOpenTools={() => setIsToolsOpen(true)}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          activeWorkspace={activeWorkspace}
          onWorkspaceChange={handleWorkspaceChange}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          visibleSiteCount={visibleSites.length}
          onToggleSelectMode={toggleSelectMode}
          onSelectAllVisible={selectAllVisible}
        />

        {/* 吸顶分类快捷直达导航轨 */}
        {viewMode !== 'workbench' && sortedCategories.length > 0 && !isModuleHidden('mod:workspace-bar') && (
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

        <div className="px-3 sm:px-6 md:px-8 pt-4 sm:pt-8 pb-8 flex-1">
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
                  className="h-7 px-2.5 text-xs rounded-lg gap-1 border-primary/40 text-primary hover:bg-primary/10"
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

          {/* 页面主标题：可见 h1 由 SSR 直出（2026-11-07 SEO 扫描，原 sr-only 隐藏形态
              属灰色做法）。h1 只承载品牌主体，描述降为 p，保持标题层级大纲干净。 */}
          <header
            data-feature-id="mod:hero-header"
            className={cn(
              "mb-4 sm:mb-6 relative",
              isModuleHidden('mod:hero-header') && "hidden",
              isEditingLayout && "p-3 rounded-xl border border-dashed border-primary/40 bg-primary/5"
            )}
          >
            {isEditingLayout && (
              <button
                type="button"
                onClick={() => {
                  removeFeature({
                    id: 'mod:hero-header',
                    level: 'L1_MODULE',
                    title: 'Hero 标题横幅（山羊胡网址导航大全）',
                    parentTitle: 'L1 全局功能组件',
                  })
                  toast({
                    title: '已移除「Hero 标题横幅」',
                    description: '按 Ctrl/Cmd+Z 可立即撤销，或在回收站随时恢复。',
                  })
                }}
                className="absolute top-2 right-2 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
              >
                <EyeOff className="w-3 h-3" />
                <span>－ 移除横幅</span>
              </button>
            )}
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
              {siteData.basic.title}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              {homeControl.basic.tagline || siteData.basic.description || 'AI 原生智能网址导航与研发效率中枢'}
            </p>
          </header>
          {/* 可编排板块（后台「站点设置 → 公告与功能」控制开关与顺序；
              个人隐藏再叠加一层）：按 home.order 渲染，全站关或个人隐藏的直接跳过 */}
          {viewMode !== 'workbench' &&
            homeControl.home.order.map((sectionKey) => {
              if (!sectionOn(sectionKey)) return null
              if (sectionKey === 'aiFinder') {
                /* AI 智能找站：首屏显眼入口，一句话直达站内站点卡片（服务端保证只出站内收录） */
                return <AiFinderPanel key={sectionKey} />
              }
              if (sectionKey === 'dramaCinema') {
                /* 沉浸影院（设计稿 E 落地）：短剧海报横滑 + 热播榜 + 分类横幅，懒挂载取数 */
                return <HomeDramaCinema key={sectionKey} />
              }
              /* 首访引导：非阻断式卡片，只在首页且非工作台视图出现 */
              if (isModuleHidden('mod:onboarding-card')) return null
              return (
            <div key={sectionKey} data-feature-id="mod:onboarding-card" className="relative">
              {isEditingLayout && (
                <button
                  type="button"
                  onClick={() => {
                    removeFeature({
                      id: 'mod:onboarding-card',
                      level: 'L1_MODULE',
                      title: '首屏快捷键与定制引导横幅',
                      parentTitle: 'L1 全局功能组件',
                    })
                    toast({
                      title: '已移除「首屏快捷键与定制引导横幅」',
                      description: '按 Ctrl/Cmd+Z 可立即撤销，或在回收站随时恢复。',
                    })
                  }}
                  className="mb-1 ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
                >
                  <EyeOff className="w-3 h-3" />
                  <span>－ 移除引导条</span>
                </button>
              )}
              <OnboardingCard />
            </div>
              )
            })}
          {viewMode === 'workbench' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-1">
                <div>
                  <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    <span className="w-1.5 h-4.5 rounded-full bg-emerald-500" />
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
              {/* 首屏极速启动 Bento 展板（多引擎聚合搜索 + 星标/收藏坞 + 时钟 + 快捷工具） */}
              {viewMode === 'hybrid' ? (
                <>
                  {!isModuleHidden('mod:hero-deck') && sectionOn('heroDeck') && (
                    <div data-feature-id="mod:hero-deck" className="relative">
                      {isEditingLayout && (
                        <div className="mb-1.5 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              removeFeature({
                                id: 'mod:hero-deck',
                                level: 'L1_MODULE',
                                title: '极速启动展板（多引擎聚合搜索 / 时钟 / 收藏足迹）',
                                parentTitle: 'L1 全局功能组件',
                              })
                              toast({
                                title: '已移除「极速启动展板」',
                                description: '首屏已直接吸附至下方模块；按 Ctrl/Cmd+Z 可立即撤销。',
                              })
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
                          >
                            <EyeOff className="w-3 h-3" />
                            <span>－ 移除极速启动展板</span>
                          </button>
                        </div>
                      )}
                      <HomeHeroDeck />
                    </div>
                  )}
                  {!isModuleHidden('mod:speed-dial') && (
                    <div data-feature-id="mod:speed-dial" className="relative">
                      {isEditingLayout && (
                        <div className="mb-1.5 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              removeFeature({
                                id: 'mod:speed-dial',
                                level: 'L1_MODULE',
                                title: '⚡ 极速直达坞 Top 10',
                                parentTitle: 'L1 全局功能组件',
                              })
                              toast({
                                title: '已移除「⚡ 极速直达坞 Top 10」',
                                description: '按 Ctrl/Cmd+Z 可立即撤销，或在回收站随时恢复。',
                              })
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
                          >
                            <EyeOff className="w-3 h-3" />
                            <span>－ 移除高频直达坞</span>
                          </button>
                        </div>
                      )}
                      <SpeedDialDock
                        allSites={visibleSites}
                        activeWorkspace={activeWorkspace}
                        onPeek={openPeek}
                      />
                    </div>
                  )}
                </>
              ) : (
                !isModuleHidden('mod:speed-dial') && (
                  <div data-feature-id="mod:speed-dial" className="relative">
                    <SpeedDialDock
                      allSites={visibleSites}
                      activeWorkspace={activeWorkspace}
                      onPeek={openPeek}
                    />
                  </div>
                )
              )}

              <DiyGridDragBoundary kit={dragKit} onDragEnd={handleCategoryDragEnd}>
              <div className="grid grid-cols-12 gap-6 sm:gap-8 items-start">
                {renderedCategories.map((category, index) => {
                  const section = (
                    <NavigationCategorySection
                      key={category.id}
                      category={category}
                      index={index}
                      totalCategories={sortedCategories.length}
                      allCategoryIds={allCategoryIds}
                      gridColumnsClass={gridColumnsClass}
                      cardDisplayMode={cardDisplayMode}
                      selectionMode={selectionMode}
                      selectedIds={selectedIds}
                      siteData={siteData}
                      dragOverCustomCatId={dragOverCustomCatId}
                      setDragOverCustomCatId={setDragOverCustomCatId}
                      setAddSiteTargetCatId={setAddSiteTargetCatId}
                      setPeekItem={openPeek}
                      keyboardHintId="navhub-card-keyboard-hint"
                      toggleSelectOne={toggleSelectOne}
                      cardsPerGroup={cardsPerGroup}
                    />
                  )
                  /**
                   * 前 EAGER_CATEGORY_COUNT 个分类立即挂载，其余交给视口触发。
                   *
                   * 编辑态**不再**强制全量挂载（2026-11-08 实测修正）：一次性挂载
                   * 873 张卡片 / 42,803 个节点要 20 秒以上，DIY 面板点下去像卡死。
                   * 改为：编辑态下未挂载的分类在占位块里直接给出**分类级**操控条
                   * （上移 / 下移 / 隐藏 / 形态 / 添加站点 + 拖拽手柄），这些操作本来就
                   * 只需要 category 对象、不需要卡片子树；卡片级的钉入/置顶/编辑仍然在
                   * 用户滚到该分类、卡片真正挂载后可用。
                   *
                   * 多选态仍然强制全量：批量操作的前提是「看得见才能选」。
                   */
                  /**
                   * 新建的专属分类必须**立即挂载**：用户在 DIY 里刚点「确认创建」，
                   * 这个分类要当场出现在导航区并可就地编排（E2E diy-shared-state
                   * 的 baseline+1 断言钉的就是这条跨组件联动）。若它排在懒挂载区，
                   * 用户看不到自己刚建的东西，等于功能失效。
                   */
                  const isFreshCustom = Boolean((category as { isCustom?: boolean }).isCustom)
                  const mustMountAll = selectionMode || isFreshCustom
                  if (mustMountAll || index < EAGER_CATEGORY_COUNT) return section
                  return (
                    <LazyMountSection
                      key={category.id}
                      sectionId={category.id}
                      title={category.title}
                      count={countCategorySites(category)}
                      force={false}
                      placeholder={
                        isEditingLayout ? (
                          <section
                            id={`${category.id}-placeholder`}
                            className="group relative scroll-m-16 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-1.5 h-5 rounded-full bg-primary/60" />
                                <h2 className="text-base sm:text-xl font-bold tracking-tight text-foreground truncate">
                                  {category.title}
                                </h2>
                                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40 shrink-0">
                                  {countCategorySites(category)} 站点
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <CategoryInSituControls
                                  categoryId={category.id}
                                  title={category.title}
                                  isPinned={pinnedCategoryIds.includes(category.id)}
                                  isCustom={Boolean((category as { isCustom?: boolean }).isCustom)}
                                  canMoveUp={index > 0}
                                  canMoveDown={index < renderedCategories.length - 1}
                                  allCategoryIds={allCategoryIds}
                                  dragEnabled
                                  dragGrip={dragKit?.DiyCategoryDragGrip}
                                />
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">
                              滚动到此处即自动展开卡片；上面的操控条对整类生效，无需等待卡片加载。
                            </p>
                          </section>
                        ) : undefined
                      }
                    >
                      {section}
                    </LazyMountSection>
                  )
                })}

                {sortedCategories.length === 0 && (
                  <div className="col-span-12 text-center py-16 text-muted-foreground space-y-3">
                    <p className="text-sm">当前所有分类已被隐藏或工作台下暂无匹配站点</p>
                    <Button variant="outline" size="sm" onClick={() => setActiveWorkspace('all')}>
                      查看全部站点
                    </Button>
                  </div>
                )}
              </div>
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
                className="mb-1.5 ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
              >
                <EyeOff className="w-3 h-3" />
                <span>－ 移除站内目录</span>
              </button>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span id="home-directory-title" className="text-xs font-semibold text-foreground">
                站内目录
              </span>
              <Link href="/category" className="inline-flex items-center min-h-6 py-0.5 px-1.5 rounded-md text-xs text-primary hover:bg-primary/5 hover:underline transition-colors">
                全部分类
              </Link>
              <Link href="/sites" className="inline-flex items-center min-h-6 py-0.5 px-1.5 rounded-md text-xs text-primary hover:bg-primary/5 hover:underline transition-colors">
                全部站点
              </Link>
              <Link href="/tags" className="inline-flex items-center min-h-6 py-0.5 px-1.5 rounded-md text-xs text-primary hover:bg-primary/5 hover:underline transition-colors">
                按标签浏览
              </Link>
              {directoryLinks.length > 0 && (
                <>
                  <span aria-hidden className="hidden sm:block h-3.5 w-px bg-border" />
                  <DirectoryPillToolbar links={directoryLinks} counts={treeSiteCounts} />
                </>
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
            <HomeDIYTrigger />
          </div>
        )}
        {isEditingLayout && (
          <HomeDIYToolbar
            allCategoryIds={allCategoryIds}
            categoryTitleMap={categoryTitleMap}
            categories={sortedCategories}
            raised={selectionMode}
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
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
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
        <SitePeekDialog
          item={peek?.item ?? null}
          open={!!peek}
          onOpenChange={(open) => !open && setPeek(null)}
          onCloseAutoFocus={() => restorePeekFocus()}
          categoryId={peek?.categoryId}
          isPinnedInCategory={
            peek?.categoryId
              ? (pinnedSiteIdsByCategory[peek.categoryId] ?? []).includes(peek.item.id)
              : false
          }
          onTogglePinInCategory={
            peek?.categoryId
              ? (siteId) => togglePinSiteInCategory(peek.categoryId!, siteId)
              : undefined
          }
        />

        {/* 4.0 弹窗：内置开发者微工具抽屉 */}
        <QuickToolsDrawer open={isToolsOpen} onOpenChange={setIsToolsOpen} />

        {/* 浮动快捷导航胶囊：滚动时自动呈现「极速回顶 / 呼出超级搜索 / 打开微工具」 */}
        <FloatingQuickNav onOpenTools={() => setIsToolsOpen(true)} />

        {/* 4.0 弹窗：快捷键指南与 Maestro 监听 */}
        {/* T 键打开微工具箱的键盘入口由这里接线（若 L4 禁用了 feat:keyboard-nav 则卸载监听） */}
        {!isFeatureHidden('feat:keyboard-nav') && (
          <KeyboardShortcutsDialog
            open={isShortcutsOpen}
            onOpenChange={setIsShortcutsOpen}
            onOpenTools={() => setIsToolsOpen(true)}
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
            onBatchAddToCustomCategory={(categoryId) => {
              const usable = selectedSites.filter((site) => isSafeSiteHref(site.href))
              if (usable.length === 0) {
                toast({ title: '⚠️ 没有可收录的站点', description: '选中的站点网址不合法。' })
                return
              }
              let added = 0
              let duplicate = 0
              let failed = 0
              for (const site of usable) {
                const outcome = addSiteToCustomCategory(categoryId, {
                  id: createCustomSiteId(),
                  title: site.title,
                  href: site.href,
                  description: site.description,
                })
                if (outcome === 'added') added++
                else if (outcome === 'duplicate') duplicate++
                else failed++
              }
              // 批量路径同样不能只说好话：失败与重复要如实计数
              if (failed > 0) {
                toast({
                  title: `只收录了 ${added} 个`,
                  description: `${failed} 个没能写入本地存储（隐私模式或空间已满），刷新后会丢失；${duplicate} 个已在分类中。`,
                  variant: 'destructive',
                })
              } else if (duplicate > 0) {
                toast({
                  title: `已收录 ${added} 个站点`,
                  description: duplicate > 0 ? `另有 ${duplicate} 个已在所选分类中，未重复添加。` : undefined,
                })
              } else {
                toast({
                  title: '✨ 已收录 ' + added + ' 个站点',
                  description: '已批量加入所选专属分类。',
                })
              }
              clearSelection()
            }}
            onBatchPinToWorkbench={() => {
              let pinned = 0
              for (const site of selectedSites) {
                if (!isSafeSiteHref(site.href)) continue
                const res = pinSiteToWorkbench({
                  siteId: site.id,
                  title: site.title,
                  href: site.href,
                  icon: site.icon,
                  description: site.description,
                })
                if (res.ok) pinned++
              }
              toast(
                pinned > 0
                  ? { title: '📌 已固定 ' + pinned + ' 个站点', description: '已加入收藏与工作台启动坞。' }
                  : { title: '⚠️ 固定失败', description: '浏览器本地存储不可用，或网址不合法。' },
              )
            }}
            onBatchDeleteFromCustomCategories={() => {
              // 只处理「自定义分类里的卡片」：这些是用户自建的本地条目，删了能重建；
              // 内置站点库的条目不在这个作用域里（那是回收站/管理端的职责）。
              let removed = 0
              for (const cat of customCategories) {
                const hit = selectedSites.filter((site) =>
                  (cat.items || []).some((item) => item.id === site.id),
                )
                for (const site of hit) {
                  removeSiteFromCustomCategory(cat.id, site.id)
                  removed++
                }
              }
              toast(
                removed > 0
                  ? { title: '🗑️ 已移除 ' + removed + ' 个站点', description: '仅从你的专属分类中移除，站点库本身不受影响。' }
                  : { title: '⚠️ 没有可移除的站点', description: '所选站点都不在自定义分类里。' },
              )
            }}
          />
        )}

        {/* 自定义站点录入弹窗（懒加载：Radix Dialog 约 144 KB 不再进首屏） */}
        <AddSiteDialog
          open={!!addSiteTargetCatId}
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
      </main>
    </div>
  )
}
