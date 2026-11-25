'use client'

/**
 * 首页单个分类区块（从 navigation-content.tsx 拆出，2026-10-19 P1-2）。
 *
 * 负责分类标题、折叠/置顶/排序控件、一级与二级站点的拖拽/收录/多选。
 * 共享状态直接走 useHomeDIY()，拖拽目标等跨区块 UI 状态由父组件注入。
 */
import { useMemo, useState, useCallback, useEffect, useRef, memo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { NavigationCard } from '@/components/navigation-card'
import { CategoryInSituControls } from '@/components/category-in-situ-controls'
import { HorizontalScrollFade } from '@/components/horizontal-scroll-fade'
/**
 * 模块缩放手柄（Bundle 瘦身第三刀 a）：手柄本体约 20KB 代码，只在排版编辑态
 * 才渲染（非编辑态返回 null），平时不进 `/` 初始 chunk。`next/dynamic`
 * + `isEditingLayout &&` 门保证首屏既不渲染也不拉 chunk；进入编辑态
 * 才首次加载（约 12KB，本机 <100ms，慢速 4G 约 300–600ms）。
 * module-resize-store.ts 零改动：尺寸状态仍由父组件静态 import 使用。
 */
const ModuleResizeHandles = dynamic(
  () =>
    import('@/components/modular/module-resize-handles').then((m) => m.ModuleResizeHandles),
  { ssr: false, loading: () => null },
)
import { useModuleWindowSize } from '@/lib/modular/module-resize-store'
import { ChevronDown, Pin, Plus, Sparkles, Search, X, Link2, Network, Eye, EyeOff, RotateCcw, Check } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  computeAdaptiveSiteRanking,
  sortCategoryItemsWithPinned,
} from '@/lib/modular/diy-presets'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import type { CategoryRankingMode } from '@/lib/modular/home-diy-storage'
import { readVisitCounts, sortItemsByVisitFrequency, type VisitStats } from '@/lib/offline-recent'
import { useHomeDiyGrid } from '@/lib/modular/use-home-diy-grid'
import type { CardMoveDirection, DiyCardDragData } from '@/lib/modular/diy-drag'
import { useFeatureMask } from '@/lib/modular/feature-mask-store'
import { countCategorySites } from '@/lib/modular/category-counts'
import { observeGridColumns, resyncAllObservedGrids } from '@/lib/grid-column-observer'
import { useGridColumns } from '@/hooks/usePreviewCount'
import { previewCountForColumns } from '@/lib/preview-count'
import { CARD_GRID, CARD_BODY, CARD_DESC } from '@/lib/responsive-grid'
import {
  computePreviewCountForMode,
  getCardDisplayModeMeta,
  getGridClassForCardMode,
  normalizeCardDisplayMode,
  resolveEffectiveViewMode,
} from '@/lib/modular/card-display-modes'
import { useIsMobileViewport } from '@/components/initial-view-mode-context'
import { categoryHref } from '@/lib/seo/category-url'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '@/lib/seo/thresholds'
import { buildCategoryNameIndex, sanitizeSiteTags, isPollutedTag } from '@/lib/tag-hygiene'
import type { CardDisplayMode } from '@/lib/modular/use-home-diy'
import { useToast } from '@/components/ui/use-toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyText } from '@/lib/clipboard'
import type { CategoryNode } from '@/lib/modular/category-combine'
import type { NavigationItem, NavigationCategory, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { useExternalLinkTarget } from '@/lib/user-preferences'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'

export interface NavigationCategorySectionProps {
  category: CategoryNode | (NavigationItem & { isCustom?: boolean })
  index: number
  totalCategories: number
  allCategoryIds: string[]
  gridColumnsClass: string
  cardDisplayMode: CardDisplayMode
  selectionMode: boolean
  selectedIds: string[]
  siteData: SiteConfig
  setAddSiteTargetCatId: (id: string | null) => void
  setPeekItem: (item: NavigationSubItem | null, categoryId?: string) => void
  /** 卡片键盘操作说明的 DOM id（页面级只渲染一份） */
  keyboardHintId?: string
  toggleSelectOne: (siteId: string) => void
  /**
   * 每组（直属站点 / 每个二级分类）首屏渲染的卡片数，超出部分渐进披露。
   * <=0 或未传 = 不限制（恢复全量 SSR 的旧行为）。
   */
  cardsPerGroup?: number
  /**
   * 数字直达映射（站点 id → 数字键 1~9），由 navigation-content 的
   * buildDialMap 算出并透传：卡片角标只读它，不自己重算顺序。
   * 挂载前为 undefined（SSR 与首帧不渲染角标，避免水合分叉）。
   */
  dialDigitById?: ReadonlyMap<string, number>
  /** 全站标题索引（id → 标题）：卡片 ⋯ 菜单绑定快拨位时，报出被顶掉站点的站名 */
  siteTitleById?: ReadonlyMap<string, string>
  /** 点击左侧分类进入直达聚焦视图时，直接完整展示该分类全部子分类与全部站点（不截断折叠） */
  showCompleteContent?: boolean
  /** 点击左侧二级分类直达时，默认选中并完整展示对应子分类 */
  initialSelectedSubCatId?: string | null
  /** 子分类标签切换回调（用于同步顶部聚焦面包屑与左侧栏激活态） */
  onSubCategoryChange?: (subCatId: string | null) => void
}

/**
 * 子分类较多的分类默认只展开第一个子类（2026-11-25 首屏优化，用户拍板「默认折叠子类」）。
 *
 * 背景：「AI 工具」有 17 个子分类 96 张卡，在「全部」视图下 17 组全部平铺，单个分类区块
 * 高 4,645px（整页 42 屏）。子分类切换条（role=tablist）本来就存在，选中某个 tab 即
 * 全量展开该组——所以「默认选中第一个子类」就能把 96 卡收成一组，其余 16 组收在切换条里，
 * 不新增任何 UI，也不改数据。
 *
 * 水合安全：判定只依赖 props（category.subCategories），服务端与客户端首帧结论一致，
 * 不读 mount / 视口 / localStorage。阈值取 8：≤8 个子类的分类保持「全部」视图不变。
 * 筛选态、聚焦直达（initialSelectedSubCatId）、编辑态都不受影响——它们各自显式传值。
 *
 * 2026-11-26 孤儿行规则豁免（主聊裁决）：选中子分类后该组是全量展开的完整列表，
 * 末行不满是自然收尾，不是布局缺陷——孤儿行断言（e2e/category-block-a11y.spec.ts）
 * 只约束收起/限量 teaser 网格。组件侧用 data-grid-expanded 显式标记完整列表
 * （与 data-grid-folded 互斥）；不要为凑整倍数向下切卡片，那会藏掉真实站点。
 */
const MANY_SUBCATEGORIES_THRESHOLD = 8

function defaultSubCatIdFor(category: { subCategories?: Array<{ id: string; enabled?: boolean; items?: unknown[] }> | null }): string | null {
  const subs = category.subCategories
  if (!subs || subs.length <= MANY_SUBCATEGORIES_THRESHOLD) return null
  const first = subs.find((sub) => (sub.items?.length ?? 0) > 0 && sub.enabled !== false)
  return first ? first.id : null
}


/**
 * 分类内排序方式切换（P0-B，2026-11-26）：三种模式全是已有排序，不编造：
 *   - adaptive 自适应热度：computeAdaptiveSiteRanking（既有）；
 *   - default 站内综合：sortCategoryItemsWithPinned（既有，置顶优先 + 收录次序）；
 *   - frequent 我的常用：sortItemsByVisitFrequency（本机点击次数，既有数据）。
 * 「最新收录」不在此列：首页 navigation.json 子项无收录日期字段、首页不取
 * 中枢数据，该模式没有可排的数据，硬上就是假功能（见 diy-presets 注释）。
 */
export const RANKING_MODE_OPTIONS: ReadonlyArray<{
  id: CategoryRankingMode
  label: string
  hint: string
}> = [
  { id: 'adaptive', label: '自适应热度', hint: '按热度与趋势加权' },
  { id: 'default', label: '站内综合', hint: '置顶优先，其余按收录次序' },
  { id: 'frequent', label: '我的常用', hint: '按本机点击次数排序' },
]

export function sortCategoryItemsByMode<T extends { id: string }>(
  items: T[],
  pinnedItemIds: string[],
  mode: CategoryRankingMode,
  visitStats: Readonly<Record<string, VisitStats>> = {},
): T[] {
  if (mode === 'adaptive') return computeAdaptiveSiteRanking(items, { pinnedItemIds })
  if (mode === 'frequent') return sortItemsByVisitFrequency(items, visitStats, pinnedItemIds)
  return sortCategoryItemsWithPinned(items, pinnedItemIds)
}


export const NavigationCategorySection = memo(function NavigationCategorySection({
  category,
  index,
  totalCategories,
  allCategoryIds,
  gridColumnsClass: _gridColumnsClass,
  cardDisplayMode,
  selectionMode,
  selectedIds,
  siteData,
  setAddSiteTargetCatId,
  setPeekItem,
  keyboardHintId,
  toggleSelectOne,
  cardsPerGroup = 0,
  dialDigitById,
  siteTitleById,
  showCompleteContent = false,
  initialSelectedSubCatId = null,
  onSubCategoryChange,
}: NavigationCategorySectionProps) {
  const { toast } = useToast()
  const {
    mounted,
    isEditingLayout,
    rankingMode,
    setRankingMode,
    categoryOrder,
    pinnedCategoryIds,
    hiddenCategoryIds,
    unhideCategory,
    categoryDensityOverrides,
    collapsedCategoryIds,
    pinnedSiteIdsByCategory,
    togglePinSiteInCategory,
    toggleCollapseCategory,
    speedDialPinnedIds,
    pinToSpeedDial,
    unpinFromSpeedDial,
    quickDialSlots,
  } = useHomeDIY()

  // 「我的常用」排序用的本机点击次数（P0-B）：localStorage 同步读，SSR 下为空对象；
  // 只在该模式下才读（其余模式不碰存储），窗口获焦时重读（与速览坞同口径，
  // 点开站点回来后次数已变）。首帧与 SSR 一致（空表 = 置顶优先原序），
  // 挂载后读到真实次数再重排，不产生水合分叉。
  const [visitStats, setVisitStats] = useState<Readonly<Record<string, VisitStats>>>({})
  useEffect(() => {
    if (rankingMode !== 'frequent') return
    const sync = () => setVisitStats(readVisitCounts())
    sync()
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [rankingMode])

  /** 自定义快拨位反查（站点 id → Ctrl+Shift+数字）：卡片 aria-keyshortcuts 用 */
  const quickDigitBySiteId = useMemo(() => {
    const map = new Map<string, string>()
    for (const [digit, siteId] of Object.entries(quickDialSlots || {})) {
      if (typeof siteId === 'string' && siteId && !map.has(siteId)) map.set(siteId, digit)
    }
    return map
  }, [quickDialSlots])

  /**
   * 网格 hook：卡片 ⋯ 菜单的移动走这里（置顶列表重排，不改其它文件）。
   * 分类网格坐标本身目前只作读时派生（gridLayout 未直接渲染）——
   * 分类区块是通栏 section，RGL 的二维坐标对它没有增益；
   * 网格模型真正落地在模块化画布（DiyRglGrid）。
   */
  const { moveCard } = useHomeDiyGrid(allCategoryIds)

  /**
   * dnd-kit 重型层（~133KB）：仅在进入 DIY 排版编辑态时按需动态 import，
   * 普通浏览态零下载、零水合后额外 setState 重渲染。
   */
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

  /** dnd-kit 落点高亮（本区块正被卡片悬停）：复用旧的高亮条样式 */
  const [isCategoryDropTarget, setIsCategoryDropTarget] = useState(false)
  const {
    isCategoryHidden,
    isSubcategoryHidden,
    isSiteHidden,
    bypassMaskTemporarily,
    removeFeature,
    restoreFeature,
  } = useFeatureMask()

  const linkTarget = useExternalLinkTarget(siteData?.navigation?.linkTarget)
  const siteViewModel = useSiteViewModel()
  const externalRel = externalLinkRelAttr(siteViewModel?.externalLinkRel)

  const speedDialPinnedSet = useMemo(
    () => new Set(speedDialPinnedIds || []),
    [speedDialPinnedIds]
  )

  const handleToggleSpeedDialPin = useCallback(
    (siteId: string) => {
      if (speedDialPinnedSet.has(siteId)) {
        unpinFromSpeedDial(siteId)
      } else {
        pinToSpeedDial(siteId)
      }
    },
    [speedDialPinnedSet, pinToSpeedDial, unpinFromSpeedDial]
  )

  const sectionRef = useRef<HTMLElement | null>(null)
  const isResizingModuleRef = useRef(false)
  const [isResizingSelf, setIsResizingSelf] = useState(false)
  const {
    colSpan: moduleColSpan,
    heightPx: moduleHeightPx,
    isCustomSized: isModuleCustomSized,
    setSize: setModuleSize,
    resetSize: resetModuleSize,
  } = useModuleWindowSize(`cat:${category.id}`, { colSpan: 12 })

  const sectionColSpanClass = {
    4: 'col-span-12 lg:col-span-4',
    5: 'col-span-12 lg:col-span-5',
    6: 'col-span-12 lg:col-span-6',
    7: 'col-span-12 lg:col-span-7',
    8: 'col-span-12 lg:col-span-8',
    9: 'col-span-12 lg:col-span-9',
    10: 'col-span-12 lg:col-span-10',
    11: 'col-span-12 lg:col-span-11',
    12: 'col-span-12',
  }[moduleColSpan] || 'col-span-12'

  /** 网格 DOM 引用（供 useGridColumns 读 data-grid-cols；见 previewLimit）。 */
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null)

  const isMobileViewport = useIsMobileViewport()
  const isPinned = pinnedCategoryIds.includes(category.id)
  const isCustom = Boolean(category.isCustom)
  const isCollapsed = collapsedCategoryIds.includes(category.id)
  const rawCategoryCardMode = categoryDensityOverrides?.[category.id] || cardDisplayMode
  const normalizedCardMode = mounted
    ? resolveEffectiveViewMode(rawCategoryCardMode, isMobileViewport)
    : normalizeCardDisplayMode(rawCategoryCardMode)
  const effectiveCardMode = normalizedCardMode
  const effectiveCardModeMeta = getCardDisplayModeMeta(effectiveCardMode)
  /**
   * 把网格的**真实列数**写成 data-grid-cols，供 previewLimit 按当前展示模式整行切片。
   * 仅在尚未绑定或旧节点已卸载时更新 gridEl，确保始终锚定该分类首个（顶部可见）网格，
   * 避免被末尾视口外子分组反复覆盖。
   */
  const gridColumnRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    setGridEl((prev) => (prev && prev.isConnected ? prev : el))
    return observeGridColumns(el)
  }, [])

  /**
   * 折叠态预览张数（统一 19 大类同口径）：由真实列数 + 当前展示模式配置统一算出，
   * 始终是列数的精确整倍数（0 孤儿行），并受模式上限约束防止宽屏无谓 DOM 膨胀。
   */
  const gridCols = useGridColumns(gridEl)
  const previewLimit = gridCols > 0 ? computePreviewCountForMode(effectiveCardMode, gridCols) : cardsPerGroup

  /**
   * 卡片网格列数（2026-11-21 P0 重写）。
   *
   * 上一版用的是 `grid-cols-[repeat(auto-fill,minmax(240px,1fr))]`，实测**全线失效**：
   * 1024/1280/1440/1920 四档 computed gridTemplateColumns 都是单列（卡片宽度
   * 等于容器整宽 704–1600px）。原因是 Tailwind 任意值语法里裸逗号不合法——
   * 类名没被生成，grid 退回默认单列。这就是「桌面端单列巨卡」的根因。
   *
   * 改用 Tailwind v4 原生容器查询（外层 <main> 已加 @container / container-type:
   * inline-size）。用容器而不是视口断点，是因为左侧栏可拖拽：同一 1280px 视口下
   * 侧栏 210px 与 320px 的主区差 110px，按视口断点只能给同一个列数。
   *
   * 阈值按主区真实宽度标定（gap 16px）：
   *   <560px  → 1 列
   *   ≥560px  → 2 列   （@2xl = 42rem = 672px 是最近的安全档，见下）
   *   ≥960px  → 3 列   （@5xl = 64rem = 1024px）
   *   ≥1280px → 4 列   （@7xl = 80rem = 1280px）
   * 三档衔接后，1024 视口（主区 ~800px）落 2 列、1280 视口（~960px）落 3 列、
   * 1440 视口（~1120px）3 列、1920 视口（~1600px）4 列——与验收要求一致。
   *
   * 窄模块（DIY 里被拖窄到 moduleColSpan ≤ 9）仍强制减列防挤压，但同样走容器查询。
   */
  const effectiveGridClass = useMemo(() => {
    if (normalizedCardMode === 'standard' && moduleColSpan > 9) {
      return CARD_GRID
    }
    return getGridClassForCardMode(normalizedCardMode, moduleColSpan)
  }, [normalizedCardMode, moduleColSpan])

  // 切换网址展示模式或模块列宽时容器物理宽度未变，ResizeObserver 不会触发；
  // 主动重算一次 data-grid-cols，保证预览张数立即按新列数切满整行。
  useEffect(() => {
    resyncAllObservedGrids()
    const rafId = window.requestAnimationFrame(() => resyncAllObservedGrids())
    return () => window.cancelAnimationFrame(rafId)
  }, [effectiveGridClass])
  const directItems = useMemo(
    () =>
      ((category.items || []) as NavigationSubItem[]).filter(
        (item) => bypassMaskTemporarily || !isSiteHidden(item.id)
      ),
    [category.items, bypassMaskTemporarily, isSiteHidden]
  )
  const subCats = useMemo(
    () => {
      const list = ((category.subCategories || []) as Array<NavigationCategory & { items?: NavigationSubItem[] }>).filter(
        (sub) => bypassMaskTemporarily || !isSubcategoryHidden(sub.id)
      )
      // 子分类顺序读 flat categoryOrder（与顶级分类同一份列表）：只比同级
      // 之间的相对位置，列表里没有的保持上游原序（stable sort + 0 兜底，
      // 与 category-combine 顶级排序同一口径）。写侧是 ↑/↓ 与拖拽
      //（moveCategory / reorderCategory），本来就往这份 flat 列表里写。
      if (categoryOrder.length === 0) return list
      return [...list].sort((a, b) => {
        const aIdx = categoryOrder.indexOf(a.id)
        const bIdx = categoryOrder.indexOf(b.id)
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
        if (aIdx !== -1) return -1
        if (bIdx !== -1) return 1
        return 0
      })
    },
    [category.subCategories, bypassMaskTemporarily, isSubcategoryHidden, categoryOrder]
  )
  /**
   * 卡片标签清洗用的分类名集合（运行时从当前分类树派生，不硬编码分类名）。
   * 数据里存在大量「把一级/二级分类名又写进 tags」的复读项，
   * 以及跨站点误打的泛化标签，会挤掉每张卡仅有的 2~3 个检索位。
   */
  const categoryNameIndex = useMemo(
    () => buildCategoryNameIndex(category.title, subCats.map((s) => s.title)),
    [category.title, subCats]
  )
  const totalCount = countCategorySites(category)
  /**
   * 标题是否链到分类页（升级第 3 条）：
   * - 自建分类只活在本机，中枢没有它的分类页，链过去必 404；
   * - 聚合 < MIN_SITES_FOR_CATEGORY_INDEX 站的分类页本身 404（`[slug]/page.tsx`），
   *   链过去也是死链。两种情况标题保持纯文本，只在标题旁留折叠按钮。
   * 其余内置分类用 categoryHref：有 slug 走 slug，没有退回 id，分类页按
   * `id ∪ slug` 匹配，都能接住。
   */
  const categoryContentId = `${category.id}-content`
  const canVisitCategoryPage = !isCustom && totalCount >= MIN_SITES_FOR_CATEGORY_INDEX
  const categoryPinnedItemIds = pinnedSiteIdsByCategory[category.id] || []
  /**
   * 排序结果必须缓存：拖拽过程中落点高亮（isCategoryDropTarget）每次
   * 悬停变化都会让本区块重渲染，这里若每帧重排整个分类（几十~上百条），
   * 主线程会被排序吃满，拖拽明显掉帧。
   */
  const sortedDirectItems = useMemo(
    () => sortCategoryItemsByMode(directItems, categoryPinnedItemIds, rankingMode, visitStats),
    [directItems, categoryPinnedItemIds, rankingMode, visitStats]
  )

  /**
   * 选中态查找用 Set：`.includes()` 是 O(n)，而它对**每张卡片**都要跑一次，
   * 整体退化成 O(卡片数 × 选中数)。全选上千条时这一项就能占掉整帧预算。
   */
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])

  /** 二级分类的排序同样缓存（原来写在 render 的 map 回调里，每帧重算） */
  const sortedSubCategories = useMemo(
    () =>
      subCats.map((subCategory) => {
        const subPinnedItemIds = pinnedSiteIdsByCategory[subCategory.id] || []
        const subItems = ((subCategory.items || []) as NavigationSubItem[]).filter(
          (item) => bypassMaskTemporarily || !isSiteHidden(item.id)
        )
        return {
          subCategory,
          subPinnedItemIds,
          sortedSubItems: sortCategoryItemsByMode(subItems, subPinnedItemIds, rankingMode, visitStats),
        }
      }),
    [subCats, pinnedSiteIdsByCategory, rankingMode, visitStats, bypassMaskTemporarily, isSiteHidden]
  )

  /**
   * 渐进披露（首页 HTML 预算，2026-10-26）。
   *
   * 背景：首页把全部站点卡片一次性 SSR 进 HTML，实测 1008 张卡、未压缩 6.9MB，
   * 而项目哨兵 scripts/html-budget.mjs 的预算是 4096KB。单卡约 6.2KB，其中 class
   * 属性 3.0KB、内联 SVG 1.9KB —— 靠「精简卡片」省不出预算，只能减少首屏卡数。
   *
   * 折中：每组只 SSR 前 N 张，其余点「展开全部」在**客户端即时**揭示。
   * 数据本来就在 props 里（RSC 序列化只占 0.4MB），展开不发请求、没有加载态；
   * 初始态服务端与客户端一致（都收起），不产生 hydration 分叉。
   */
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  /* 2026-11-21：limit 改由「真实列数 × 2」决定（见 previewLimit）。
     未挂载/列数未知时退回服务端注入的 cardsPerGroup，保证 SSR 与水合首帧一致。 */
  const limit = previewLimit > 0 ? previewLimit : Number.POSITIVE_INFINITY
  /**
   * 是否解除「每组只渲染前 N 张」的截断。
   *
   * 2026-11-08 修正：原为 `isEditingLayout || selectionMode`。实测发现编辑态下
   * 一旦解除截断，两个已挂载分类就会展开成 634 张卡片 / 33,241 个 DOM 节点，
   * 进入 DIY 面板要等 3 秒以上（叠加分类级懒挂载后仍然重）。
   *
   * 现在编辑态**保留截断**：被折叠的卡由每组自带的「展开全部 N 个」按钮揭示——
   * 那个按钮本来就在编辑态可用，功能没有丢，只是不再默认一次性铺开。
   * 多选态仍然解除：批量操作的前提是「看得见才能选」。
   */
  const forceFull = selectionMode || Boolean(showCompleteContent)

  // 类目内秒级精准筛选状态
  const [filterKeyword, setFilterKeyword] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [selectedSubCatId, setSelectedSubCatId] = useState<string | null>(
    initialSelectedSubCatId ?? defaultSubCatIdFor(category),
  )
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  useEffect(() => {
    setSelectedSubCatId(initialSelectedSubCatId ?? defaultSubCatIdFor(category))
  }, [initialSelectedSubCatId, category])

  const handleSelectSubCat = useCallback(
    (nextSubCatId: string | null) => {
      setSelectedSubCatId(nextSubCatId)
      onSubCategoryChange?.(nextSubCatId)
    },
    [onSubCategoryChange],
  )
  /**
   * 热门标签工具的 roving tabindex 游标（2026-11-09 首页 Tab 停留点收敛）。
   *
   * 每个分类 5 个标签按钮如果都可 Tab，两个已挂载分类就是 10 个停留点，
   * 而它们只是同一组互斥筛选。改成 WAI-ARIA `toolbar` + roving：
   * 整组只保留 1 个 Tab 停留点，组内用 ←/→/Home/End 移动。
   */
  const [tagFocusIndex, setTagFocusIndex] = useState(0)

  // 提取类目内的常见热门标签
  const categoryTopTags = useMemo(() => {
    const tagCounts = new Map<string, number>()
    const collectTags = (items?: any[]) => {
      if (!Array.isArray(items)) return
      for (const item of items) {
        if (Array.isArray(item.tags)) {
          for (const t of item.tags) {
            if (typeof t === 'string' && t.trim()) {
              const tag = t.trim()
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
            }
          }
        }
      }
    }
    collectTags(category.items)
    if (Array.isArray(category.subCategories)) {
      for (const sub of category.subCategories) {
        collectTags(sub.items)
      }
    }
    return Array.from(tagCounts.entries())
      // 分类头的热门标签条是筛选入口，但展示分类名复读（#ai-工具 / #前端开发）
      // 和泛化误打标签（#ai赋能）没有筛选价值，与卡片标签共用同一套清洗规则。
      .filter(([tag, count]) => count >= 2 && !isPollutedTag(tag, categoryNameIndex))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag)
  }, [category.items, category.subCategories, categoryNameIndex])

  const matchesFilter = useCallback((item: any) => {
    if (selectedTag) {
      if (!Array.isArray(item.tags) || !item.tags.includes(selectedTag)) {
        return false
      }
    }
    const kw = filterKeyword.trim().toLowerCase()
    if (!kw) return true
    const titleMatch = typeof item.title === 'string' && item.title.toLowerCase().includes(kw)
    const descMatch = typeof item.description === 'string' && item.description.toLowerCase().includes(kw)
    const hrefMatch = typeof item.href === 'string' && item.href.toLowerCase().includes(kw)
    const tagMatch = Array.isArray(item.tags) && item.tags.some((t: string) => typeof t === 'string' && t.toLowerCase().includes(kw))
    return titleMatch || descMatch || hrefMatch || tagMatch
  }, [filterKeyword, selectedTag])

  const isFilterActive = Boolean(filterKeyword.trim() || selectedTag)

  const filteredDirectItems = useMemo(() => {
    if (!isFilterActive) return sortedDirectItems
    return sortedDirectItems.filter(matchesFilter)
  }, [sortedDirectItems, isFilterActive, matchesFilter])

  const filteredSubCategories = useMemo(() => {
    return sortedSubCategories.map((entry) => {
      const filtered = isFilterActive
        ? entry.sortedSubItems.filter(matchesFilter)
        : entry.sortedSubItems
      return {
        ...entry,
        filteredSubItems: filtered,
      }
    }).filter((entry) => isEditingLayout || entry.filteredSubItems.length > 0)
  }, [sortedSubCategories, isFilterActive, matchesFilter, isEditingLayout])

  const showDirectGroup = selectedSubCatId === null || selectedSubCatId === '__direct__'

  const directGroup = useMemo(() => {
    const all = filteredDirectItems
    if (forceFull || isFilterActive || expandedGroups.__direct__ || all.length <= limit) return { items: all }
    return { items: all.slice(0, limit) }
  }, [filteredDirectItems, forceFull, isFilterActive, expandedGroups, limit])

  /** 直属组当前显示的卡片 id（⋯ 菜单移动的基准列表） */
  const directDisplayedIds = useMemo(
    () => directGroup.items.map((item) => item.id),
    [directGroup.items],
  )

  const subGroups = useMemo(
    () => {
      const activeList = selectedSubCatId === '__direct__'
        ? []
        : selectedSubCatId
          ? filteredSubCategories.filter((entry) => entry.subCategory.id === selectedSubCatId)
          : filteredSubCategories

      return activeList.map((entry) => {
        const all = entry.filteredSubItems
        /**
         * 2026-11-09：选中某个子分类 tab 时直接全量展开。
         *
         * 这就是「区块级跳转」的键盘出口——子分类 tab 是 roving 的 1 个停留点，
         * 用 ←/→ 选中即看到该子分类的全部站点，不必再 Tab 到每个分组的
         * 「展开全部 N 个」。只有「全部」视图仍保留逐组截断。
         */
        const expanded = forceFull || isFilterActive || selectedSubCatId !== null || Boolean(expandedGroups[entry.subCategory.id])
        const items = expanded || all.length <= limit ? all : all.slice(0, limit)
        /** 该子分类组当前显示的卡片 id（⋯ 菜单移动的基准列表） */
        const displayedIds = items.map((item) => item.id)
        return {
          ...entry,
          items,
          displayedIds,
          /**
           * P0-2：每组三个稳定回调——与直属组的 handle*Direct 对等。
           * 原先调用点用内联闭包（(siteId) => togglePinSiteInCategory(subId, siteId)），
           * 每轮新建身份击穿 memo 卡片。放进 memo 后，回调身份只随组数据变而变；
           * moveCard / togglePinSiteInCategory / setPeekItem 均为稳定引用（见依赖）。
           */
          onTogglePin: (siteId: string) => togglePinSiteInCategory(entry.subCategory.id, siteId),
          onPeek: (peekItem: NavigationSubItem) => setPeekItem(peekItem, entry.subCategory.id),
          onMoveCard: (cardId: string, direction: CardMoveDirection) =>
            moveCard(entry.subCategory.id, displayedIds, cardId, direction),
        }
      })
    },
    [filteredSubCategories, selectedSubCatId, forceFull, isFilterActive, expandedGroups, limit, moveCard, togglePinSiteInCategory, setPeekItem]
  )

  const totalMatchedCount = useMemo(() => {
    if (!isFilterActive && !selectedSubCatId) return totalCount
    const directMatched = showDirectGroup ? filteredDirectItems.length : 0
    const subMatched = subGroups.reduce((acc, sub) => acc + sub.filteredSubItems.length, 0)
    return directMatched + subMatched
  }, [isFilterActive, selectedSubCatId, totalCount, showDirectGroup, filteredDirectItems.length, subGroups])

  /**
   * 「展开全部 / 收起」开关。占满整行（col-span-full），避免在半行末尾留空。
   * 只在「确实被截断」的组出现；切到排版/多选模式时整组直接全量展示，开关隐藏。
   *
   * 2026-11-09：子分类 tab 轨在场的分类里，本开关移出 Tab 序列（`tabIndex=-1`），
   * 鼠标点击照旧；键盘用户走上面的 roving tab 轨选中子分类即可看到该组全部站点。
   * 这样每个分类最多留下 1 个「展开全部」停留点，而不是十几个分组各一个。
   * 没有 tab 轨（子分类 ≤1）的分类保持可聚焦，不为省停留点牺牲可用性。
   */
  const renderGroupToggle = (key: string, total: number) => {
    if (forceFull || !Number.isFinite(limit) || total <= limit) return null
    const expanded = Boolean(expandedGroups[key])
    const hasSubCatRail = !isEditingLayout && subCats.length > 1
    return (
      <button
        type="button"
        tabIndex={hasSubCatRail ? -1 : 0}
        onClick={() => setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))}
        aria-expanded={expanded}
        data-group-toggle={key}
        title={hasSubCatRail ? '键盘用户可用上方子分类切换查看该组全部站点' : undefined}
        className="col-span-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 hover:bg-primary/5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/30 transition-all cursor-pointer"
      >
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
        <span>{expanded ? '收起' : `展开全部 ${total} 个`}</span>
      </button>
    )
  }

  // 当从外链携带 #category.id 锚点进入时，若当前分类处于折叠态则自动展开
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === `#${category.id}` && isCollapsed) {
      toggleCollapseCategory(category.id)
    }
  }, [category.id, isCollapsed, toggleCollapseCategory])

  const handleCopyCategoryLink = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}${window.location.pathname}#${category.id}`
    const res = await copyText(url)
    if (res.ok) {
      window.history.replaceState(null, '', `#${category.id}`)
      toast({
        title: '已复制分类直达链接',
        description: `「${category.title}」锚点链接已复制到剪贴板`,
      })
    } else {
      toast({
        title: '复制链接失败',
        description: res.reason,
        variant: 'destructive',
      })
    }
  }

  const handlePeekDirect = useCallback(
    (item: NavigationSubItem) => setPeekItem(item, category.id),
    [setPeekItem, category.id]
  )
  const handleTogglePinDirect = useCallback(
    (siteId: string) => togglePinSiteInCategory(category.id, siteId),
    [togglePinSiteInCategory, category.id]
  )
  /**
   * P0-2：直属组的稳定移动回调——卡片把自己的 id 带上（onMoveCard(cardId, direction)），
   * 这里只依赖 memo 化的 directDisplayedIds 与稳定的 moveCard，不再每轮新建闭包。
   */
  const handleMoveCardDirect = useCallback(
    (cardId: string, direction: CardMoveDirection) =>
      moveCard(category.id, directDisplayedIds, cardId, direction),
    [moveCard, category.id, directDisplayedIds]
  )

  /**
   * 卡片渲染（含编辑态的 dnd-kit 可拖拽包装）。
   *
   * 包装器只在「编辑态 + 重型层已加载」时出现：平时卡片就是普通卡片，
   * 首屏不付 dnd-kit 的包体；编辑态下每张卡外面多一个 div（grid item），
   * 手柄经 context 交给卡片里的 grip 按钮。
   * ⋯ 菜单的移动走 use-home-diy-grid（置顶列表重排），与拖拽无关，
   * 所以菜单在重型层加载失败时照样能用。
   */
  const renderSiteCard = (
    item: NavigationSubItem,
    opts: {
      sourceCategoryId: string
      pinnedIds: string[]
      onTogglePin: (siteId: string) => void
      onPeek: (item: NavigationSubItem) => void
      displayedIds: string[]
      index: number
      /** P0-2：每组稳定移动回调（直属组 handleMoveCardDirect / 子组 memo 内 onMoveCard），卡片自带 id 调用 */
      onMoveCard: (cardId: string, direction: CardMoveDirection) => void
    },
  ) => {
    const node = (
      <NavigationCard
        key={item.id}
        item={sanitizeSiteTags(item, categoryNameIndex)}
        siteConfig={siteData}
        onPeek={opts.onPeek}
        keyboardHintId={keyboardHintId}
        cardDisplayMode={effectiveCardMode}
        isPinnedInCategory={opts.pinnedIds.includes(item.id)}
        onTogglePinInCategory={opts.onTogglePin}
        isDraggable={isEditingLayout}
        sourceCategoryId={opts.sourceCategoryId}
        selectable={selectionMode}
        selected={selectedIdSet.has(item.id)}
        onToggleSelect={toggleSelectOne}
        isEditingLayout={isEditingLayout}
        isSpeedDialPinned={speedDialPinnedSet.has(item.id)}
        onToggleSpeedDialPin={handleToggleSpeedDialPin}
        linkTarget={linkTarget}
        externalRel={externalRel}
        onMoveCard={opts.onMoveCard}
        cardIndex={opts.index}
        cardTotal={opts.displayedIds.length}
        dialDigit={dialDigitById?.get(item.id)}
        quickDialDigit={quickDigitBySiteId.get(item.id)}
        siteTitleById={siteTitleById}
      />
    )
    if (!isEditingLayout || !dragKit) return node
    const { DiyDraggableCard } = dragKit
    const dragData: DiyCardDragData = {
      kind: 'card',
      siteId: item.id,
      title: item.title,
      href: item.href,
      description: item.description,
      icon: item.icon,
      sourceCategoryId: opts.sourceCategoryId,
    }
    return (
      <DiyDraggableCard key={item.id} data={dragData}>
        {node}
      </DiyDraggableCard>
    )
  }

  const isHidden =
    !bypassMaskTemporarily &&
    (hiddenCategoryIds?.includes(category.id) || isCategoryHidden(category.id))
  if (isHidden) {
    if (!isEditingLayout) return null
    return (
      // 已隐藏分类的编辑态占位行：不做半透明处理——行里有「恢复显示」活按钮，
      // 半透明 + 活按钮是 WCAG 1.4.3（对比度）与 2.4.7 的双重问题；隐藏状态
      // 已由虚线边框 + 柔和底色 +「(已隐藏)」标签 + EyeOff 图标表达够了。
      <div
        key={category.id}
        id={category.id}
        className="col-span-12 my-1 flex items-center justify-between rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-2.5 backdrop-blur-xs transition-all"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <EyeOff className="w-4 h-4 text-amber-500" />
          <span>{category.title}</span>
          <span className="text-[10px] text-amber-700 dark:text-amber-400 font-mono">(已隐藏)</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              unhideCategory(category.id)
              restoreFeature(`cat:${category.id}`)
              toast({ title: `已恢复显示分类: ${category.title}` })
            }}
            className="min-h-11 px-2.5 text-xs rounded-lg gap-1 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>恢复显示</span>
          </Button>
        </div>
      </div>
    )
  }

  const sectionClassName = cn(
    "cv-auto-section group relative scroll-m-16",
    isResizingSelf ? "transition-none! select-none!" : "transition-all duration-200",
    sectionColSpanClass,
    isModuleCustomSized && !isPinned && !isEditingLayout && "p-3 sm:p-4 rounded-2xl border border-border/70 bg-card/35 backdrop-blur-xs shadow-2xs",
    isPinned && "p-3 sm:p-4 rounded-2xl bg-primary/3 border border-primary/20 depth-surface",
    isEditingLayout && "p-3 sm:p-4 rounded-2xl border-2 border-dashed border-primary/30 bg-muted/20",
    isCategoryDropTarget && "ring-2 ring-emerald-500 bg-emerald-500/10 rounded-2xl border-emerald-500/60"
  )

  /**
   * HTML5 DnD 已移除（DRAG-2）：section 上的原生拖拽处理在触屏上
   * 根本不触发，也没有键盘路径，解析失败还静默吞错。
   * 卡片跨分类拖拽改走 dnd-kit（DiyDragProvider 由 coordinator 接在
   * navigation-content，落点处理在 diy-drag-kit）；本区块在编辑态
   * 通过 DiyCategoryDropTarget 把 section 本身注册为落点。
   * 分类拖拽源同样已是 dnd-kit：category-in-situ-controls 里的手柄
   * 是 DiyCategoryDragGrip（useDraggable，dnd-kit chunk 加载后传入），
   * 落下后 navigation-content 的 handleCategoryDragEnd 调
   * moveCategoryToIndex 重排。子分类的手柄也是它（只在同一父分类内
   * 重排，落点是父级 section，见下面二级分类处与 handleCategoryDragEnd
   * 的子分类分支）。
   */
  const sectionInner = (
    <>
                      {/* 四向边框与双下角自由拖拉调整模块窗口大小手柄 */}
                      {isEditingLayout && (
                        <ModuleResizeHandles
                          moduleRef={sectionRef}
                          colSpan={moduleColSpan}
                          minColSpan={4}
                          maxColSpan={12}
                          heightPx={moduleHeightPx}
                          minHeightPx={220}
                          maxHeightPx={1200}
                          isEditing={isEditingLayout}
                          onResizingStateChange={(resizing) => {
                            isResizingModuleRef.current = resizing
                            setIsResizingSelf(resizing)
                          }}
                          onResizeChange={(next, isCommit) => {
                            setModuleSize(next, isCommit ?? false)
                          }}
                          onReset={() => {
                            resetModuleSize()
                            toast({
                              title: `🔄 已重置「${category.title}」窗口大小`,
                              description: '模块已恢复默认全宽（12 列）与自适应高度。',
                            })
                          }}
                        />
                      )}

                      {/* 卡片拖拽落点引导条：文案按目标类型区分——自定义分类是收录，
                          内置分类是重归类（编辑态），别把重归类说成「收录至专属分类」。
                          卡片拖拽不排位置（见 diy-drag.ts resolveCardDrop），这里只说
                          收录/重归类，不说放第几个。 */}
                      {isCategoryDropTarget && (
                        <div className="mb-3 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500/15 border-2 border-dashed border-emerald-500 text-emerald-700 dark:text-emerald-400 font-semibold text-xs animate-in zoom-in-95 duration-150">
                          <Sparkles className="w-4 h-4 animate-bounce" />
                          <span>
                            {isCustom
                              ? `松开鼠标，直接收录卡片至「${category.title}」专属分类`
                              : `松开鼠标，将卡片重归类至「${category.title}」分类`}
                          </span>
                        </div>
                      )}

                      {/* 2026-11-21 首屏压缩：块内 spacing 4→2、标题行 pb-3 → pb-1.5、
                          标题字号 xl → lg、折叠按钮 44 → 28px（触摸热区靠 ::before 保住）。 */}
                      <div className="space-y-2">
                        {/* 一级分类标题头 */}
                        <div className="flex items-center justify-between pb-1 border-b border-border/50">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* 手风琴折叠展开按钮（单分类直达聚焦完整展示态不显示无意义的折叠按钮） */}
                            {!showCompleteContent && (
                              <button
                                type="button"
                                onClick={() => toggleCollapseCategory(category.id)}
                                /* 视觉 28px，::before 扩 44px 触摸热区——视觉变小不拿可用性换。 */
                                className="relative -ml-1 flex h-7 w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-all before:absolute before:-inset-2 before:content-[''] hover:bg-muted/80 hover:text-foreground cursor-pointer"
                                title={isCollapsed ? `展开「${category.title}」` : `收起「${category.title}」`}
                                aria-label={isCollapsed ? `展开「${category.title}」` : `收起「${category.title}」`}
                                aria-expanded={!isCollapsed}
                                aria-controls={categoryContentId}
                              >
                                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isCollapsed && "-rotate-90")} />
                              </button>
                            )}

                            <span className={cn(
                              "w-1.5 h-5 rounded-full",
                              isCustom ? "bg-emerald-500" : isPinned ? "bg-amber-500" : "bg-primary"
                            )} />
                            <h2
                              className="text-base sm:text-lg font-bold tracking-tight text-foreground flex flex-wrap items-center gap-1.5 select-none"
                            >
                              {canVisitCategoryPage ? (
                                <Link
                                  href={categoryHref(category)}
                                  prefetch={false}
                                  className="hover:text-primary hover:underline underline-offset-4 decoration-primary/40 transition-colors"
                                  title={`查看「${category.title}」分类全部站点`}
                                >
                                  {category.title}
                                </Link>
                              ) : (
                                <span>{category.title}</span>
                              )}
                              {isPinned && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-medium">
                                  <Pin className="w-2.5 h-2.5 fill-amber-500" />
                                  <span>已置顶</span>
                                </span>
                              )}
                              {isCustom && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>专属私人</span>
                                </span>
                              )}
                            </h2>
                            {/* P0-B（2026-11-26）：排序方式胶囊下拉——旧胶囊只在自适应开启时
                                出现（bg-violet-500/10 + text-violet-700，11px 单色字在 /10 底
                                上发灰难辨），现常驻为模式切换器。配色改低饱和描边样式：
                                翠绿半透明底 bg-emerald-500/15 + 高亮文字 text-emerald-800 /
                                dark:text-emerald-300，实测对比度浅色 6.69:1、深色 10.35:1，
                                均达 WCAG AA（4.5:1）；描边 border-emerald-600/40。
                                三个选项全是已有排序（见文件头 sortCategoryItemsByMode 注释），
                                「最新收录」无数据不设。
                                位置注意：必须放在 h2 之外——category-section-link 守卫禁 h2 内
                                出现 onClick（标题不得是折叠开关），下拉项的 onClick 在 h2 内
                                会撞该守卫；放标题旁同行 flex 容器里，视觉同一行不变。 */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`分类内排序方式：${RANKING_MODE_OPTIONS.find((o) => o.id === rankingMode)?.label ?? '站内综合'}，点击切换排序方式`}
                                  className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-mono font-medium text-emerald-800 hover:bg-emerald-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300 cursor-pointer"
                                >
                                  <Sparkles className="h-2.5 w-2.5" />
                                  <span>{RANKING_MODE_OPTIONS.find((o) => o.id === rankingMode)?.label ?? '站内综合'}</span>
                                  <ChevronDown className="h-2.5 w-2.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-56 bg-popover text-popover-foreground border border-border shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
                              >
                                <DropdownMenuLabel className="text-[11px] text-muted-foreground font-semibold px-2 py-1">
                                  分类内排序方式
                                </DropdownMenuLabel>
                                {RANKING_MODE_OPTIONS.map((opt) => (
                                  <DropdownMenuItem
                                    key={opt.id}
                                    onClick={() => setRankingMode(opt.id)}
                                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent"
                                  >
                                    {rankingMode === opt.id ? (
                                      <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                                    ) : (
                                      <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    )}
                                    <span className="min-w-0 flex flex-col">
                                      <span className="font-medium text-foreground">{opt.label}</span>
                                      <span className="truncate text-[11px] text-muted-foreground">{opt.hint}</span>
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            {/* 2026-11-21 要求 3：分类头两个无文字小图标补齐语义区分。
                                原来只有裸 title（约 1s 系统延迟、键盘聚焦不显示），
                                且两者视觉上都是「一个小方块图标」，用户分不清哪个做什么。
                                统一改成 Radix Tooltip + 明确动词短语：
                                  🔗 复制锚点链接（复制，不是跳转）
                                  🕸 打开生态图谱（新页面）
                                视觉上也拉开：复制用中性色、图谱用主色 hover。 */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={handleCopyCategoryLink}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                                  aria-label={`复制「${category.title}」分类的直达链接`}
                                >
                                  <Link2 className="w-3.5 h-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" sideOffset={6}>
                                复制「{category.title}」直达链接
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link
                                  href={`/graph?category=${encodeURIComponent(category.id)}`}
                                  prefetch={false}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={`查看「${category.title}」的技术生态图谱`}
                                >
                                  <Network className="w-3.5 h-3.5" />
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" sideOffset={6}>
                                打开「{category.title}」技术生态图谱
                              </TooltipContent>
                            </Tooltip>
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40 font-medium">
                              {isFilterActive ? `${totalMatchedCount}/${totalCount} 匹配` : selectedSubCatId ? `${totalMatchedCount}/${totalCount} 站点` : `${totalCount} 站点`}
                            </span>
                            {isEditingLayout && isModuleCustomSized && (
                              <button
                                type="button"
                                onClick={() => {
                                  resetModuleSize()
                                  toast({ title: `🔄 已恢复「${category.title}」默认全宽与自适应高度` })
                                }}
                                className="inline-flex min-h-11 items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25 font-medium hover:bg-primary/20 transition-all cursor-pointer"
                                title="点击重置该模块窗口为默认全宽与自适应高度"
                                aria-label={`重置「${category.title}」模块窗口大小`}
                              >
                                <span>
                                  📐 {moduleColSpan === 12 ? '全宽' : `${moduleColSpan}/12列`}
                                  {moduleHeightPx ? `×${moduleHeightPx}px` : ''}
                                </span>
                                <RotateCcw className="w-2.5 h-2.5" />
                              </button>
                            )}
                            {isCollapsed && (
                              <button
                                type="button"
                                onClick={() => toggleCollapseCategory(category.id)}
                                className="inline-flex min-h-11 items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20 font-medium hover:bg-sky-500/20 transition-all cursor-pointer"
                                title="点击展开该分类"
                              >
                                <span>已收起 (点击展开)</span>
                              </button>
                            )}
                          </div>

                          {/* 类目内秒级精准筛选器 */}
                          {!isCollapsed && totalCount >= 4 && (
                            <div className="flex items-center gap-1.5 ml-auto">
                              {categoryTopTags.length > 0 && (
                                <div
                                  role="toolbar"
                                  aria-label={`「${category.title}」热门标签筛选（←/→ 移动，回车切换）`}
                                  aria-orientation="horizontal"
                                  className="hidden lg:flex items-center gap-1"
                                  onKeyDown={(e) => {
                                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
                                    const chips = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-tag-chip]'))
                                    if (chips.length === 0) return
                                    const current = chips.findIndex((chip) => chip === document.activeElement)
                                    if (current === -1) return
                                    e.preventDefault()
                                    const next =
                                      e.key === 'Home'
                                        ? 0
                                        : e.key === 'End'
                                          ? chips.length - 1
                                          : e.key === 'ArrowRight'
                                            ? (current + 1) % chips.length
                                            : (current - 1 + chips.length) % chips.length
                                    setTagFocusIndex(next)
                                    chips[next]?.focus()
                                  }}
                                >
                                  {categoryTopTags.map((tag, index) => {
                                    const isSelected = selectedTag === tag
                                    return (
                                      <button
                                        key={tag}
                                        type="button"
                                        data-tag-chip
                                        tabIndex={index === Math.min(tagFocusIndex, categoryTopTags.length - 1) ? 0 : -1}
                                        onFocus={() => setTagFocusIndex(index)}
                                        onClick={() => setSelectedTag(isSelected ? null : tag)}
                                        className={cn(
                                          "px-2 py-0.5 min-h-6 inline-flex items-center rounded-md text-[11px] font-medium transition-colors cursor-pointer",
                                          isSelected
                                            ? "bg-primary text-primary-foreground shadow-2xs"
                                            : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40"
                                        )}
                                        title={`按标签「${tag}」筛选`}
                                      >
                                        #{tag}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}

                              {isFilterOpen || filterKeyword ? (
                                <div className="flex items-center gap-1 bg-background/90 border border-primary/40 focus-within:border-primary rounded-lg px-2 py-0.5 shadow-2xs">
                                  <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                  <input
                                    type="search"
                                    inputMode="search"
                                    enterKeyHint="search"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    value={filterKeyword}
                                    onChange={(e) => setFilterKeyword(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setFilterKeyword('')
                                        setIsFilterOpen(false)
                                      }
                                    }}
                                    placeholder={`筛选 ${category.title}...`}
                                    aria-label={`筛选${category.title}分类下的站点`}
                                    className="w-24 sm:w-32 text-xs bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                                    autoFocus
                                  />
                                  {/* 16px 的 × 视觉不变，::after 把点击区无形扩到 44px */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFilterKeyword('')
                                      setSelectedTag(null)
                                      setIsFilterOpen(false)
                                    }}
                                    className="relative p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer after:absolute after:-inset-3.5 after:content-['']"
                                    title="关闭筛选"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                /* 2026-11-21 要求 3：放大镜的行为确认——它**不是**重复聚焦
                                   顶部大搜索框，而是 setIsFilterOpen(true) 就地展开本类的
                                   内联筛选输入框（见上方 isFilterOpen 分支），
                                   因此保留，只把裸 title 升级为 Radix Tooltip 并写清
                                   「在『X』内筛选」以区别于全局搜索。 */
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => setIsFilterOpen(true)}
                                      className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                                      aria-label={`在「${category.title}」内快速筛选`}
                                    >
                                      <Search className="w-3.5 h-3.5" />
                                      <span className="hidden text-[11px] xl:inline">类目筛选</span>
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" sideOffset={6}>
                                    在「{category.title}」内快速筛选（不离开本页）
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          )}

                          {/* 就地可视化排版控制器（置顶 / 上移 / 下移 / 隐藏） */}
                          {isEditingLayout && (
                            <CategoryInSituControls
                              categoryId={category.id}
                              title={category.title}
                              isPinned={isPinned}
                              isCustom={isCustom}
                              canMoveUp={index > 0}
                              canMoveDown={index < totalCategories - 1}
                              allCategoryIds={allCategoryIds}
                              dragEnabled
                              dragGrip={dragKit?.DiyCategoryDragGrip}
                              onAddSite={() => setAddSiteTargetCatId(category.id)}
                            />
                          )}
                        </div>

                        {/* 未折叠时渲染分类下挂载的站点和二级分类 */}
                        {!isCollapsed && (
                          <div
                            id={categoryContentId}
                            className={cn(
                              // 首屏露出冲 40%（2026-11-21）：组间距 space-y-4 -> space-y-2。
                              // 组 mt-2（8px）与 space-y 取大者折叠，16px 的 space-y
                              // 是行距下限；压到 8px 后行距 206 -> 198px，首访态
                              // 第 4 行也开始露头（此前首访 39.8% 仅差 0.2pp）。
                              "space-y-2",
                              moduleHeightPx && "overflow-y-auto pr-1.5 custom-scrollbar"
                            )}
                            style={moduleHeightPx ? { maxHeight: `${moduleHeightPx}px` } : undefined}
                          >
                            {/* 二级分类快速切换导航轨（仅在拥有多个子分类且未折叠时渲染）
                                首屏瘦身：接入 HorizontalScrollFade（滚轮横滚、mask 渐隐、
                                左右箭头），替代手写 overflow-x-auto + 生硬裁剪；tablist
                                语义与 ←/→ 漫游经 role/onKeyDown 透传到滚动容器。 */}
                            {!isEditingLayout && subCats.length > 1 && (
                              <HorizontalScrollFade
                                role="tablist"
                                ariaLabel={`${category.title} 子分类快速切换`}
                                onKeyDown={(e) => {
                                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                                  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
                                  const currentIndex = tabs.findIndex((tab) => tab === document.activeElement)
                                  if (currentIndex === -1) return
                                  e.preventDefault()
                                  const nextIndex =
                                    e.key === 'ArrowRight'
                                      ? (currentIndex + 1) % tabs.length
                                      : (currentIndex - 1 + tabs.length) % tabs.length
                                  tabs[nextIndex]?.focus()
                                  tabs[nextIndex]?.click()
                                }}
                                scrollClassName="flex items-center gap-1.5 pb-0.5 pt-0 text-xs"
                                showArrows
                                prevAriaLabel={`向左滚动${category.title}子分类`}
                                nextAriaLabel={`向右滚动${category.title}子分类`}
                              >
                                <button
                                  type="button"
                                  role="tab"
                                  aria-selected={selectedSubCatId === null}
                                  tabIndex={selectedSubCatId === null ? 0 : -1}
                                  onClick={() => handleSelectSubCat(null)}
                                  className={cn(
                                    /* 子分类 chip：min-h-11(44px) → h-7(28px)。这是「切换查看哪一组」的快筛，
                                           不是主操作；横向滚动 + 渐隐箭头保证可达性。 */
                                        "h-7 px-2.5 rounded-full text-[11px] font-medium shrink-0 transition-all cursor-pointer flex items-center gap-1",
                                    selectedSubCatId === null
                                      ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                                      : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40"
                                  )}
                                >
                                  <span>全部</span>
                                  <span className={cn("text-[10px] font-mono", selectedSubCatId === null ? "text-primary-foreground/80" : "text-muted-foreground")}>{`(${totalCount})`}</span>
                                </button>
                                {sortedDirectItems.length > 0 && (
                                  <button
                                    type="button"
                                    role="tab"
                                    aria-selected={selectedSubCatId === '__direct__'}
                                    tabIndex={selectedSubCatId === '__direct__' ? 0 : -1}
                                    onClick={() => handleSelectSubCat(selectedSubCatId === '__direct__' ? null : '__direct__')}
                                    className={cn(
                                      /* 子分类 chip：min-h-11(44px) → h-7(28px)。这是「切换查看哪一组」的快筛，
                                           不是主操作；横向滚动 + 渐隐箭头保证可达性。 */
                                        "h-7 px-2.5 rounded-full text-[11px] font-medium shrink-0 transition-all cursor-pointer flex items-center gap-1",
                                      selectedSubCatId === '__direct__'
                                        ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                                        : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40"
                                    )}
                                  >
                                    <span>精选直属</span>
                                    <span className={cn("text-[10px] font-mono", selectedSubCatId === '__direct__' ? "text-primary-foreground/80" : "text-muted-foreground")}>{`(${sortedDirectItems.length})`}</span>
                                  </button>
                                )}
                                {subCats.filter((sub) => isEditingLayout || (sub.items && sub.items.length > 0)).map((sub) => {
                                  const isCurrent = selectedSubCatId === sub.id
                                  const subItemCount = sub.items?.length || 0
                                  return (
                                    <button
                                      key={sub.id}
                                      type="button"
                                      role="tab"
                                      aria-selected={isCurrent}
                                      tabIndex={isCurrent ? 0 : -1}
                                      onClick={() => handleSelectSubCat(isCurrent ? null : sub.id)}
                                      className={cn(
                                        /* 子分类 chip：min-h-11(44px) → h-7(28px)。这是「切换查看哪一组」的快筛，
                                           不是主操作；横向滚动 + 渐隐箭头保证可达性。 */
                                        "h-7 px-2.5 rounded-full text-[11px] font-medium shrink-0 transition-all cursor-pointer flex items-center gap-1",
                                        isCurrent
                                          ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                                          : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40"
                                      )}
                                    >
                                      <span>{sub.title}</span>
                                      <span className={cn("text-[10px] font-mono", isCurrent ? "text-primary-foreground/80" : "text-muted-foreground")}>{`(${subItemCount})`}</span>
                                    </button>
                                  )
                                })}
                              </HorizontalScrollFade>
                            )}

                            {/* 筛选零匹配友好空态 */}
                            {isFilterActive && totalMatchedCount === 0 && (
                              <div className="py-6 px-4 rounded-xl border border-dashed border-border/70 text-center space-y-2 bg-muted/20">
                                <p className="text-xs text-muted-foreground">
                                  在「{category.title}」分类中未找到匹配「{filterKeyword || selectedTag}」的站点
                                </p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs min-h-11"
                                  onClick={() => {
                                    setFilterKeyword('')
                                    setSelectedTag(null)
                                  }}
                                >
                                  清空此类目筛选
                                </Button>
                              </div>
                            )}
                            {/* 一级分类下直接挂载的站点 */}
                            {(showDirectGroup && (sortedDirectItems.length > 0 || isCustom)) && (
                              <div
                                ref={gridColumnRef}
                                data-nav-grid=""
                                data-card-mode={normalizedCardMode}
                                data-grid-folded={directGroup.items.length < filteredDirectItems.length ? '' : undefined}
                                data-grid-expanded={directGroup.items.length >= filteredDirectItems.length ? '' : undefined}
                                className={cn(effectiveGridClass, "transition-all duration-200")}
                                style={effectiveCardModeMeta.usesDensityGap ? { gap: 'var(--density-grid-gap, 14px)' } : undefined}
                              >
                                {directGroup.items.map((item: any, index: number) =>
                                  renderSiteCard(item, {
                                    sourceCategoryId: category.id,
                                    pinnedIds: categoryPinnedItemIds,
                                    onTogglePin: handleTogglePinDirect,
                                    onPeek: handlePeekDirect,
                                    displayedIds: directDisplayedIds,
                                    index,
                                    onMoveCard: handleMoveCardDirect,
                                  }),
                                )}

                                {/* 专属私人分类末尾的“添加自定义网址”槽位 */}
                                {isCustom && (
                                  <button
                                    type="button"
                                    onClick={() => setAddSiteTargetCatId(category.id)}
                                    className={cn(
                                      "group flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-semibold transition-all hover:scale-[1.02] cursor-pointer",
                                      cardDisplayMode === 'compact' ? "h-9" : "min-h-[72px]"
                                    )}
                                    title="添加自定义网站到该专属分类"
                                  >
                                    <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
                                    <span>添加自定义网址</span>
                                  </button>
                                )}

                                {renderGroupToggle('__direct__', sortedDirectItems.length)}
                              </div>
                            )}

                            {/* 二级分类及其站点 */}
                            {subGroups.length > 0 &&
                              subGroups.map(({ subCategory, subPinnedItemIds, sortedSubItems, items, displayedIds, onTogglePin, onPeek, onMoveCard }) => {
                                const hasSubCatRail = !isEditingLayout && subCats.length > 1
                                const isSubExpanded = Boolean(expandedGroups[subCategory.id])
                                const canExpandSub = !forceFull && Number.isFinite(limit) && sortedSubItems.length > limit
                                // 同级列表（↑/↓ 与拖拽的锚点）：取全部可见同级，不是当前
                                // 选中的 tab 过滤后的 subGroups——tab 选中时 subGroups 只有
                                // 一组，拿它当同级会把 ↑/↓ 全禁掉。
                                const siblingIds = sortedSubCategories.map((s) => s.subCategory.id)
                                const subIndex = siblingIds.indexOf(subCategory.id)
                                // 首屏露出冲 40%（2026-11-21）：组间距 mt-8 -> mt-2、组内
                                // space-y-3 -> space-y-2。默认 6 张/组 = 满一行，32px 组
                                // 间距过大；8px + 组头 28px + 8px 仍可清晰分区。行距
                                // 实测 222 -> 198px，1920x911 下第 4 行开始露头。
                                return (
                                  <div key={subCategory.id} id={subCategory.id} className="mt-2 space-y-2">
                                    <div className="flex items-center justify-between pb-0.5 pt-1">
                                      <div className="flex items-center gap-2">
                                        <span className="w-[3px] h-3.5 rounded-full bg-gradient-to-b from-primary to-primary/50 shadow-2xs" />
                                        <h3 className="text-xs font-semibold text-foreground/90 tracking-wider">
                                          {subCategory.title}
                                        </h3>
                                        <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-full bg-muted/70 text-muted-foreground border border-border/40 leading-none">
                                          {subCategory.items?.length || 0}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {isEditingLayout && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                removeFeature({
                                                  id: `sub:${subCategory.id}`,
                                                  level: 'L2_SUBCATEGORY',
                                                  title: subCategory.title,
                                                  parentTitle: `${category.title} > ${subCategory.title}`,
                                                })
                                                toast({
                                                  title: `📁 已隐藏子分类「${subCategory.title}」`,
                                                  description: '已移入时间轴回收站，按 Ctrl/Cmd+Z 可立即撤销。',
                                                })
                                              }}
                                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
                                              title={`隐藏「${subCategory.title}」子分类（可随时在回收站还原）`}
                                            >
                                              <EyeOff className="w-3 h-3" />
                                              <span>－ 移除子分类</span>
                                            </button>
                                            {/* 子分类拖拽：手柄是 DiyCategoryDragGrip（与顶级同一组件），
                                                落点是父级 section 的 DiyCategoryDropTarget——子分组
                                                故意不注册自己的 droppable：落点一旦是 kind:'category'
                                                的 droppable，卡片拖到子分组上也会命中它，
                                                resolveCardDrop 会把它重归类到子分类 id，而
                                                combineAndSortCategories 只认顶级分类 id 消费重映射，
                                                卡片会直接从页面消失。拖拽落点由 navigation-content
                                                的 handleCategoryDragEnd 按指针位置在同级里定位。 */}
                                            <CategoryInSituControls
                                              categoryId={subCategory.id}
                                              title={subCategory.title}
                                              isPinned={subPinnedItemIds.length > 0}
                                              isSubcategory
                                              canMoveUp={subIndex > 0}
                                              canMoveDown={subIndex >= 0 && subIndex < siblingIds.length - 1}
                                              allCategoryIds={siblingIds}
                                              dragEnabled
                                              dragGrip={dragKit?.DiyCategoryDragGrip}
                                              onAddSite={() => setAddSiteTargetCatId(subCategory.id)}
                                            />
                                          </>
                                        )}
                                        {canExpandSub && (
                                          <button
                                            type="button"
                                            tabIndex={hasSubCatRail ? -1 : 0}
                                            onClick={() => setExpandedGroups((prev) => ({ ...prev, [subCategory.id]: !prev[subCategory.id] }))}
                                            aria-expanded={isSubExpanded}
                                            data-group-toggle={subCategory.id}
                                            title={hasSubCatRail ? '键盘用户可用上方子分类切换查看该组全部站点' : undefined}
                                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium text-muted-foreground hover:text-primary bg-muted/30 hover:bg-primary/10 border border-border/50 hover:border-primary/30 transition-all cursor-pointer"
                                          >
                                            <span>{isSubExpanded ? '收起' : `展开全部 ${sortedSubItems.length} 个`}</span>
                                            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', isSubExpanded && 'rotate-180')} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      ref={gridColumnRef}
                                      data-nav-grid=""
                                      data-card-mode={normalizedCardMode}
                                      data-grid-folded={items.length < sortedSubItems.length ? '' : undefined}
                                      data-grid-expanded={items.length >= sortedSubItems.length ? '' : undefined}
                                      className={cn(effectiveGridClass, "transition-all duration-200")}
                                      style={effectiveCardModeMeta.usesDensityGap ? { gap: 'var(--density-grid-gap, 14px)' } : undefined}
                                    >
                                      {items.map((item: any, index: number) =>
                                        renderSiteCard(item, {
                                          sourceCategoryId: subCategory.id,
                                          pinnedIds: subPinnedItemIds,
                                          onTogglePin,
                                          onPeek,
                                          displayedIds,
                                          index,
                                          onMoveCard,
                                        }),
                                      )}
                                    </div>
                                  </div>
                                )
                              })}

                            {/* 空分类提示 */}
                            {totalCount === 0 && !isCustom && (
                              <div className="text-center py-6 border border-dashed border-border/60 rounded-xl text-muted-foreground text-xs">
                                该分类下暂无收录站点，可通过卡片右上角的图钉或添加站点进行收录。
                              </div>
                            )}
                          </div>
                        )}
                      </div>
    </>
  )

  if (isEditingLayout && dragKit) {
    const { DiyCategoryDropTarget } = dragKit
    return (
      <section
        ref={sectionRef}
        key={category.id}
        id={category.id}
        className={sectionClassName}
      >
        <DiyCategoryDropTarget
          data={{ kind: 'category', categoryId: category.id, isCustom, title: category.title }}
          element={sectionRef}
          onDropTargetChange={setIsCategoryDropTarget}
        />
        {sectionInner}
      </section>
    )
  }

  return (
    <section
      ref={sectionRef}
      key={category.id}
      id={category.id}
      className={sectionClassName}
    >
      {sectionInner}
    </section>
  )
})
