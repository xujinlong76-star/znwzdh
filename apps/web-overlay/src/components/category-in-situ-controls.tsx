'use client'

import type { ComponentType } from 'react'
import { Pin, ArrowUp, ArrowDown, EyeOff, Trash2, GripVertical, SlidersHorizontal, Check, Plus } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { removeFeatureFromMask } from '@/lib/modular/feature-mask-store'
import { useModuleWindowSize } from '@/lib/modular/module-resize-store'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

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

      {/* 📐 分类专属密度与窗口尺寸覆盖下拉 */}
      <DropdownMenu>
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
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 p-1.5">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground px-1.5 py-1 flex items-center justify-between">
            <span>↔️ 模块左右宽度 (或拖拽左右边)</span>
            <span className="font-mono text-[10px] text-primary">{colSpan}/12列</span>
          </DropdownMenuLabel>
          <div className="grid grid-cols-4 gap-1 px-1 pb-1.5">
            {[
              { label: '1/3宽', col: 4 },
              { label: '1/2半屏', col: 6 },
              { label: '2/3宽', col: 8 },
              { label: '全宽', col: 12 },
            ].map((preset) => (
              <button
                key={preset.col}
                type="button"
                onClick={() => {
                  setSize({ colSpan: preset.col })
                  toast({ title: `「${title}」模块宽度已设为 ${preset.label} (${preset.col}/12列)` })
                }}
                className={cn(
                  "px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer border",
                  colSpan === preset.col
                    ? "bg-primary text-primary-foreground border-primary font-semibold"
                    : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/50"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <DropdownMenuLabel className="text-[11px] text-muted-foreground px-1.5 py-1 flex items-center justify-between border-t border-border/50 pt-1.5">
            <span>↕️ 模块上下高度 (或拖拽上下边)</span>
            <span className="font-mono text-[10px] text-primary">{heightPx ? `${heightPx}px` : '自适应'}</span>
          </DropdownMenuLabel>
          <div className="grid grid-cols-4 gap-1 px-1 pb-1.5">
            {[
              { label: '紧凑', h: 320 },
              { label: '标准', h: 480 },
              { label: '高窗', h: 680 },
              { label: '自适应', h: undefined },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setSize({ heightPx: preset.h })
                  toast({
                    title: preset.h
                      ? `「${title}」窗口高度已设为 ${preset.h}px`
                      : `「${title}」已恢复自适应全展开高度`,
                  })
                }}
                className={cn(
                  "px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer border",
                  heightPx === preset.h
                    ? "bg-primary text-primary-foreground border-primary font-semibold"
                    : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/50"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {isCustomSized && (
            <DropdownMenuItem
              onClick={() => {
                resetSize()
                toast({ title: `「${title}」已恢复默认全宽与自适应高度` })
              }}
              className="text-xs text-amber-600 dark:text-amber-400 font-medium cursor-pointer justify-center mb-1"
            >
              🔄 重置此模块窗口尺寸
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuLabel className="text-[11px] text-muted-foreground px-1.5 py-1">
            类目卡片形态覆盖
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              setCategoryDensityOverride(categoryId, undefined)
              toast({ title: `「${title}」已恢复跟随全局卡片形态` })
            }}
            className={cn("text-xs flex items-center justify-between cursor-pointer", !currentDensity && "font-bold text-primary")}
          >
            <span>默认 (跟随全局)</span>
            {!currentDensity && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setCategoryDensityOverride(categoryId, 'minimal')
              toast({ title: `「${title}」已设为 ⚡ 极速胶囊块` })
            }}
            className={cn("text-xs flex items-center justify-between cursor-pointer", currentDensity === 'minimal' && "font-bold text-primary")}
          >
            <span>⚡ 极速胶囊 (Mini Chip)</span>
            {currentDensity === 'minimal' && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setCategoryDensityOverride(categoryId, 'compact')
              toast({ title: `「${title}」已设为 紧凑条形` })
            }}
            className={cn("text-xs flex items-center justify-between cursor-pointer", currentDensity === 'compact' && "font-bold text-primary")}
          >
            <span>紧凑条形 (Compact)</span>
            {currentDensity === 'compact' && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setCategoryDensityOverride(categoryId, 'standard')
              toast({ title: `「${title}」已设为 标准图文` })
            }}
            className={cn("text-xs flex items-center justify-between cursor-pointer", currentDensity === 'standard' && "font-bold text-primary")}
          >
            <span>标准图文 (Standard)</span>
            {currentDensity === 'standard' && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setCategoryDensityOverride(categoryId, 'rich')
              toast({ title: `「${title}」已设为 深度丰富大图文` })
            }}
            className={cn("text-xs flex items-center justify-between cursor-pointer", currentDensity === 'rich' && "font-bold text-primary")}
          >
            <span>深度丰富 (Rich)</span>
            {currentDensity === 'rich' && <Check className="w-3.5 h-3.5 text-primary" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
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
