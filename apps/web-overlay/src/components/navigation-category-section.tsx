'use client'

/**
 * 首页单个分类区块（从 navigation-content.tsx 拆出，2026-10-19 P1-2）。
 *
 * 负责分类标题、折叠/置顶/排序控件、一级与二级站点的拖拽/收录/多选。
 * 共享状态直接走 useHomeDIY()，拖拽目标等跨区块 UI 状态由父组件注入。
 */
import { useMemo, useState, useCallback, useEffect, useRef, memo } from 'react'
import Link from 'next/link'
import { NavigationCard } from '@/components/navigation-card'
import { CategoryInSituControls } from '@/components/category-in-situ-controls'
import { ModuleResizeHandles } from '@/components/modular/module-resize-handles'
import { useModuleWindowSize } from '@/lib/modular/module-resize-store'
import { ChevronDown, Pin, Plus, Sparkles, Search, X, Link2, Network, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'
import {
  computeAdaptiveSiteRanking,
  isSafeSiteHref,
  sortCategoryItemsWithPinned,
} from '@/lib/modular/diy-presets'
import { createCustomSiteId } from '@/lib/modular/custom-site-input'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { countCategorySites } from '@/lib/modular/category-counts'
import type { CardDisplayMode } from '@/lib/modular/use-home-diy'
import { useToast } from '@/components/ui/use-toast'
import { copyText } from '@/lib/clipboard'
import type { CategoryNode } from '@/lib/modular/category-combine'
import type { NavigationItem, NavigationCategory, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { useExternalLinkTarget } from '@/lib/user-preferences'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'

interface DropCategoryTarget {
  categoryId: string
  position: 'before' | 'after'
}

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
  dropCategoryTarget: DropCategoryTarget | null
  dragOverCustomCatId: string | null
  setDropCategoryTarget: (target: DropCategoryTarget | null) => void
  setDragOverCustomCatId: (id: string | null) => void
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
}

export const NavigationCategorySection = memo(function NavigationCategorySection({
  category,
  index,
  totalCategories,
  allCategoryIds,
  gridColumnsClass,
  cardDisplayMode,
  selectionMode,
  selectedIds,
  siteData,
  dropCategoryTarget,
  dragOverCustomCatId,
  setDropCategoryTarget,
  setDragOverCustomCatId,
  setAddSiteTargetCatId,
  setPeekItem,
  keyboardHintId,
  toggleSelectOne,
  cardsPerGroup = 0,
}: NavigationCategorySectionProps) {
  const { toast } = useToast()
  const {
    isEditingLayout,
    isAdaptiveRankingEnabled,
    pinnedCategoryIds,
    hiddenCategoryIds,
    unhideCategory,
    categoryDensityOverrides,
    collapsedCategoryIds,
    pinnedSiteIdsByCategory,
    addSiteToCustomCategory,
    reclassifySite,
    togglePinSiteInCategory,
    toggleCollapseCategory,
    reorderCategory,
    speedDialPinnedIds,
    pinToSpeedDial,
    unpinFromSpeedDial,
  } = useHomeDIY()

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

  const isPinned = pinnedCategoryIds.includes(category.id)
  const isCustom = Boolean(category.isCustom)
  const isCollapsed = collapsedCategoryIds.includes(category.id)
  const effectiveCardMode = categoryDensityOverrides?.[category.id] || cardDisplayMode
  const effectiveGridClass = useMemo(() => {
    // 当模块被左右拖拉缩窄为非全宽窗口（< 12 列）时，自适应缩减内部卡片列数，保证每张卡片文字不挤压
    if (moduleColSpan <= 5) {
      return effectiveCardMode === 'minimal'
        ? 'grid grid-cols-1 sm:grid-cols-2'
        : 'grid grid-cols-1'
    }
    if (moduleColSpan <= 7) {
      return effectiveCardMode === 'minimal'
        ? 'grid grid-cols-2 xl:grid-cols-3'
        : 'grid grid-cols-1 xl:grid-cols-2'
    }
    if (moduleColSpan <= 9) {
      return effectiveCardMode === 'minimal'
        ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
        : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
    }
    if (effectiveCardMode === 'minimal') {
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5 min-[1920px]:grid-cols-6!'
    }
    if (effectiveCardMode === 'compact') {
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5 min-[1920px]:grid-cols-6!'
    }
    if (effectiveCardMode === 'rich') {
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-[1536px]:grid-cols-4! min-[1920px]:grid-cols-5!'
    }
    if (effectiveCardMode === 'standard') {
      return 'grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))]'
    }
    return gridColumnsClass || 'grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))]'
  }, [effectiveCardMode, gridColumnsClass, moduleColSpan])
  const directItems = (category.items || []) as NavigationSubItem[]
  const subCats = (category.subCategories || []) as Array<NavigationCategory & { items?: NavigationSubItem[] }>
  // 与吸顶快捷直达轨、站内目录带共用同一个算式（lib/modular/category-counts.ts）
  const totalCount = countCategorySites(category)
  const categoryPinnedItemIds = pinnedSiteIdsByCategory[category.id] || []
  /**
   * 排序结果必须缓存。
   *
   * 拖拽过程中 `setDragOverCustomCatId` 每次悬停变化都会让父组件重渲染，
   * 这里若每帧重排整个分类（几十~上百条），主线程会被排序吃满，拖拽明显掉帧。
   */
  const sortedDirectItems = useMemo(
    () =>
      isAdaptiveRankingEnabled
        ? computeAdaptiveSiteRanking(directItems, { pinnedItemIds: categoryPinnedItemIds })
        : sortCategoryItemsWithPinned(directItems, categoryPinnedItemIds),
    [directItems, categoryPinnedItemIds, isAdaptiveRankingEnabled]
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
        const subItems = (subCategory.items || []) as NavigationSubItem[]
        return {
          subCategory,
          subPinnedItemIds,
          sortedSubItems: isAdaptiveRankingEnabled
            ? computeAdaptiveSiteRanking(subItems, { pinnedItemIds: subPinnedItemIds })
            : sortCategoryItemsWithPinned(subItems, subPinnedItemIds),
        }
      }),
    [subCats, pinnedSiteIdsByCategory, isAdaptiveRankingEnabled]
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
  const limit = cardsPerGroup > 0 ? cardsPerGroup : Number.POSITIVE_INFINITY
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
  const forceFull = selectionMode

  // 类目内秒级精准筛选状态
  const [filterKeyword, setFilterKeyword] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [selectedSubCatId, setSelectedSubCatId] = useState<string | null>(null)
  const [isFilterOpen, setIsFilterOpen] = useState(false)

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
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag)
  }, [category.items, category.subCategories])

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

  const subGroups = useMemo(
    () => {
      const activeList = selectedSubCatId === '__direct__'
        ? []
        : selectedSubCatId
          ? filteredSubCategories.filter((entry) => entry.subCategory.id === selectedSubCatId)
          : filteredSubCategories

      return activeList.map((entry) => {
        const all = entry.filteredSubItems
        const expanded = forceFull || isFilterActive || Boolean(expandedGroups[entry.subCategory.id])
        return {
          ...entry,
          items: expanded || all.length <= limit ? all : all.slice(0, limit),
        }
      })
    },
    [filteredSubCategories, selectedSubCatId, forceFull, isFilterActive, expandedGroups, limit]
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
   */
  const renderGroupToggle = (key: string, total: number) => {
    if (forceFull || !Number.isFinite(limit) || total <= limit) return null
    const expanded = Boolean(expandedGroups[key])
    return (
      <button
        type="button"
        onClick={() => setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))}
        aria-expanded={expanded}
        data-group-toggle={key}
        className="col-span-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary cursor-pointer"
      >
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
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

  const isHidden = hiddenCategoryIds?.includes(category.id)
  if (isHidden) {
    if (!isEditingLayout) return null
    return (
      <div
        key={category.id}
        id={category.id}
        className="col-span-12 my-1 flex items-center justify-between rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-2.5 backdrop-blur-xs transition-all opacity-70 hover:opacity-100"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <EyeOff className="w-4 h-4 text-amber-500" />
          <span>{category.title}</span>
          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">(已隐藏)</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              unhideCategory(category.id)
              toast({ title: `已恢复显示分类: ${category.title}` })
            }}
            className="h-7 px-2.5 text-xs rounded-lg gap-1 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>恢复显示</span>
          </Button>
        </div>
      </div>
    )
  }

  return (
                    <section
                      ref={sectionRef}
                      key={category.id}
                      id={category.id}
                      onDragOver={(e) => {
                        if (isResizingModuleRef.current) return
                        // 1. 如果拖拽的是卡片，且当前是自定义专属分类
                        if (e.dataTransfer.types.includes('text/navhub-card-payload')) {
                          if (isCustom) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'copy'
                            if (dragOverCustomCatId !== category.id) {
                              setDragOverCustomCatId(category.id)
                            }
                          }
                          return
                        }

                        // 2. 如果处于排版编排模式且拖拽的是分类
                        if (isEditingLayout && e.dataTransfer.types.includes('text/navhub-category-id')) {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          const rect = e.currentTarget.getBoundingClientRect()
                          const midY = rect.top + rect.height / 2
                          const pos = e.clientY < midY ? 'before' : 'after'
                          setDropCategoryTarget({ categoryId: category.id, position: pos })
                        }
                      }}
                      onDragLeave={() => {
                        if (dropCategoryTarget?.categoryId === category.id) {
                          setDropCategoryTarget(null)
                        }
                        if (dragOverCustomCatId === category.id) {
                          setDragOverCustomCatId(null)
                        }
                      }}
                      onDrop={(e) => {
                        // 1. 处理卡片拖拽跨分类移动与自建分类收录
                        if (e.dataTransfer.types.includes('text/navhub-card-payload')) {
                          e.preventDefault()
                          setDragOverCustomCatId(null)
                          try {
                            const raw = e.dataTransfer.getData('text/navhub-card-payload')
                            if (raw) {
                              const card = JSON.parse(raw)
                              if (isCustom && card.title && card.href) {
                                if (!isSafeSiteHref(card.href)) {
                                  toast({
                                    title: '⚠️ 拖拽收录已拦截',
                                    description: '该卡片地址不安全，仅允许 http/https 或站内路径。',
                                  })
                                  return
                                }
                                const exists = category.items?.some(
                                  (item) => item.href === card.href || item.title === card.title
                                )
                                if (exists) {
                                  toast({
                                    title: 'ℹ️ 站点已存在',
                                    description: `站点「${card.title}」已收录在「${category.title}」中。`,
                                  })
                                  return
                                }
                                const outcome = addSiteToCustomCategory(category.id, {
                                  id: createCustomSiteId(),
                                  title: card.title,
                                  href: card.href,
                                  description: card.description || undefined,
                                  icon: card.icon || undefined,
                                })
                                if (outcome === 'failed') {
                                  toast({
                                    title: '这一下没能保存',
                                    description: '浏览器拒绝写入本地存储（隐私模式或空间已满），刷新后这条收录会消失。',
                                    variant: 'destructive',
                                  })
                                } else if (outcome === 'duplicate') {
                                  toast({ title: 'ℹ️ 站点已存在', description: `「${card.title}」已在「${category.title}」中。` })
                                } else {
                                  toast({
                                    title: '📥 拖拽收录成功',
                                    description: `已成功将站点「${card.title}」收录进专属分类「${category.title}」！`,
                                  })
                                }
                                return
                              } else if (isEditingLayout && card.id && card.sourceCategoryId !== category.id) {
                                reclassifySite(card.id, category.id)
                                toast({
                                  title: '🔄 跨分类迁移成功',
                                  description: `已将站点「${card.title}」重排归类至「${category.title}」！`,
                                })
                                return
                              }
                            }
                          } catch (err) {
                            console.error('拖拽卡片解析失败', err)
                          }
                          return
                        }
                        if (false && isCustom) {
                          e.preventDefault()
                          setDragOverCustomCatId(null)
                          try {
                            const raw = e.dataTransfer.getData('text/navhub-card-payload')
                            if (raw) {
                              const card = JSON.parse(raw)
                              if (card.title && card.href) {
                                const exists = category.items?.some(
                                  (item) => item.href === card.href || item.title === card.title
                                )
                                if (exists) {
                                  toast({
                                    title: 'ℹ️ 站点已存在',
                                    description: `站点「${card.title}」已收录在「${category.title}」中。`,
                                  })
                                  return
                                }
                                const outcome = addSiteToCustomCategory(category.id, {
                                  id: createCustomSiteId(),
                                  title: card.title,
                                  href: card.href,
                                  description: card.description || undefined,
                                  icon: card.icon || undefined,
                                })
                                if (outcome === 'failed') {
                                  toast({
                                    title: '这一下没能保存',
                                    description: '浏览器拒绝写入本地存储（隐私模式或空间已满），刷新后这条收录会消失。',
                                    variant: 'destructive',
                                  })
                                } else if (outcome === 'duplicate') {
                                  toast({ title: 'ℹ️ 站点已存在', description: `「${card.title}」已在「${category.title}」中。` })
                                } else {
                                  toast({
                                    title: '📥 拖拽收录成功',
                                    description: `已成功将站点「${card.title}」收录进专属分类「${category.title}」！`,
                                  })
                                }
                              }
                            }
                          } catch (err) {
                            console.error('拖拽卡片解析失败', err)
                          }
                          return
                        }

                        // 2. 处理分类位置重排
                        if (isEditingLayout && e.dataTransfer.types.includes('text/navhub-category-id')) {
                          e.preventDefault()
                          const sourceCatId = e.dataTransfer.getData('text/navhub-category-id')
                          const targetPos = dropCategoryTarget?.position || 'before'
                          setDropCategoryTarget(null)
                          if (sourceCatId && sourceCatId !== category.id) {
                            reorderCategory(sourceCatId, category.id, targetPos, allCategoryIds)
                            toast({
                              title: '✨ 分类编排已更新',
                              description: `已将分类重排至「${category.title}」${targetPos === 'after' ? '之后' : '之前'}。`,
                            })
                          }
                        }
                      }}
                      className={cn(
                        "cv-auto-section group relative scroll-m-16",
                        isResizingSelf ? "transition-none! select-none!" : "transition-all duration-200",
                        sectionColSpanClass,
                        isModuleCustomSized && !isPinned && !isEditingLayout && "p-3 sm:p-4 rounded-2xl border border-border/70 bg-card/35 backdrop-blur-xs shadow-2xs",
                        isPinned && "p-3 sm:p-4 rounded-2xl bg-primary/3 border border-primary/20 depth-surface",
                        isEditingLayout && "p-3 sm:p-4 rounded-2xl border-2 border-dashed border-primary/30 bg-muted/20",
                        dragOverCustomCatId === category.id && "ring-2 ring-emerald-500 bg-emerald-500/10 rounded-2xl border-emerald-500/60"
                      )}
                    >
                      {/* 四向边框与双下角自由拖拉调整模块窗口大小手柄 */}
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

                      {/* 分类拖拽放置指示标线 */}
                      {dropCategoryTarget && dropCategoryTarget.categoryId === category.id && dropCategoryTarget.position === 'before' && (
                        <div className="absolute -top-1.5 inset-x-2 h-1 bg-primary rounded-full shadow-md shadow-primary/60 animate-pulse z-30" />
                      )}
                      {dropCategoryTarget && dropCategoryTarget.categoryId === category.id && dropCategoryTarget.position === 'after' && (
                        <div className="absolute -bottom-1.5 inset-x-2 h-1 bg-primary rounded-full shadow-md shadow-primary/60 animate-pulse z-30" />
                      )}

                      {/* 卡片拖拽进专属分类的引导高亮条 */}
                      {dragOverCustomCatId === category.id && (
                        <div className="mb-3 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500/15 border-2 border-dashed border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold text-xs animate-in zoom-in-95 duration-150">
                          <Sparkles className="w-4 h-4 animate-bounce" />
                          <span>松开鼠标，直接收录卡片至「{category.title}」专属分类</span>
                        </div>
                      )}

                      <div className="space-y-4">
                        {/* 一级分类标题头 */}
                        <div className="flex items-center justify-between pb-3 border-b border-border/50">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* 手风琴折叠展开按钮 */}
                            <button
                              type="button"
                              onClick={() => toggleCollapseCategory(category.id)}
                              className="p-1 -ml-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted/80 transition-all flex items-center justify-center cursor-pointer"
                              title={isCollapsed ? `展开「${category.title}」` : `收起「${category.title}」`}
                              aria-label={isCollapsed ? `展开「${category.title}」` : `收起「${category.title}」`}
                              aria-expanded={!isCollapsed}
                            >
                              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isCollapsed && "-rotate-90")} />
                            </button>

                            <span className={cn(
                              "w-1.5 h-5 rounded-full",
                              isCustom ? "bg-emerald-500" : isPinned ? "bg-amber-500" : "bg-primary"
                            )} />
                            <h2
                              className="text-base sm:text-xl font-bold tracking-tight text-foreground flex flex-wrap items-center gap-1.5 sm:gap-2 cursor-pointer select-none"
                              onClick={() => toggleCollapseCategory(category.id)}
                              title={isCollapsed ? "点击展开" : "点击折叠"}
                            >
                              <span>{category.title}</span>
                              {isPinned && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                                  <Pin className="w-2.5 h-2.5 fill-amber-500" />
                                  <span>已置顶</span>
                                </span>
                              )}
                              {isCustom && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>专属私人</span>
                                </span>
                              )}
                              {isAdaptiveRankingEnabled && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 font-medium">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>自适应热度</span>
                                </span>
                              )}
                            </h2>
                            {/* 复制分类直达链接按钮 */}
                            <button
                              type="button"
                              onClick={handleCopyCategoryLink}
                              className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-all cursor-pointer opacity-70 hover:opacity-100"
                              title={`复制「${category.title}」直达锚点链接`}
                              aria-label={`复制「${category.title}」分类直达链接`}
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                            {/* 查看该领域技术生态图谱 */}
                            <Link
                              href={`/graph?category=${encodeURIComponent(category.id)}`}
                              className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-all cursor-pointer opacity-70 hover:opacity-100"
                              title="查看该领域技术生态图谱"
                              aria-label={`查看「${category.title}」领域技术生态图谱`}
                            >
                              <Network className="w-3.5 h-3.5" />
                            </Link>
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
                                className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25 font-medium hover:bg-primary/20 transition-all cursor-pointer"
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
                                className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 font-medium hover:bg-sky-500/20 transition-all cursor-pointer"
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
                                <div className="hidden lg:flex items-center gap-1">
                                  {categoryTopTags.map((tag) => {
                                    const isSelected = selectedTag === tag
                                    return (
                                      <button
                                        key={tag}
                                        type="button"
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
                                    type="text"
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
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFilterKeyword('')
                                      setSelectedTag(null)
                                      setIsFilterOpen(false)
                                    }}
                                    className="p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                                    title="关闭筛选"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setIsFilterOpen(true)}
                                  className="h-6 px-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors inline-flex items-center gap-1 text-xs cursor-pointer"
                                  title={`在「${category.title}」内极速筛选`}
                                  aria-label={`类目筛选：在「${category.title}」内极速筛选`}
                                >
                                  <Search className="w-3.5 h-3.5" />
                                  <span className="hidden xl:inline text-[11px]">类目筛选</span>
                                </button>
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
                              onAddSite={() => setAddSiteTargetCatId(category.id)}
                            />
                          )}
                        </div>

                        {/* 未折叠时渲染分类下挂载的站点和二级分类 */}
                        {!isCollapsed && (
                          <div
                            className={cn(
                              "space-y-4",
                              moduleHeightPx && "overflow-y-auto pr-1.5 custom-scrollbar"
                            )}
                            style={moduleHeightPx ? { maxHeight: `${moduleHeightPx}px` } : undefined}
                          >
                            {/* 二级分类快速切换导航轨（仅在拥有多个子分类且未折叠时渲染） */}
                            {!isEditingLayout && subCats.length > 1 && (
                              <div
                                role="tablist"
                                aria-label={`${category.title} 子分类快速切换`}
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
                                className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 scrollbar-none text-xs"
                              >
                                <button
                                  type="button"
                                  role="tab"
                                  aria-selected={selectedSubCatId === null}
                                  tabIndex={selectedSubCatId === null ? 0 : -1}
                                  onClick={() => setSelectedSubCatId(null)}
                                  className={cn(
                                    "px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 transition-all cursor-pointer flex items-center gap-1",
                                    selectedSubCatId === null
                                      ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                                      : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40"
                                  )}
                                >
                                  <span>全部</span>
                                  <span className={cn("text-[10px] font-mono", selectedSubCatId === null ? "text-primary-foreground/80" : "text-muted-foreground/60")}>{`(${totalCount})`}</span>
                                </button>
                                {sortedDirectItems.length > 0 && (
                                  <button
                                    type="button"
                                    role="tab"
                                    aria-selected={selectedSubCatId === '__direct__'}
                                    tabIndex={selectedSubCatId === '__direct__' ? 0 : -1}
                                    onClick={() => setSelectedSubCatId(selectedSubCatId === '__direct__' ? null : '__direct__')}
                                    className={cn(
                                      "px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 transition-all cursor-pointer flex items-center gap-1",
                                      selectedSubCatId === '__direct__'
                                        ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                                        : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40"
                                    )}
                                  >
                                    <span>精选直属</span>
                                    <span className={cn("text-[10px] font-mono", selectedSubCatId === '__direct__' ? "text-primary-foreground/80" : "text-muted-foreground/60")}>{`(${sortedDirectItems.length})`}</span>
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
                                      onClick={() => setSelectedSubCatId(isCurrent ? null : sub.id)}
                                      className={cn(
                                        "px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 transition-all cursor-pointer flex items-center gap-1",
                                        isCurrent
                                          ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                                          : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40"
                                      )}
                                    >
                                      <span>{sub.title}</span>
                                      <span className={cn("text-[10px] font-mono", isCurrent ? "text-primary-foreground/80" : "text-muted-foreground/60")}>{`(${subItemCount})`}</span>
                                    </button>
                                  )
                                })}
                              </div>
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
                                  className="text-xs h-7"
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
                                className={cn(effectiveGridClass, "transition-all duration-200")}
                                style={{ gap: 'var(--density-grid-gap, 14px)' }}
                              >
                                {directGroup.items.map((item: any) => (
                                  <NavigationCard
                                    key={item.id}
                                    item={item}
                                    siteConfig={siteData}
                                    onPeek={handlePeekDirect}
                                    keyboardHintId={keyboardHintId}
                                    cardDisplayMode={effectiveCardMode}
                                    isPinnedInCategory={categoryPinnedItemIds.includes(item.id)}
                                    onTogglePinInCategory={handleTogglePinDirect}
                                    isDraggable={isEditingLayout}
                                    sourceCategoryId={category.id}
                                    selectable={selectionMode}
                                    selected={selectedIdSet.has(item.id)}
                                    onToggleSelect={toggleSelectOne}
                                    isEditingLayout={isEditingLayout}
                                    isSpeedDialPinned={speedDialPinnedSet.has(item.id)}
                                    onToggleSpeedDialPin={handleToggleSpeedDialPin}
                                    linkTarget={linkTarget}
                                    externalRel={externalRel}
                                  />
                                ))}

                                {/* 专属私人分类末尾的“添加自定义网址”槽位 */}
                                {isCustom && (
                                  <button
                                    type="button"
                                    onClick={() => setAddSiteTargetCatId(category.id)}
                                    className={cn(
                                      "group flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-semibold transition-all hover:scale-[1.02] cursor-pointer",
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
                              subGroups.map(({ subCategory, subPinnedItemIds, sortedSubItems, items }) => {
                                return (
                                  <div key={subCategory.id} id={subCategory.id} className="space-y-3 pt-2">
                                    <div className="flex items-center justify-between pb-0.5 pt-1">
                                      <div className="flex items-center gap-2">
                                        <span className="w-1 h-3.5 rounded-full bg-muted-foreground/40" />
                                        <h3 className="text-xs font-semibold text-muted-foreground tracking-wider">
                                          {subCategory.title}
                                        </h3>
                                        <span className="text-xs text-muted-foreground/60 font-mono">{`(${subCategory.items?.length || 0})`}</span>
                                      </div>
                                      {isEditingLayout && (
                                        <CategoryInSituControls
                                          categoryId={subCategory.id}
                                          title={subCategory.title}
                                          isPinned={subPinnedItemIds.length > 0}
                                          canMoveUp={true}
                                          canMoveDown={true}
                                          allCategoryIds={subGroups.map((s) => s.subCategory.id)}
                                          onAddSite={() => setAddSiteTargetCatId(subCategory.id)}
                                        />
                                      )}
                                    </div>
                                    <div
                                      className={cn(effectiveGridClass, "transition-all duration-200")}
                                      style={{ gap: 'var(--density-grid-gap, 14px)' }}
                                    >
                                      {items.map((item: any) => (
                                        <NavigationCard
                                          key={item.id}
                                          item={item}
                                          siteConfig={siteData}
                                          onPeek={(item) => setPeekItem(item, subCategory.id)}
                                          keyboardHintId={keyboardHintId}
                                          cardDisplayMode={effectiveCardMode}
                                          isPinnedInCategory={subPinnedItemIds.includes(item.id)}
                                          onTogglePinInCategory={(siteId) => togglePinSiteInCategory(subCategory.id, siteId)}
                                          isDraggable={isEditingLayout}
                                          sourceCategoryId={subCategory.id}
                                          selectable={selectionMode}
                                          selected={selectedIdSet.has(item.id)}
                                          onToggleSelect={toggleSelectOne}
                                          isEditingLayout={isEditingLayout}
                                          isSpeedDialPinned={speedDialPinnedSet.has(item.id)}
                                          onToggleSpeedDialPin={handleToggleSpeedDialPin}
                                          linkTarget={linkTarget}
                                          externalRel={externalRel}
                                        />
                                      ))}
                                      {renderGroupToggle(subCategory.id, sortedSubItems.length)}
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
                    </section>
  )
})
