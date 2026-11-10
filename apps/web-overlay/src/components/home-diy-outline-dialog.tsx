'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Layers,
  Sparkles,
  Info,
  Pin,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Trash2,
  Activity,
  Search,
  RotateCcw,
  SlidersHorizontal,
  Check,
  Undo2,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/registry/new-york/ui/dialog'
import { Input } from '@/registry/new-york/ui/input'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import {
  useFeatureMask,
  L1_MODULE_CATALOG,
  L3_MICRO_CATALOG,
  L4_FEATURE_CATALOG,
  stripFeaturePrefix,
  type FeatureGranularityLevel,
} from '@/lib/modular/feature-mask-store'
import type { CustomCategory } from '@/lib/modular/home-diy-storage'
import type { LayoutHealthReport } from '@/lib/modular/diy-presets'

export type OutlineDialogTab = 'outline' | 'matrix' | 'trash'

/**
 * 分类树的形状（只声明本组件实际用到的字段）。
 *
 * 为什么不用 any：这个弹窗只读 title / id / subCategories 三个字段，
 * 写清楚之后 subCategories.map 里的 sub 就不用再标 any 了。
 */
interface OutlineCategoryLike {
  id: string
  title: string
  subCategories?: OutlineCategoryLike[]
  items?: unknown[]
}

export interface HomeDIYOutlineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: OutlineDialogTab
  allCategoryIds: string[]
  categoryTitleMap: Record<string, string>
  categories?: OutlineCategoryLike[]
  pinnedCategoryIds: string[]
  hiddenCategoryIds: string[]
  collapsedCategoryIds: string[]
  customCategories: CustomCategory[]
  isAdaptiveRankingEnabled: boolean
  healthReport: LayoutHealthReport
  togglePinCategory: (id: string) => void
  moveCategory: (id: string, direction: 'up' | 'down', allIds: string[]) => void
  toggleCollapseCategory: (id: string) => void
  toggleHideCategory: (id: string) => void
  unhideAllCategories: () => void
  deleteCustomCategory: (id: string) => void
  toggleAdaptiveRanking: () => void
  collapseAllCategories: (ids: string[]) => void
  expandAllCategories: () => void
  setHiddenCategories?: (ids: string[]) => void
}

const LEVEL_BADGE_META: Record<
  FeatureGranularityLevel,
  { label: string; className: string }
> = {
  L1_MODULE: {
    label: 'L1 全局模块',
    className: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/25',
  },
  L2_CATEGORY: {
    label: 'L2 一级大类',
    className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25',
  },
  L2_SUBCATEGORY: {
    label: 'L2 二级子分类',
    className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25',
  },
  L3_SITE: {
    label: 'L3 单个站点',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  },
  L3_MICRO: {
    label: 'L3 卡片微元素',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25',
  },
  L4_FEATURE: {
    label: 'L4 交互特性',
    className: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/25',
  },
}

