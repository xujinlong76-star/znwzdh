'use client'

import { useState, useMemo } from 'react'
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
  Check,
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

export interface HomeDIYOutlineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  allCategoryIds: string[]
  categoryTitleMap: Record<string, string>
  pinnedCategoryIds: string[]
  hiddenCategoryIds: string[]
  collapsedCategoryIds: string[]
  customCategories: any[]
  isAdaptiveRankingEnabled: boolean
  healthReport: any
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

export function HomeDIYOutlineDialog({
  open,
  onOpenChange,
  allCategoryIds,
  categoryTitleMap,
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
  const [searchQuery, setSearchQuery] = useState('')

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-xl max-h-[85dvh] flex flex-col p-4 sm:p-6">
        <DialogHeader className="pb-3 border-b border-border/50 pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Layers className="w-5 h-5 text-indigo-500" />
            <span>分类全景管理大纲</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            集中调整所有系统分类与私人专属分类的先后次序、置顶与显隐状态（点击分类名称可直达）。
          </DialogDescription>
        </DialogHeader>

        {/* 快速预设与搜索栏 */}
        <div className="flex items-center justify-between gap-2 pt-2.5">
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
            const isHidden = hiddenCategoryIds.includes(id)
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
                    className="truncate text-foreground font-semibold hover:text-primary hover:underline text-left cursor-pointer transition-colors"
                    title="点击跳转并平滑滚动至该分类"
                  >
                    {title}
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
                    onClick={() => toggleHideCategory(id)}
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
            {hiddenCategoryIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={unhideAllCategories}
                className="text-xs text-primary h-7 px-2"
              >
                恢复所有隐藏 ({hiddenCategoryIds.length})
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
