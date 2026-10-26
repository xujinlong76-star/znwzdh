'use client'

/**
 * 首页单个分类区块（从 navigation-content.tsx 拆出，2026-10-19 P1-2）。
 *
 * 负责分类标题、折叠/置顶/排序控件、一级与二级站点的拖拽/收录/多选。
 * 共享状态直接走 useHomeDIY()，拖拽目标等跨区块 UI 状态由父组件注入。
 */
import { useMemo, useState } from 'react'
import { NavigationCard } from '@/components/navigation-card'
import { CategoryInSituControls } from '@/components/category-in-situ-controls'
import { ChevronDown, Pin, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  computeAdaptiveSiteRanking,
  isSafeSiteHref,
  sortCategoryItemsWithPinned,
} from '@/lib/modular/diy-presets'
import { createCustomSiteId } from '@/lib/modular/custom-site-input'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import type { CardDisplayMode } from '@/lib/modular/use-home-diy'
import { useToast } from '@/components/ui/use-toast'
import type { NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'

interface DropCategoryTarget {
  categoryId: string
  position: 'before' | 'after'
}

export interface NavigationCategorySectionProps {
  category: any
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

export function NavigationCategorySection({
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
    collapsedCategoryIds,
    pinnedSiteIdsByCategory,
    addSiteToCustomCategory,
    reclassifySite,
    togglePinSiteInCategory,
    toggleCollapseCategory,
    reorderCategory,
  } = useHomeDIY()

  const isPinned = pinnedCategoryIds.includes(category.id)
  const isCustom = Boolean(category.isCustom)
  const isCollapsed = collapsedCategoryIds.includes(category.id)
  const directCount = (category.items as any[])?.length || 0
  const subCats = (category.subCategories as any[]) || []
  const subCount = subCats.reduce((acc: number, sub: any) => acc + ((sub.items as any[])?.length || 0), 0)
  const totalCount = directCount + subCount
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
        ? computeAdaptiveSiteRanking((category.items as any[]) || [], { pinnedItemIds: categoryPinnedItemIds })
        : sortCategoryItemsWithPinned((category.items as any[]) || [], categoryPinnedItemIds),
    [category.items, categoryPinnedItemIds, isAdaptiveRankingEnabled]
  )

  /**
   * 选中态查找用 Set：`.includes()` 是 O(n)，而它对**每张卡片**都要跑一次，
   * 整体退化成 O(卡片数 × 选中数)。全选上千条时这一项就能占掉整帧预算。
   */
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])

  /** 二级分类的排序同样缓存（原来写在 render 的 map 回调里，每帧重算） */
  const sortedSubCategories = useMemo(
    () =>
      ((category.subCategories as any[]) || []).map((subCategory: any) => {
        const subPinnedItemIds = pinnedSiteIdsByCategory[subCategory.id] || []
        return {
          subCategory,
          subPinnedItemIds,
          sortedSubItems: isAdaptiveRankingEnabled
            ? computeAdaptiveSiteRanking((subCategory.items as any[]) || [], { pinnedItemIds: subPinnedItemIds })
            : sortCategoryItemsWithPinned((subCategory.items as any[]) || [], subPinnedItemIds),
        }
      }),
    [category.subCategories, pinnedSiteIdsByCategory, isAdaptiveRankingEnabled]
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
  /** 排版编辑与多选是「要对全部卡片动手」的模式：此时不截断，否则用户找不到被折叠的卡 */
  const forceFull = isEditingLayout || selectionMode

  const directGroup = useMemo(() => {
    const all = sortedDirectItems as any[]
    if (forceFull || expandedGroups.__direct__ || all.length <= limit) return { items: all }
    return { items: all.slice(0, limit) }
  }, [sortedDirectItems, forceFull, expandedGroups, limit])

  const subGroups = useMemo(
    () =>
      sortedSubCategories.map((entry) => {
        const all = entry.sortedSubItems as any[]
        const expanded = forceFull || Boolean(expandedGroups[entry.subCategory.id])
        return {
          ...entry,
          items: expanded || all.length <= limit ? all : all.slice(0, limit),
        }
      }),
    [sortedSubCategories, forceFull, expandedGroups, limit]
  )

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

  return (
                    <section
                      key={category.id}
                      id={category.id}
                      onDragOver={(e) => {
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
                                const exists = (category.items as any[])?.some(
                                  (item: any) => item.href === card.href || item.title === card.title
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
                                const exists = (category.items as any[])?.some(
                                  (item: any) => item.href === card.href || item.title === card.title
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
                        "cv-auto-section relative scroll-m-16 transition-all duration-200",
                        isPinned && "p-3 sm:p-4 rounded-2xl bg-primary/3 border border-primary/20 depth-surface",
                        isEditingLayout && "p-3 sm:p-4 rounded-2xl border-2 border-dashed border-primary/30 bg-muted/20",
                        dragOverCustomCatId === category.id && "ring-2 ring-emerald-500 bg-emerald-500/10 rounded-2xl border-emerald-500/60"
                      )}
                    >
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
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40 font-medium">
                              {totalCount} 站点
                            </span>
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
                            />
                          )}
                        </div>

                        {/* 未折叠时渲染分类下挂载的站点和二级分类 */}
                        {!isCollapsed && (
                          <>
                            {/* 一级分类下直接挂载的站点 */}
                            {(sortedDirectItems.length > 0 || isCustom) && (
                              <div
                                className={cn(gridColumnsClass, "transition-all duration-200")}
                                style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                              >
                                {directGroup.items.map((item: any) => (
                                  <NavigationCard
                                    key={item.id}
                                    item={item}
                                    siteConfig={siteData}
                                    onPeek={(item) => setPeekItem(item, category.id)}
                                    keyboardHintId={keyboardHintId}
                                    cardDisplayMode={cardDisplayMode}
                                    isPinnedInCategory={categoryPinnedItemIds.includes(item.id)}
                                    onTogglePinInCategory={(siteId) => togglePinSiteInCategory(category.id, siteId)}
                                    isDraggable={isEditingLayout}
                                    sourceCategoryId={category.id}
                                    selectable={selectionMode}
                                    selected={selectedIdSet.has(item.id)}
                                    onToggleSelect={toggleSelectOne}
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
                                    <div className="flex items-center gap-2 pb-0.5 pt-1">
                                      <span className="w-1 h-3.5 rounded-full bg-muted-foreground/40" />
                                      <h3 className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                                        {subCategory.title}
                                      </h3>
                                      <span className="text-xs text-muted-foreground/60 font-mono">
                                        ({subCategory.items?.length || 0})
                                      </span>
                                    </div>
                                    <div
                                      className={cn(gridColumnsClass, "transition-all duration-200")}
                                      style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                    >
                                      {items.map((item: any) => (
                                        <NavigationCard
                                          key={item.id}
                                          item={item}
                                          siteConfig={siteData}
                                          onPeek={(item) => setPeekItem(item, subCategory.id)}
                                          keyboardHintId={keyboardHintId}
                                          cardDisplayMode={cardDisplayMode}
                                          isPinnedInCategory={subPinnedItemIds.includes(item.id)}
                                          onTogglePinInCategory={(siteId) => togglePinSiteInCategory(subCategory.id, siteId)}
                                          isDraggable={isEditingLayout}
                                          sourceCategoryId={subCategory.id}
                                          selectable={selectionMode}
                                          selected={selectedIdSet.has(item.id)}
                                          onToggleSelect={toggleSelectOne}
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
                          </>
                        )}
                      </div>
                    </section>
  )
}
