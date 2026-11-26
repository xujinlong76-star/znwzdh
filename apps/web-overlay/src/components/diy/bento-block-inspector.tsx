'use client'

import { memo } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Columns,
  Lock,
  Maximize2,
  ScrollText,
  SlidersHorizontal,
  Trash2,
  Unlock,
  X,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  colsForBreakpoint,
  type BlockCardVariant,
  type BlockHeightMode,
  type BlockUpdatePatch,
  type LayoutBlock,
  type WorkspaceBreakpointKey,
} from '@/lib/modular/workspace-layout-v2'
import { cn } from '@/lib/utils'

export interface BentoBlockInspectorProps {
  block: LayoutBlock | null
  title: string
  breakpoint: WorkspaceBreakpointKey
  canDelete?: boolean
  onUpdate: (patch: BlockUpdatePatch) => void
  onTrash: () => void
  onClose: () => void
}

const CARD_VARIANT_OPTIONS: Array<{ id: BlockCardVariant | 'inherit'; label: string }> = [
  { id: 'inherit', label: '跟随全局' },
  { id: 'capsule', label: '极速胶囊' },
  { id: 'compact', label: '紧凑列表' },
  { id: 'icon-only', label: '仅图标' },
]

const INNER_COLS_OPTIONS: Array<{ id: number | 'auto'; label: string }> = [
  { id: 'auto', label: '自动' },
  { id: 1, label: '1列' },
  { id: 2, label: '2列' },
  { id: 3, label: '3列' },
  { id: 4, label: '4列' },
]

export const BentoBlockInspector = memo(function BentoBlockInspector({
  block,
  title,
  breakpoint,
  canDelete = true,
  onUpdate,
  onTrash,
  onClose,
}: BentoBlockInspectorProps) {
  if (!block) return null

  const totalCols = colsForBreakpoint(breakpoint)
  const widthPresets =
    totalCols === 12
      ? [
          { w: 4, label: '1/3 (4列)' },
          { w: 6, label: '1/2 (6列)' },
          { w: 8, label: '2/3 (8列)' },
          { w: 12, label: '全宽 (12列)' },
        ]
      : totalCols === 8
        ? [
            { w: 4, label: '1/2 (4列)' },
            { w: 8, label: '全宽 (8列)' },
          ]
        : [{ w: 4, label: '全宽 (4列)' }]

  const heightMode: BlockHeightMode = block.heightMode ?? 'auto'
  const currentVariant = block.style?.cardVariant ?? 'inherit'
  const currentInnerCols = block.style?.innerCols ?? 'auto'
  const isCollapsed = Boolean(block.style?.collapsed)

  return (
    <aside
      data-testid="diy-block-inspector"
      aria-label={`区块属性检查器：${title}`}
      className={cn(
        'fixed z-50 border border-border/80 bg-background/95 dark:bg-card/95 backdrop-blur-xl shadow-2xl',
        // 桌面端右侧紧凑浮层；窄屏下转为底部抽屉，不挤占画布
        'inset-x-3 bottom-20 max-h-[65vh] overflow-y-auto rounded-2xl p-4',
        'md:inset-x-auto md:right-4 md:top-20 md:bottom-auto md:w-72 md:max-h-[calc(100vh-11rem)]',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="truncate text-xs font-bold text-foreground">{title}</h3>
            <p className="font-mono text-[10px] text-muted-foreground">
              {breakpoint.toUpperCase()} · x:{block.x} y:{block.y} · {block.w}/{totalCols}列
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭属性检查器"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-3.5 text-xs">
        {/* 快捷列宽 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-foreground/90">
            <Columns className="h-3.5 w-3.5 text-primary" />
            <span>快捷列宽</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {widthPresets.map((preset) => (
              <button
                key={preset.w}
                type="button"
                data-testid={`inspector-width-${preset.w}`}
                disabled={block.locked}
                onClick={() => onUpdate({ w: preset.w })}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed',
                  block.w === preset.w
                    ? 'border-primary bg-primary/15 text-primary font-semibold'
                    : 'border-border/70 bg-muted/30 text-foreground hover:border-primary/50',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* 高度策略 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-foreground/90">
            <ScrollText className="h-3.5 w-3.5 text-primary" />
            <span>高度策略</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="inspector-height-auto"
              onClick={() => onUpdate({ heightMode: 'auto' })}
              className={cn(
                'inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors cursor-pointer',
                heightMode === 'auto'
                  ? 'border-primary bg-primary/15 text-primary font-semibold'
                  : 'border-border/70 bg-muted/30 text-foreground hover:border-primary/50',
              )}
            >
              <Maximize2 className="h-3 w-3" />
              <span>自适应内容</span>
            </button>
            <button
              type="button"
              data-testid="inspector-height-fixed"
              onClick={() => onUpdate({ heightMode: 'fixed-scroll', h: Math.min(block.h, 8) })}
              className={cn(
                'inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors cursor-pointer',
                heightMode === 'fixed-scroll'
                  ? 'border-primary bg-primary/15 text-primary font-semibold'
                  : 'border-border/70 bg-muted/30 text-foreground hover:border-primary/50',
              )}
            >
              <ScrollText className="h-3 w-3" />
              <span>固定高度滚动</span>
            </button>
          </div>
        </div>

        {/* 卡片形态 & 内部列数（仅分类 / 自定义分组显示） */}
        {(block.type === 'category' || block.type === 'custom_group') && (
          <>
            <div className="space-y-1.5">
              <div className="font-semibold text-foreground/90">卡片形态覆写</div>
              <div className="grid grid-cols-2 gap-1.5">
                {CARD_VARIANT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      onUpdate({
                        style: {
                          cardVariant: opt.id === 'inherit' ? undefined : opt.id,
                        },
                      })
                    }
                    className={cn(
                      'rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors cursor-pointer',
                      currentVariant === opt.id
                        ? 'border-primary bg-primary/15 text-primary font-semibold'
                        : 'border-border/70 bg-muted/30 text-foreground hover:border-primary/50',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="font-semibold text-foreground/90">内部卡片列数</div>
              <div className="grid grid-cols-5 gap-1">
                {INNER_COLS_OPTIONS.map((opt) => (
                  <button
                    key={String(opt.id)}
                    type="button"
                    onClick={() => onUpdate({ style: { innerCols: opt.id } })}
                    className={cn(
                      'rounded-lg border px-1.5 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                      currentInnerCols === opt.id
                        ? 'border-primary bg-primary/15 text-primary font-semibold'
                        : 'border-border/70 bg-muted/30 text-foreground hover:border-primary/50',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 区块操作 */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="inspector-toggle-lock"
            onClick={() => onUpdate({ locked: !block.locked })}
            className={cn(
              'h-8 flex-1 gap-1 rounded-lg text-[11px]',
              block.locked && 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300',
            )}
          >
            {block.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            <span>{block.locked ? '解锁位置' : '锁定位置'}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="inspector-toggle-collapse"
            onClick={() => onUpdate({ style: { collapsed: !isCollapsed } })}
            className="h-8 flex-1 gap-1 rounded-lg text-[11px]"
          >
            {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            <span>{isCollapsed ? '展开内容' : '折叠区块'}</span>
          </Button>
          {canDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="inspector-trash-block"
              onClick={onTrash}
              className="h-8 w-full gap-1 rounded-lg text-[11px] border-rose-500/40 text-rose-700 dark:text-rose-200 hover:bg-rose-500/15"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>移入回收站（可原位还原）</span>
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
})
