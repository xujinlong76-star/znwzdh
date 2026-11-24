'use client'

import { useState } from 'react'
import type { ComponentType } from 'react'
import dynamic from 'next/dynamic'
import { Pin, ArrowUp, ArrowDown, EyeOff, Trash2, GripVertical, SlidersHorizontal, Loader2, Plus } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { removeFeatureFromMask } from '@/lib/modular/feature-mask-store'
import { useModuleWindowSize } from '@/lib/modular/module-resize-store'
import type { CardDisplayMode } from '@/lib/modular/home-diy-storage'
import { getCardDisplayModeMeta } from '@/lib/modular/card-display-modes'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

/**
 * 分类头 📐 菜单内容（Bundle 瘦身第二刀）：下拉内容子树已抽到
 * category-density-menu-content.tsx，只在菜单打开时经 next/dynamic 按需
 * 加载，平时不进 `/` 初始 chunk。触发按钮与尺寸/高亮态留在父组件。
 * 触发按钮 hover/focus 时预取 chunk；chunk 未就绪时点按先加载、就绪后
 * 自动开菜单（受控 open），不出现“点了没反应”。
 */
const CategoryDensityMenuContent = dynamic(
  () => import('./category-density-menu-content'),
  { ssr: false, loading: () => null },
)

interface CategoryInSituControlsProps {
  categoryId: string
  title: string
  isPinned: boolean
  isCustom?: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  allCategoryIds: string[]
  /**
   * 是否启用拖拽手柄：调用方在 dnd-kit chunk 已加载时传 dragEnabled +
   * dragGrip（DiyCategoryDragGrip，来自重型 diy-drag-kit，调用方后台
   * import 到才传）。手柄组件本身调用 useDraggable，必须在
   * DragDropProvider 内——所以用组件 prop 传进来，本文件绝不静态 import
   * @dnd-kit/react（否则 133KB 进首页首屏）。子分类也传：只在同一父分
   * 类内重排，跨父移动不允许（落点是父级 section，navigation-content
   * 的 handleCategoryDragEnd 用指针位置在同级里定位；子分组故意不注
   * 册自己的 droppable，见 navigation-category-section 的注释）。
   */
  dragEnabled?: boolean
  dragGrip?: ComponentType<{ categoryId: string; isCustom: boolean; title: string }>
  /**
   * 是否为子分类：子分类的 ↑/↓ 不能走 moveCategory——它只跟 flat
   * order 里的相邻元素换位，相邻的可能是别的父分类的子分类或顶级
   * 分类，换了等于没动还弹「已移动」的 toast。子分类走 reorderCategory，
   * 以相邻同级为锚点在 flat order 里重排（与拖拽同一语义）。
   */
  isSubcategory?: boolean
  onAddSite?: () => void
}

