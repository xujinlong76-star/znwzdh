'use client'

import { Pin, ArrowUp, ArrowDown, EyeOff, Trash2, GripVertical } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
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
  onDragStart?: (e: React.DragEvent) => void
}

export function CategoryInSituControls({
  categoryId,
  title,
  isPinned,
  isCustom = false,
  canMoveUp,
  canMoveDown,
  allCategoryIds,
  onDragStart,
}: CategoryInSituControlsProps) {
  const { togglePinCategory, moveCategory, toggleHideCategory, deleteCustomCategory } = useHomeDIY()
  const { toast } = useToast()

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
    moveCategory(categoryId, 'up', allCategoryIds)
  }

  const handleMoveDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    moveCategory(categoryId, 'down', allCategoryIds)
  }

  const handleHide = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggleHideCategory(categoryId)
    toast({
      title: `👁️ 已隐藏分类: ${title}`,
      description: '可在底部排版工坊的「已隐藏」列表中随时恢复。',
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
    <div className="flex items-center gap-1 bg-background/90 dark:bg-card/90 backdrop-blur-md px-2 py-0.5 rounded-full border border-border/80 shadow-xs animate-in fade-in zoom-in-95 duration-150">
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/navhub-category-id', categoryId)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart?.(e)
        }}
        className="flex items-center justify-center h-6.5 w-5 rounded-md cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        title="按住拖拽调整此分类在页面上的排列位置"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={handlePin}
        className={cn(
          "h-6.5 w-6.5 rounded-full transition-colors",
          isPinned
            ? "text-primary bg-primary/10 hover:bg-primary/20"
            : "text-muted-foreground hover:text-foreground"
        )}
        title={isPinned ? "取消置顶" : "置顶该分类到最上方"}
      >
        <Pin className={cn("w-3.5 h-3.5", isPinned && "fill-primary")} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleMoveUp}
        disabled={!canMoveUp}
        className="h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
        title="向上移动分类"
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleMoveDown}
        disabled={!canMoveDown}
        className="h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
        title="向下移动分类"
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleHide}
        className="h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
        title="隐藏该分类"
      >
        <EyeOff className="w-3.5 h-3.5" />
      </Button>

      {isCustom && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          className="h-6.5 w-6.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="删除此自建专属分类"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  )
}
