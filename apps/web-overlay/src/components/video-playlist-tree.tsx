'use client'

/**
 * 视频播放页的播放列表树（分类 → 子分类 → 视频）。
 *
 * 2026-11-09 A-2 第二步：从 video-player-page.tsx 原样搬出，纯搬家不改行为；
 * 展开状态仍由父组件持有（自动选中首个视频时要联动展开），这里只做展示与回调上抛。
 */
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, PlayCircle } from 'lucide-react'
import type { NavigationCategory, NavigationItem, NavigationSubItem } from '@/types/navigation'

interface VideoPlaylistTreeProps {
  navigationItems: NavigationItem[]
  selectedVideo: NavigationSubItem | null
  onSelectVideo: (video: NavigationSubItem) => void
  expandedCategories: Set<string>
  onToggleCategory: (categoryId: string) => void
  expandedSubCategories: Set<string>
  onToggleSubCategory: (subCategoryId: string) => void
}

export function VideoPlaylistTree({
  navigationItems,
  selectedVideo,
  onSelectVideo,
  expandedCategories,
  onToggleCategory,
  expandedSubCategories,
  onToggleSubCategory,
}: VideoPlaylistTreeProps) {
  const renderVideoItem = (item: NavigationSubItem) => {
    const isSelected = selectedVideo?.id === item.id
    const hasVideoConfig = !!item.videoConfig

    return (
      <button
        key={item.id}
        onClick={() => hasVideoConfig && onSelectVideo(item)}
        disabled={!hasVideoConfig}
        className={cn(
          "w-full text-left px-3 py-2 rounded-lg transition-all duration-200 flex items-start gap-2",
          "hover:bg-accent/50",
          isSelected && "bg-primary/10 text-primary border-l-2 border-primary",
          !hasVideoConfig && "opacity-50 cursor-not-allowed"
        )}
      >
        <PlayCircle className={cn(
          "w-4 h-4 mt-0.5 flex-shrink-0",
          isSelected ? "text-primary" : "text-muted-foreground"
        )} />
        <span className="text-sm line-clamp-2">{item.title}</span>
      </button>
    )
  }

  const renderSubCategory = (sub: NavigationCategory) => {
    const isExpanded = expandedSubCategories.has(sub.id)
    const videoItems = (sub.items || []).filter(item => item.enabled !== false)

    if (videoItems.length === 0) return null

    return (
      <div key={sub.id} className="ml-2">
        <button
          onClick={() => onToggleSubCategory(sub.id)}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/30 rounded-md transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          <span>{sub.title}</span>
          <span className="ml-auto text-xs text-muted-foreground">{videoItems.length}</span>
        </button>
        {isExpanded && (
          <div className="ml-4 mt-1 space-y-0.5">
            {videoItems.map(item => renderVideoItem(item))}
          </div>
        )}
      </div>
    )
  }

  const renderCategory = (category: NavigationItem) => {
    const isExpanded = expandedCategories.has(category.id)
    const hasSubCategories = category.subCategories && category.subCategories.length > 0
    const directItems = (category.items || []).filter(item => item.enabled !== false)
    const totalItems = hasSubCategories
      ? category.subCategories!.reduce((sum, sub) => sum + (sub.items?.length || 0), 0)
      : directItems.length

    if (totalItems === 0) return null

    return (
      <div key={category.id} className="mb-2">
        <button
          onClick={() => onToggleCategory(category.id)}
          className="w-full flex items-center gap-2 px-3 py-2 font-medium hover:bg-accent/50 rounded-lg transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-primary" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
          <span>{category.title}</span>
          <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {totalItems}
          </span>
        </button>
        {isExpanded && (
          <div className="mt-1 space-y-1">
            {hasSubCategories ? (
              category.subCategories!.map(sub => renderSubCategory(sub))
            ) : (
              <div className="ml-4 space-y-0.5">
                {directItems.map(item => renderVideoItem(item))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return <>{navigationItems.map(category => renderCategory(category))}</>
}