export function CategoryInSituControls({
  categoryId,
  title,
  isPinned,
  isCustom = false,
  canMoveUp,
  canMoveDown,
  allCategoryIds,
  dragEnabled = false,
  dragGrip: DragGrip,
  isSubcategory = false,
  onAddSite,
}: CategoryInSituControlsProps) {
  const {
    togglePinCategory,
    moveCategory,
    reorderCategory,
    toggleHideCategory,
    deleteCustomCategory,
    categoryDensityOverrides,
    setCategoryDensityOverride,
  } = useHomeDIY()
  const { toast } = useToast()
  const { colSpan, heightPx, isCustomSized, setSize, resetSize } = useModuleWindowSize(
    `cat:${categoryId}`,
    { colSpan: 12 }
  )

  const currentDensity = categoryDensityOverrides[categoryId]

  // 📐 菜单受控 open：chunk 未就绪时点按先加载、就绪后自动开菜单。
  const [densityMenuOpen, setDensityMenuOpen] = useState(false)
  const [densityMenuReady, setDensityMenuReady] = useState(false)
  const [densityMenuLoading, setDensityMenuLoading] = useState(false)

  const prefetchDensityMenu = () => {
    if (densityMenuReady) return
    void import('./category-density-menu-content').then(
      () => setDensityMenuReady(true),
      () => {
        /* 加载失败不阻塞：用户点开时再重试一次 */
      },
    )
  }

  const handleDensityMenuOpenChange = (open: boolean) => {
    if (!open) {
      setDensityMenuOpen(false)
      return
    }
    if (densityMenuReady) {
      setDensityMenuOpen(true)
      return
    }
    setDensityMenuLoading(true)
    void import('./category-density-menu-content').then(
      () => {
        setDensityMenuReady(true)
        setDensityMenuLoading(false)
        setDensityMenuOpen(true)
      },
      () => {
        setDensityMenuLoading(false)
        toast({ title: '菜单加载失败，请重试' })
      },
    )
  }

  // 菜单内容在子组件里是纯展示：状态写回与 toast 都在父组件的回调里完成。
  const handleSelectWidth = (col: number, label: string) => {
    setSize({ colSpan: col })
    toast({ title: `「${title}」模块宽度已设为 ${label} (${col}/12列)` })
  }

  const handleSelectHeight = (h: number | undefined, _label: string) => {
    setSize({ heightPx: h })
    toast({
      title: h
        ? `「${title}」窗口高度已设为 ${h}px`
        : `「${title}」已恢复自适应全展开高度`,
    })
  }

  const handleResetSize = () => {
    resetSize()
    toast({ title: `「${title}」已恢复默认全宽与自适应高度` })
  }

  const handleSelectDensity = (mode: CardDisplayMode | undefined) => {
    setCategoryDensityOverride(categoryId, mode)
    const label =
      mode === undefined
        ? '已恢复跟随全局展示样式'
        : `已设为「${getCardDisplayModeMeta(mode).label}」展示样式`
    toast({ title: `「${title}」${label}` })
  }

  const handlePin = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    togglePinCategory(categoryId)
    toast({
      title: isPinned ? `已取消置顶分类: ${title}` : `📌 已置顶分类: ${title}`,
    })
  }

  const handleMoveUp = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const from = allCategoryIds.indexOf(categoryId)
    if (isSubcategory) {
      // 同级锚点重排（见 isSubcategory 注释）：没有上一个同级就不动
      const prevId = from > 0 ? allCategoryIds[from - 1] : undefined
      if (!prevId) return
      reorderCategory(categoryId, prevId, 'before', allCategoryIds)
    } else {
      moveCategory(categoryId, 'up', allCategoryIds)
    }
    if (from > 0) {
      toast({ title: `已将分类「${title}」上移，现在是第 ${from} 个，共 ${allCategoryIds.length} 个` })
    }
  }

  const handleMoveDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const from = allCategoryIds.indexOf(categoryId)
    if (isSubcategory) {
      const nextId =
        from >= 0 && from < allCategoryIds.length - 1 ? allCategoryIds[from + 1] : undefined
      if (!nextId) return
      reorderCategory(categoryId, nextId, 'after', allCategoryIds)
    } else {
      moveCategory(categoryId, 'down', allCategoryIds)
    }
    if (from >= 0 && from < allCategoryIds.length - 1) {
      toast({ title: `已将分类「${title}」下移，现在是第 ${from + 2} 个，共 ${allCategoryIds.length} 个` })
    }
  }

  const handleHide = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggleHideCategory(categoryId)
    removeFeatureFromMask({
      id: `cat:${categoryId}`,
      level: 'L2_CATEGORY',
      title: `分类：${title}`,
      parentTitle: 'L2 一级大类',
      previousIndex: allCategoryIds.indexOf(categoryId),
    })
    toast({
      title: `👁️ 已隐藏分类: ${title}`,
      description: '已移入时间轴回收站，按 Ctrl/Cmd+Z 可立即撤销，或在 DIY 恢复中心随时恢复。',
    })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    deleteCustomCategory(categoryId)
    toast({
      title: `🗑️ 已删除专属分类: ${title}`,
    })
  }

  return (
    <div data-category-in-situ="" className="flex items-center gap-1 bg-background/90 dark:bg-card/90 backdrop-blur-md px-2 py-0.5 rounded-full border border-border/80 shadow-xs animate-in fade-in zoom-in-95 duration-150">
      {dragEnabled && DragGrip ? (
        <DragGrip categoryId={categoryId} isCustom={isCustom} title={title} />
      ) : (
        <div
          className="flex items-center justify-center h-6.5 w-5 rounded-md text-muted-foreground"
          title={
            dragEnabled
              ? '拖拽手柄加载中，稍候即可拖拽；也可直接用 ↑/↓ 按钮移动'
              : '拖拽手柄未启用，可用 ↑/↓ 按钮移动'
          }
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={handlePin}
        className={cn(
          "h-11 w-11 rounded-full transition-colors",
          isPinned
            ? "text-primary bg-primary/10 hover:bg-primary/20"
            : "text-muted-foreground hover:text-foreground"
        )}
        title={isPinned ? "取消置顶" : "置顶该分类到最上方"}
        aria-label={isPinned ? `取消置顶分类：${title}` : `置顶分类：${title}`}
      >
        <Pin className={cn("w-3.5 h-3.5", isPinned && "fill-primary")} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleMoveUp}
        disabled={!canMoveUp}
        className="h-11 w-11 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
        title="向上移动分类"
        aria-label={`上移分类：${title}`}
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleMoveDown}
        disabled={!canMoveDown}
        className="h-11 w-11 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
        title="向下移动分类"
        aria-label={`下移分类：${title}`}
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleHide}
        className="h-11 w-11 rounded-full text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
        title="隐藏该分类"
        aria-label={`隐藏分类：${title}`}
      >
        <EyeOff className="w-3.5 h-3.5" />
      </Button>

      {/* 📐 分类专属密度与窗口尺寸覆盖下拉（内容按需加载，见文件头注释） */}
      <DropdownMenu open={densityMenuOpen} onOpenChange={handleDensityMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-11 w-11 rounded-full transition-colors",
              (currentDensity || isCustomSized) ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
            )}
            title={
              currentDensity || isCustomSized
                ? `当前尺寸: ${colSpan}/12列${heightPx ? `×${heightPx}px` : ''} · 密度: ${currentDensity || '全局'}`
                : "📐 调整模块窗口尺寸与卡片形态（亦可直接拖拽模块上下左右四边）"
            }
            aria-label="针对此类目调整窗口尺寸与卡片形态"
            aria-busy={densityMenuLoading || undefined}
            onMouseEnter={prefetchDensityMenu}
            onFocus={prefetchDensityMenu}
          >
            {densityMenuLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <SlidersHorizontal className="w-3.5 h-3.5" />
            )}
          </Button>
        </DropdownMenuTrigger>
        {densityMenuOpen && (
          <CategoryDensityMenuContent
            categoryId={categoryId}
            title={title}
            colSpan={colSpan}
            heightPx={heightPx}
            isCustomSized={isCustomSized}
            currentDensity={currentDensity}
            onSelectWidth={handleSelectWidth}
            onSelectHeight={handleSelectHeight}
            onResetSize={handleResetSize}
            onSelectDensity={handleSelectDensity}
          />
        )}
      </DropdownMenu>

      {onAddSite && (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onAddSite()
          }}
          className="h-11 w-11 rounded-full text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
          title="添加站点到该分类"
          aria-label={`添加站点到分类：${title}`}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      )}

      {isCustom && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          className="h-11 w-11 rounded-full text-muted-foreground hover:text-destructive-text hover:bg-destructive/15"
          title="删除此自建专属分类"
          aria-label={`删除专属分类：${title}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  )
}
