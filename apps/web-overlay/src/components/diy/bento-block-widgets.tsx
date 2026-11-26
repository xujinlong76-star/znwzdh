'use client'

import { memo, type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'
import { Flame, GripVertical, Lock, Search, SlidersHorizontal, Zap } from 'lucide-react'
import type { LayoutBlock } from '@/lib/modular/workspace-layout-v2'
import { HomeQuickDock } from '@/components/home-quick-dock'
import { cn } from '@/lib/utils'

type SpeedDialSite = NonNullable<ComponentProps<typeof HomeQuickDock>['speedSites']>[number]

export interface UnifiedWidgetChromeProps {
  block: LayoutBlock
  title: string
  icon: ReactNode
  badge?: string
  isEditing: boolean
  isSelected: boolean
  isCompactOutline: boolean
  totalCols: number
  onSelect: (id: string) => void
  children: ReactNode
}

export const UnifiedWidgetChrome = memo(function UnifiedWidgetChrome({
  block,
  title,
  icon,
  badge,
  isEditing,
  isSelected,
  isCompactOutline,
  totalCols,
  onSelect,
  children,
}: UnifiedWidgetChromeProps) {
  if (isCompactOutline) {
    return (
      <div
        data-bento-outline-card={block.id}
        onClick={() => onSelect(block.id)}
        className={cn(
          'js-block-drag-handle flex h-full items-center justify-between gap-2 rounded-xl border px-3 py-2 cursor-grab active:cursor-grabbing transition-colors select-none',
          isSelected
            ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
            : 'border-dashed border-primary/40 bg-card/90 hover:border-primary/70',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span data-testid="block-drag-handle" className="inline-flex shrink-0 items-center justify-center">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </span>
          <span className="shrink-0 text-primary">{icon}</span>
          <span className="truncate text-xs font-semibold text-foreground">{title}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {block.locked && <Lock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />}
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
            {block.w}/{totalCols}
          </span>
        </div>
      </div>
    )
  }

  return (
    <section
      className={cn(
        'h-full rounded-2xl border bg-card/85 backdrop-blur-sm transition-shadow',
        isEditing
          ? isSelected
            ? 'border-primary ring-2 ring-primary/30 shadow-md p-3'
            : 'border-dashed border-primary/40 hover:border-primary/70 p-3'
          : 'border-border/60 p-3',
        block.heightMode === 'fixed-scroll' && 'flex flex-col overflow-hidden',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 pb-2 mb-2 border-b border-border/40',
          isEditing && 'js-block-drag-handle cursor-grab active:cursor-grabbing select-none',
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {isEditing && (
            <span data-testid="block-drag-handle" className="inline-flex shrink-0 items-center justify-center">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          )}
          <span className="shrink-0 text-primary">{icon}</span>
          <h3 className="truncate text-xs font-bold text-foreground">{title}</h3>
          {badge && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {badge}
            </span>
          )}
          {block.locked && (
            <Lock className="h-3 w-3 shrink-0 text-amber-700 dark:text-amber-300" aria-label="已锁定位置" />
          )}
        </div>
        {isEditing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(block.id)
            }}
            data-testid={`bento-inspect-${block.id}`}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border/60 bg-background/80 px-1.5 text-[11px] font-medium text-muted-foreground hover:border-primary/50 hover:text-primary cursor-pointer"
            title="调整区块列宽、高度与形态"
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span className="font-mono">{block.w}/{totalCols}</span>
          </button>
        )}
      </div>
      <div
        className={cn(
          'js-block-no-drag min-w-0',
          block.heightMode === 'fixed-scroll' && 'flex-1 overflow-y-auto pr-1 custom-scrollbar',
        )}
      >
        {children}
      </div>
    </section>
  )
})

export interface BentoSearchBlockProps {
  block: LayoutBlock
  isEditing: boolean
  isSelected: boolean
  isCompactOutline: boolean
  totalCols: number
  onSelect: (id: string) => void
  onTriggerSearch: () => void
}

export const BentoSearchBlock = memo(function BentoSearchBlock({
  block,
  isEditing,
  isSelected,
  isCompactOutline,
  totalCols,
  onSelect,
  onTriggerSearch,
}: BentoSearchBlockProps) {
  return (
    <UnifiedWidgetChrome
      block={block}
      title="聚合搜索"
      icon={<Search className="h-3.5 w-3.5" />}
      badge="⌘K"
      isEditing={isEditing}
      isSelected={isSelected}
      isCompactOutline={isCompactOutline}
      totalCols={totalCols}
      onSelect={onSelect}
    >
      <button
        type="button"
        onClick={onTriggerSearch}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border-strong bg-background/90 px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors cursor-pointer"
      >
        <span className="inline-flex items-center gap-2 truncate">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">搜索 4,500+ 站点、标签或拼音…</span>
        </span>
        <kbd className="hidden @sm:inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          Ctrl+K
        </kbd>
      </button>
    </UnifiedWidgetChrome>
  )
})

export interface BentoDockBlockProps {
  block: LayoutBlock
  isEditing: boolean
  isSelected: boolean
  isCompactOutline: boolean
  totalCols: number
  onSelect: (id: string) => void
  speedSites: SpeedDialSite[]
  dialDigitById?: ReadonlyMap<string, number>
}

export const BentoDockBlock = memo(function BentoDockBlock({
  block,
  isEditing,
  isSelected,
  isCompactOutline,
  totalCols,
  onSelect,
  speedSites,
  dialDigitById,
}: BentoDockBlockProps) {
  return (
    <UnifiedWidgetChrome
      block={block}
      title="高频速览坞"
      icon={<Zap className="h-3.5 w-3.5" />}
      badge={`${speedSites.length} 站`}
      isEditing={isEditing}
      isSelected={isSelected}
      isCompactOutline={isCompactOutline}
      totalCols={totalCols}
      onSelect={onSelect}
    >
      <HomeQuickDock speedSites={speedSites} dialDigitById={dialDigitById} />
    </UnifiedWidgetChrome>
  )
})

export interface BentoHotlistBlockProps {
  block: LayoutBlock
  isEditing: boolean
  isSelected: boolean
  isCompactOutline: boolean
  totalCols: number
  onSelect: (id: string) => void
  hotSites: readonly SpeedDialSite[]
}

export const BentoHotlistBlock = memo(function BentoHotlistBlock({
  block,
  isEditing,
  isSelected,
  isCompactOutline,
  totalCols,
  onSelect,
  hotSites,
}: BentoHotlistBlockProps) {
  return (
    <UnifiedWidgetChrome
      block={block}
      title="全站热榜精选"
      icon={<Flame className="h-3.5 w-3.5 text-orange-500" />}
      badge={`Top ${hotSites.length}`}
      isEditing={isEditing}
      isSelected={isSelected}
      isCompactOutline={isCompactOutline}
      totalCols={totalCols}
      onSelect={onSelect}
    >
      <div className="space-y-1.5">
        <div className="grid grid-cols-1 @md:grid-cols-2 gap-1.5">
          {hotSites.slice(0, 8).map((site, idx) => (
            <a
              key={site.id}
              href={site.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={(e) => {
                if (isEditing) e.preventDefault()
              }}
              className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/70 px-2.5 py-1.5 text-xs hover:border-primary/40 hover:bg-primary/5 transition-colors"
            >
              <span
                className={cn(
                  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold',
                  idx < 3
                    ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {idx + 1}
              </span>
              <span className="truncate font-medium text-foreground">{site.title}</span>
            </a>
          ))}
        </div>
        <div className="flex justify-end pt-1">
          <Link
            href="/hot"
            prefetch={false}
            onClick={(e) => {
              if (isEditing) e.preventDefault()
            }}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            查看完整热榜 →
          </Link>
        </div>
      </div>
    </UnifiedWidgetChrome>
  )
})