function formatRelativeDeletedTime(deletedAt: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - deletedAt) / 1000))
  if (diffSec < 15) return '刚刚'
  if (diffSec < 60) return `${diffSec} 秒前`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay} 天前`
}

export function HomeDIYOutlineDialog({
  open,
  onOpenChange,
  initialTab = 'outline',
  allCategoryIds,
  categoryTitleMap,
  categories = [],
  pinnedCategoryIds,
  hiddenCategoryIds,
  collapsedCategoryIds,
  customCategories,
  isAdaptiveRankingEnabled,
  healthReport,
  togglePinCategory,
  moveCategory,
  toggleCollapseCategory,
  toggleHideCategory,
  unhideAllCategories,
  deleteCustomCategory,
  toggleAdaptiveRanking,
  collapseAllCategories,
  expandAllCategories,
  setHiddenCategories,
}: HomeDIYOutlineDialogProps) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<OutlineDialogTab>(initialTab)
  const [searchQuery, setSearchQuery] = useState('')

  const {
    cardElements,
    trashBin,
    totalPrunedCount,
    isModuleHidden,
    isCategoryHidden,
    isSubcategoryHidden,
    isFeatureHidden,
    removeFeature,
    restoreFeature,
    undoLastRemove,
    restoreAll,
    toggleCardElement,
    setCompactCapsuleMode,
  } = useFeatureMask()

  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab)
    }
  }, [open, initialTab])

  const filteredCategoryIds = useMemo(() => {
    if (!searchQuery.trim()) return allCategoryIds
    const q = searchQuery.trim().toLowerCase()
    return allCategoryIds.filter((id) => {
      const title = categoryTitleMap[id] || id
      return title.toLowerCase().includes(q) || id.toLowerCase().includes(q)
    })
  }, [allCategoryIds, categoryTitleMap, searchQuery])

  const handleApplyPreset = (type: 'all' | 'tech' | 'ai') => {
    if (type === 'all') {
      unhideAllCategories()
      toast({ title: '已恢复全部分类可见' })
      return
    }

    if (!setHiddenCategories) return

    if (type === 'tech') {
      const techPattern = /前端|后端|运维|安全|开发|云|架构|Dev|Database|AI/i
      const toHide = allCategoryIds.filter((id) => {
        const title = categoryTitleMap[id] || id
        return !techPattern.test(title)
      })
      setHiddenCategories(toHide)
      toast({
        title: '已应用「仅技术开发」大纲预设',
        description: `已聚焦核心技术开发类目，其余 ${toHide.length} 个分类已折叠隐藏`,
      })
    } else if (type === 'ai') {
      const aiPattern = /AI|智能|设计|创意|模型|Prompt|生成/i
      const toHide = allCategoryIds.filter((id) => {
        const title = categoryTitleMap[id] || id
        return !aiPattern.test(title)
      })
      setHiddenCategories(toHide)
      toast({
        title: '已应用「仅AI与创作」大纲预设',
        description: `已聚焦 AI 与创意设计类目，其余 ${toHide.length} 个分类已折叠隐藏`,
      })
    }
  }

  const handleScrollToCategory = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      onOpenChange(false)
      toast({ title: `已定位至分类: ${categoryTitleMap[id] || id}` })
    }
  }

  const handleRestoreTrashItem = (id: string) => {
    const restored = restoreFeature(id)
    const rawId = stripFeaturePrefix(id)
    if (id.startsWith('cat:') && hiddenCategoryIds.includes(rawId)) {
      toggleHideCategory(rawId)
    }
    toast({
      title: `✨ 已还原「${restored?.title || rawId}」`,
      description: '已无损恢复至原有位置。',
    })
  }

  const handleRestoreAllEverywhere = () => {
    restoreAll()
    unhideAllCategories()
    toast({
      title: '🔄 已无损恢复全站所有默认功能',
      description: '全部 L1~L4 模块、分类、子分类、站点与卡片微元素已恢复初始状态。',
    })
  }

  const isCapsuleMode = !cardElements.showDescription && !cardElements.showTags

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-2xl max-h-[86dvh] flex flex-col p-4 sm:p-6">
        <DialogHeader className="pb-2.5 border-b border-border/50 pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Layers className="w-5 h-5 text-indigo-500" />
            <span>全景功能矩阵与时间轴恢复中心</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            不可变基础配置 + 用户差异掩码层 + 时间轴回收站：自由裁剪任意模块、分类、站点或微元素，随时零丢失一键还原。
          </DialogDescription>

          {/* 3-Tab 导航切换栏 */}
          <div className="flex items-center gap-1.5 pt-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => setActiveTab('outline')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border',
                activeTab === 'outline'
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                  : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border/50'
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>分类大纲编排 ({allCategoryIds.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('matrix')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border',
                activeTab === 'matrix'
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                  : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border/50'
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>全景功能矩阵开关</span>
              {totalPrunedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-600 dark:text-amber-300">
                  已裁剪 {totalPrunedCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trash')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border',
                activeTab === 'trash'
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                  : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border/50'
              )}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>🗑️ 已删减功能回收站 ({trashBin.length})</span>
            </button>
          </div>
        </DialogHeader>

        {/* ==================== TAB 1: 分类大纲编排 ==================== */}
        {activeTab === 'outline' && (
          <>
            {/* 快速预设与搜索栏 */}
            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索类目名称快速定位…"
                  aria-label="搜索类目名称快速定位"
                  className="h-8 pl-8 text-xs rounded-lg bg-background/80"
                />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyPreset('all')}
                  className="h-8 px-2.5 text-xs rounded-lg hover:border-primary/50"
                >
                  全部
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyPreset('tech')}
                  className="h-8 px-2.5 text-xs rounded-lg hover:border-blue-500/50 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  仅技术开发
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyPreset('ai')}
                  className="h-8 px-2.5 text-xs rounded-lg hover:border-purple-500/50 hover:text-purple-600 dark:hover:text-purple-400"
                >
                  仅AI与创作
                </Button>
              </div>
            </div>

            {/* 排版人机工程学健康度与香农信息熵诊断卡片 */}
            {healthReport && (
              <div className="my-2 p-2.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 space-y-1.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-bold text-foreground">排版架构人机工程学评估</span>
                    <span
                      className={cn(
                        'text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase',
                        healthReport.level === 'excellent'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                          : healthReport.level === 'good'
                          ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20'
                          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                      )}
                    >
                      {healthReport.score} 分 ·{' '}
                      {healthReport.level === 'excellent' ? '极佳' : healthReport.level === 'good' ? '良好' : '需优化'}
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      toggleAdaptiveRanking()
                      toast({
                        title: !isAdaptiveRankingEnabled ? '✨ 已开启智能自适应排序' : '已恢复默认站点排序',
                        description: !isAdaptiveRankingEnabled
                          ? '已应用物理时间半衰期自适应衰减与趋势加权算法。'
                          : '分类内站点将按基础收录次序展示。',
                      })
                    }}
                    className={cn(
                      'h-6 px-2 text-[10px] rounded-full gap-1 border-border/80 transition-all',
                      isAdaptiveRankingEnabled && 'bg-violet-600 text-white hover:bg-violet-700 border-violet-500'
                    )}
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>自适应热度: {isAdaptiveRankingEnabled ? '已开启' : '关闭'}</span>
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] font-mono">
                  <div className="p-1.5 rounded-lg bg-background/60 border border-border/40">
                    <div className="text-muted-foreground text-[9px]">信息熵 H / 均衡度</div>
                    <div className="font-semibold text-foreground mt-0.5">
                      {healthReport.shannonEntropy} ({Math.round(healthReport.normalizedEntropy * 100)}%)
                    </div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-background/60 border border-border/40">
                    <div className="text-muted-foreground text-[9px]">可见 / 隐藏</div>
                    <div className="font-semibold text-foreground mt-0.5">
                      {healthReport.visibleCategories} / {healthReport.hiddenCategories} 类
                    </div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-background/60 border border-border/40">
                    <div className="text-muted-foreground text-[9px]">总收录站点</div>
                    <div className="font-semibold text-foreground mt-0.5">{healthReport.totalSites} 个</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-background/60 border border-border/40">
                    <div className="text-muted-foreground text-[9px]">置顶关注分类</div>
                    <div className="font-semibold text-foreground mt-0.5">{healthReport.pinnedCategories} 类</div>
                  </div>
                </div>

                {healthReport.suggestions?.length > 0 && (
                  <div className="pt-0.5 space-y-0.5">
                    {healthReport.suggestions.slice(0, 1).map((sug: string, i: number) => (
                      <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground leading-relaxed">
                        <Info className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                        <span>{sug}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 分类列表 */}
            <div className="py-2 flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredCategoryIds.map((id, index) => {
                const title = categoryTitleMap[id] || id
                const isPinned = pinnedCategoryIds.includes(id)
                const isHidden = hiddenCategoryIds.includes(id) || isCategoryHidden(id)
                const isCollapsed = collapsedCategoryIds.includes(id)
                const customCat = customCategories.find((c) => c.id === id)

                return (
                  <div
                    key={id}
                    className={cn(
                      'flex items-center justify-between p-2.5 rounded-xl border transition-all text-xs',
                      isHidden
                        ? 'bg-muted/30 border-dashed border-border/40 opacity-60'
                        : isPinned
                        ? 'bg-amber-500/5 border-amber-500/30 font-medium'
                        : 'bg-card/80 border-border/60'
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="font-mono text-muted-foreground text-[10px] w-5 text-center">
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleScrollToCategory(id)}
                        className={cn(
                          'truncate font-semibold hover:text-primary hover:underline text-left cursor-pointer transition-colors',
                          isHidden ? 'line-through text-muted-foreground' : 'text-foreground'
                        )}
                        title="点击跳转并平滑滚动至该分类"
                      >
                        {isHidden ? `🚫 ${title}` : title}
                      </button>
                      {customCat && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                          专属
                        </span>
                      )}
                      {isPinned && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 shrink-0 flex items-center gap-0.5">
                          <Pin className="w-2.5 h-2.5 fill-amber-500" />
                          <span>置顶</span>
                        </span>
                      )}
                      {isCollapsed && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20 shrink-0">
                          已收起
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => togglePinCategory(id)}
                        className={cn('h-7 w-7 rounded-md', isPinned && 'text-amber-500 bg-amber-500/10')}
                        title={isPinned ? '取消置顶' : '置顶分类'}
                        aria-label={isPinned ? '取消置顶' : '置顶分类'}
                      >
                        <Pin className={cn('w-3.5 h-3.5', isPinned && 'fill-amber-500')} />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === 0}
                        onClick={() => moveCategory(id, 'up', allCategoryIds)}
                        className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
                        title="上移"
                        aria-label="上移分类"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === allCategoryIds.length - 1}
                        onClick={() => moveCategory(id, 'down', allCategoryIds)}
                        className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
                        title="下移"
                        aria-label="下移分类"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleCollapseCategory(id)}
                        className={cn(
                          'h-7 w-7 rounded-md',
                          isCollapsed ? 'text-sky-500 bg-sky-500/10' : 'text-muted-foreground hover:text-foreground'
                        )}
                        title={isCollapsed ? '展开分类' : '收起/折叠分类'}
                        aria-label={isCollapsed ? '展开分类' : '收起分类'}
                      >
                        <ChevronsUpDown className="w-3.5 h-3.5" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (isHidden) {
                            restoreFeature(`cat:${id}`)
                            if (hiddenCategoryIds.includes(id)) toggleHideCategory(id)
                          } else {
                            toggleHideCategory(id)
                            removeFeature({
                              id: `cat:${id}`,
                              level: 'L2_CATEGORY',
                              title: `分类：${title}`,
                              parentTitle: 'L2 一级大类',
                              previousIndex: index,
                            })
                          }
                        }}
                        className={cn(
                          'h-7 w-7 rounded-md',
                          isHidden ? 'text-amber-500 bg-amber-500/10' : 'text-muted-foreground hover:text-foreground'
                        )}
                        title={isHidden ? '显示分类' : '隐藏分类'}
                        aria-label={isHidden ? '显示分类' : '隐藏分类'}
                      >
                        {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>

                      {customCat && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteCustomCategory(id)}
                          className="h-7 w-7 rounded-md text-muted-foreground hover:text-destructive-text hover:bg-destructive/15"
                          title="删除该专属分类"
                          aria-label="删除该专属分类"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ==================== TAB 2: 全景功能矩阵开关 ==================== */}
        {activeTab === 'matrix' && (
          <div className="py-2 flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
            {/* 1. L1 全局功能组件 */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="font-bold text-foreground flex items-center gap-1.5">
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/20">
                    L1
                  </span>
                  <span>全局功能组件（卸载后相邻模块自动向上吸附补位）</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {L1_MODULE_CATALOG.map((mod) => {
                  const hidden = isModuleHidden(mod.id)
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => {
                        if (hidden) {
                          restoreFeature(mod.id)
                          toast({ title: `✨ 已恢复模块「${mod.title}」` })
                        } else {
                          removeFeature({
                            id: mod.id,
                            level: 'L1_MODULE',
                            title: mod.title,
                            parentTitle: mod.parentTitle,
                          })
                          toast({ title: `🙈 已隐藏模块「${mod.title}」` })
                        }
                      }}
                      className={cn(
                        'flex items-start justify-between gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer',
                        hidden
                          ? 'bg-muted/30 border-dashed border-border/50 opacity-65 hover:opacity-100'
                          : 'bg-background/80 border-border/70 hover:border-primary/40'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={cn('font-semibold truncate', hidden && 'line-through text-muted-foreground')}>
                          {hidden ? `🚫 ${mod.title}` : mod.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                          {mod.description}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border',
                          hidden
                            ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25'
                        )}
                      >
                        {hidden ? '点击恢复' : '显示中'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. L3 卡片内部微元素 */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-3 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-bold text-foreground flex items-center gap-1.5">
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                    L3
                  </span>
                  <span>卡片内部微结构显隐（关闭简介与标签后自动坍缩为极简胶囊）</span>
                </div>
                <Button
                  type="button"
                  variant={isCapsuleMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    const next = !isCapsuleMode
                    setCompactCapsuleMode(next)
                    toast({
                      title: next ? '🧹 已开启「极简胶囊卡片」模式' : '✨ 已恢复完整卡片简介与标签',
                    })
                  }}
                  className="h-6 px-2 text-[11px] rounded-full"
                >
                  {isCapsuleMode ? '✓ 极简胶囊已开启（点击恢复）' : '🧹 一键精简：隐藏所有简介与标签'}
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {L3_MICRO_CATALOG.map((micro) => {
                  const enabled = cardElements[micro.elementKey]
                  return (
                    <button
                      key={micro.id}
                      type="button"
                      onClick={() => toggleCardElement(micro.elementKey)}
                      className={cn(
                        'flex items-start justify-between gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer',
                        !enabled
                          ? 'bg-muted/30 border-dashed border-border/50 opacity-65 hover:opacity-100'
                          : 'bg-background/80 border-border/70 hover:border-primary/40'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={cn('font-semibold truncate', !enabled && 'line-through text-muted-foreground')}>
                          {!enabled ? `🚫 ${micro.title}` : micro.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                          {micro.description}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border',
                          !enabled
                            ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25'
                        )}
                      >
                        {!enabled ? '已隐藏' : '显示中'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 3. L2 一级大类与二级子分类树 */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-3 space-y-2.5">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
                  L2
                </span>
                <span>主分类与二级子分类胶囊树（半透明删除线胶囊表示已删减，点击即刻恢复）</span>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {allCategoryIds.map((catId) => {
                  const catTitle = categoryTitleMap[catId] || catId
                  const catHidden = hiddenCategoryIds.includes(catId) || isCategoryHidden(catId)
                  const catObj = categories.find((c) => c.id === catId)
                  const subCats = Array.isArray(catObj?.subCategories) ? catObj.subCategories : []

                  return (
                    <div key={catId} className="p-2 rounded-lg border border-border/50 bg-background/60 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (catHidden) {
                              restoreFeature(`cat:${catId}`)
                              if (hiddenCategoryIds.includes(catId)) toggleHideCategory(catId)
                            } else {
                              toggleHideCategory(catId)
                              removeFeature({
                                id: `cat:${catId}`,
                                level: 'L2_CATEGORY',
                                title: `分类：${catTitle}`,
                                parentTitle: 'L2 一级大类',
                              })
                            }
                          }}
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer',
                            catHidden
                              ? 'line-through opacity-60 bg-muted/40 text-muted-foreground border-dashed border-border'
                              : 'bg-primary/10 text-primary border-primary/25 hover:bg-primary/20'
                          )}
                        >
                          <span>{catHidden ? `🚫 ${catTitle}` : `✓ ${catTitle}`}</span>
                        </button>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {subCats.length > 0 ? `${subCats.length} 个子分类` : '直属分类'}
                        </span>
                      </div>
                      {subCats.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pl-2 pt-0.5">
                          {subCats.map((sub: OutlineCategoryLike) => {
                            const subHidden = isSubcategoryHidden(sub.id)
                            return (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => {
                                  if (subHidden) {
                                    restoreFeature(`sub:${sub.id}`)
                                    toast({ title: `✨ 已恢复子分类「${sub.title}」` })
                                  } else {
                                    removeFeature({
                                      id: `sub:${sub.id}`,
                                      level: 'L2_SUBCATEGORY',
                                      title: sub.title,
                                      parentTitle: `${catTitle} > ${sub.title}`,
                                    })
                                    toast({ title: `📁 已隐藏子分类「${sub.title}」` })
                                  }
                                }}
                                className={cn(
                                  'px-2 py-0.5 rounded-md text-[11px] border transition-all cursor-pointer',
                                  subHidden
                                    ? 'line-through opacity-55 bg-muted/30 text-muted-foreground border-dashed border-border'
                                    : 'bg-muted/60 text-foreground hover:border-primary/40 border-border/50'
                                )}
                              >
                                {subHidden ? `🚫 ${sub.title}` : sub.title}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 4. L4 交互与实验室特性 */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-3 space-y-2.5">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20">
                  L4
                </span>
                <span>交互与实验室特性（防自锁死保护：键盘 E 键与 Cmd+K 搜索穿透永久有效）</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {L4_FEATURE_CATALOG.map((feat) => {
                  const hidden = isFeatureHidden(feat.id)
                  return (
                    <button
                      key={feat.id}
                      type="button"
                      onClick={() => {
                        if (hidden) {
                          restoreFeature(feat.id)
                          toast({ title: `✨ 已启用特性「${feat.title}」` })
                        } else {
                          removeFeature({
                            id: feat.id,
                            level: 'L4_FEATURE',
                            title: feat.title,
                            parentTitle: feat.parentTitle,
                          })
                          toast({ title: `🙈 已关闭特性「${feat.title}」` })
                        }
                      }}
                      className={cn(
                        'flex items-start justify-between gap-2 p-2.5 rounded-xl border text-left transition-all cursor-pointer',
                        hidden
                          ? 'bg-muted/30 border-dashed border-border/50 opacity-65 hover:opacity-100'
                          : 'bg-background/80 border-border/70 hover:border-primary/40'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={cn('font-semibold truncate', hidden && 'line-through text-muted-foreground')}>
                          {hidden ? `🚫 ${feat.title}` : feat.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                          {feat.description}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border',
                          hidden
                            ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25'
                        )}
                      >
                        {hidden ? '已禁用' : '已启用'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: 时间轴回收站 ==================== */}
        {activeTab === 'trash' && (
          <div className="py-2 flex-1 overflow-y-auto space-y-2.5 pr-1">
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-muted/40 border border-border/60 text-xs">
              <span className="text-muted-foreground">
                按删减时间倒序排列，点击「还原至原位」即可无损恢复对应的模块、分类或站点。
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={trashBin.length === 0}
                  onClick={() => {
                    const restored = undoLastRemove()
                    if (restored) {
                      if (restored.level === 'L2_CATEGORY') {
                        const rawId = stripFeaturePrefix(restored.id)
                        if (hiddenCategoryIds.includes(rawId)) toggleHideCategory(rawId)
                      }
                      toast({ title: `↩ 已撤销上一步：「${restored.title}」` })
                    }
                  }}
                  className="h-7 px-2.5 text-xs gap-1"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>↩ 撤销上一步</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={trashBin.length === 0 && totalPrunedCount === 0}
                  onClick={handleRestoreAllEverywhere}
                  className="h-7 px-2.5 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>🔄 全部恢复默认</span>
                </Button>
              </div>
            </div>

            {trashBin.length === 0 ? (
              <div className="py-12 text-center space-y-2 border border-dashed border-border/60 rounded-xl bg-muted/15">
                <Check className="w-7 h-7 text-emerald-500 mx-auto" />
                <p className="text-xs font-semibold text-foreground">时间轴回收站为空，全站所有模块与站点均完整呈现</p>
                <p className="text-[11px] text-muted-foreground">
                  您可以在「全景功能矩阵开关」或页面编排态中自由隐藏任意不常用的模块、分类或单站点。
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {trashBin.map((item) => {
                  const badge = LEVEL_BADGE_META[item.level] || LEVEL_BADGE_META.L1_MODULE
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border/70 bg-card/85 hover:border-primary/40 transition-all text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={cn(
                              'px-1.5 py-0.2 rounded text-[10px] font-mono font-medium border shrink-0',
                              badge.className
                            )}
                          >
                            {badge.label}
                          </span>
                          <span className="font-semibold text-foreground truncate">{item.title}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            · 删除于 {formatRelativeDeletedTime(item.deletedAt)}
                          </span>
                        </div>
                        {item.parentTitle && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            原属位置：{item.parentTitle}
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestoreTrashItem(item.id)}
                        className="h-7 px-2.5 text-xs rounded-lg gap-1 border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>还原至原位</span>
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="border-t border-border/40 pt-3 flex items-center justify-between sm:justify-between">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => collapseAllCategories(allCategoryIds)}
              className="text-xs text-muted-foreground hover:text-foreground h-7 px-2"
            >
              全部收起
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={expandAllCategories}
              className="text-xs text-muted-foreground hover:text-foreground h-7 px-2"
            >
              全部展开
            </Button>
            {(hiddenCategoryIds.length > 0 || totalPrunedCount > 0) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRestoreAllEverywhere}
                className="text-xs text-primary h-7 px-2"
              >
                🔄 恢复全部隐藏与删减 ({Math.max(hiddenCategoryIds.length, totalPrunedCount)})
              </Button>
            )}
          </div>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成管理
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
