'use client'

import React, { useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface ModuleResizeHandlesProps {
  /** 指向当前模块根节点的 ref，用于测量父级 12 栅格列宽与当前实际高度 */
  moduleRef: React.RefObject<HTMLElement | null>
  /** 当前列宽跨度 (12 栅格) */
  colSpan: number
  minColSpan?: number
  maxColSpan?: number
  /** 像素高度模式：当前高度上限（undefined 表示自适应高度） */
  heightPx?: number
  minHeightPx?: number
  maxHeightPx?: number
  /** 栅格行高模式（如工作台小组件）：当前行跨度 */
  rowSpan?: number
  minRowSpan?: number
  maxRowSpan?: number
  rowUnitPx?: number
  /** 是否处于全局排版编辑态（编辑态下常显抓手指示条，普通态悬停边缘渐显） */
  isEditing?: boolean
  /** 尺寸变化回调 */
  onResizeChange: (
    next: { colSpan?: number; heightPx?: number; rowSpan?: number },
    isFinal: boolean
  ) => void
  /** 一次连续拖拽开始时触发（用于压入撤销栈快照） */
  onBeginResize?: () => void
  /** 双击任一边框手柄恢复默认窗口尺寸 */
  onReset?: () => void
  /** 通知父组件当前是否正在拖拽缩放（用于抑制父级 HTML5 dragstart） */
  onResizingStateChange?: (isResizing: boolean) => void
}

const DIRECTION_CURSORS: Record<ResizeDirection, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

export function ModuleResizeHandles({
  moduleRef,
  colSpan,
  minColSpan = 4,
  maxColSpan = 12,
  heightPx,
  minHeightPx = 200,
  maxHeightPx = 1200,
  rowSpan,
  minRowSpan = 1,
  maxRowSpan = 6,
  rowUnitPx = 115,
  isEditing = false,
  onResizeChange,
  onBeginResize,
  onReset,
  onResizingStateChange,
}: ModuleResizeHandlesProps) {
  const [activeDir, setActiveDir] = useState<ResizeDirection | null>(null)
  const [liveDims, setLiveDims] = useState<{
    colSpan: number
    heightPx?: number
    rowSpan?: number
  } | null>(null)

  const currentColRef = useRef(colSpan)
  const currentHeightRef = useRef(heightPx)
  const currentRowRef = useRef(rowSpan)

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

  const startResize = useCallback(
    (dir: ResizeDirection, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()

      const el = moduleRef.current
      const container = el?.parentElement
      if (!el || !container) return

      const styles = window.getComputedStyle(container)
      const gap = parseFloat(styles.columnGap || '16') || 16
      const gridWidth = container.clientWidth || 1200
      const colWidth = Math.max(36, (gridWidth + gap) / 12)

      const startX = e.clientX
      const startY = e.clientY
      const startCol = colSpan
      const measuredHeight = el.getBoundingClientRect().height || 360
      const startHeight =
        heightPx ??
        Math.min(
          maxHeightPx,
          Math.max(minHeightPx, Math.round(measuredHeight > 760 ? 640 : measuredHeight))
        )
      const startRow = rowSpan ?? 1

      currentColRef.current = startCol
      currentHeightRef.current = heightPx
      currentRowRef.current = rowSpan

      setActiveDir(dir)
      setLiveDims({
        colSpan: startCol,
        heightPx: heightPx ?? Math.round(measuredHeight),
        rowSpan: startRow,
      })
      onResizingStateChange?.(true)
      onBeginResize?.()

      const prevCursor = document.body.style.cursor
      const prevUserSelect = document.body.style.userSelect
      const prevElTransition = el.style.transition
      const prevElWillChange = el.style.willChange

      document.body.style.cursor = DIRECTION_CURSORS[dir]
      document.body.style.userSelect = 'none'
      el.style.transition = 'none'
      el.style.willChange = 'width, height, max-height'

      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      } catch {
        // 忽略不支持 pointerCapture 的环境
      }

      const affectsX = dir.includes('e') || dir.includes('w')
      const affectsY = dir.includes('n') || dir.includes('s')
      const isWest = dir.includes('w')
      const isNorth = dir.includes('n')
      const useRowMode = rowSpan !== undefined

      let rafId: number | null = null
      let latestEvent: PointerEvent | null = null

      const updateResize = () => {
        rafId = null
        if (!latestEvent) return
        const moveEvent = latestEvent

        const rawDx = moveEvent.clientX - startX
        const rawDy = moveEvent.clientY - startY

        const dx = isWest ? -rawDx : rawDx
        const dy = isNorth ? -rawDy : rawDy

        let nextCol = currentColRef.current
        let nextHeight = currentHeightRef.current
        let nextRow = currentRowRef.current

        if (affectsX) {
          const deltaCols = Math.round(dx / colWidth)
          nextCol = clamp(startCol + deltaCols, minColSpan, maxColSpan)
        }

        if (affectsY) {
          if (useRowMode) {
            const deltaRows = Math.round(dy / rowUnitPx)
            nextRow = clamp(startRow + deltaRows, minRowSpan, maxRowSpan)
          } else {
            // 按 8px 步进平滑量化窗口高度
            const rawTargetH = startHeight + dy
            nextHeight = clamp(Math.round(rawTargetH / 8) * 8, minHeightPx, maxHeightPx)
          }
        }

        const colChanged = nextCol !== currentColRef.current
        const heightChanged = !useRowMode && nextHeight !== currentHeightRef.current
        const rowChanged = useRowMode && nextRow !== currentRowRef.current

        if (colChanged || heightChanged || rowChanged) {
          currentColRef.current = nextCol
          currentHeightRef.current = nextHeight
          currentRowRef.current = nextRow
          setLiveDims({
            colSpan: nextCol,
            heightPx: nextHeight,
            rowSpan: nextRow,
          })
          onResizeChange(
            {
              colSpan: nextCol,
              ...(useRowMode ? { rowSpan: nextRow } : { heightPx: nextHeight }),
            },
            false
          )
        }
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        latestEvent = moveEvent
        if (rafId === null) {
          rafId = requestAnimationFrame(updateResize)
        }
      }

      const handlePointerUp = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevUserSelect
        el.style.transition = prevElTransition
        el.style.willChange = prevElWillChange

        setActiveDir(null)
        setLiveDims(null)
        onResizingStateChange?.(false)
        onResizeChange(
          {
            colSpan: currentColRef.current,
            ...(useRowMode
              ? { rowSpan: currentRowRef.current }
              : { heightPx: currentHeightRef.current }),
          },
          true
        )
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove, { passive: true })
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [
      moduleRef,
      colSpan,
      heightPx,
      rowSpan,
      minColSpan,
      maxColSpan,
      minHeightPx,
      maxHeightPx,
      minRowSpan,
      maxRowSpan,
      rowUnitPx,
      onResizeChange,
      onBeginResize,
      onResizingStateChange,
    ]
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onReset?.()
    },
    [onReset]
  )

  const displayCol = liveDims?.colSpan ?? colSpan
  const displayHeight = liveDims?.heightPx ?? heightPx
  const displayRow = liveDims?.rowSpan ?? rowSpan

  if (!isEditing && !activeDir) {
    return null
  }

  return (
    <>
      {/* 拖拽实时尺寸 HUD 浮标 */}
      {activeDir && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 rounded-2xl ring-2 ring-primary/80 bg-primary/[0.02] flex items-start justify-center pt-2.5"
        >
          <div className="px-3.5 py-1.5 rounded-full bg-slate-900/95 dark:bg-slate-950/95 text-white text-xs font-mono shadow-2xl border border-primary/50 backdrop-blur-md flex items-center gap-2.5 animate-in fade-in zoom-in-95 duration-100">
            <span className="inline-flex items-center gap-1.5 text-primary font-bold">
              <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
              📐 模块尺寸
            </span>
            <span className="font-semibold text-slate-100">
              {displayCol === 12
                ? '全宽铺满 (12列 / 100%)'
                : displayCol === 6
                  ? '半屏双栏 (6列 / 50%)'
                  : displayCol === 4
                    ? '三栏并排 (4列 / 33%)'
                    : displayCol === 8
                      ? '双倍主栏 (8列 / 67%)'
                      : `宽 ${displayCol}/12 列 (${Math.round((displayCol / 12) * 100)}%)`}
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-200">
              {displayRow !== undefined
                ? `高 ${displayRow} 行`
                : displayHeight
                  ? `高度上限 ${displayHeight}px (独立滚动)`
                  : '自适应高度 (展开全部)'}
            </span>
          </div>
        </div>
      )}

      {/* 左边缘：左右拖拉调整宽度 (West) — 置于盒内 left-0 防止 contain:paint 裁剪 */}
      <div
        aria-hidden="true"
        data-resize-handle="w"
        onPointerDown={(e) => startResize('w', e)}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
        title="左右拖拉左边框调整模块宽度（双击恢复默认尺寸）"
        className={cn(
          'group/handle-w absolute inset-y-2 left-0 w-3 z-30 cursor-ew-resize flex flex-col items-start justify-between py-8 pl-0.5 select-none transition-opacity',
          isEditing || activeDir === 'w'
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
        )}
      >
        <div
          className={cn(
            'w-1 h-8 rounded-full transition-all duration-150',
            activeDir === 'w'
              ? 'bg-primary h-12 shadow-md shadow-primary/50 scale-x-125'
              : isEditing
                ? 'bg-primary/45 group-hover/handle-w:bg-primary group-hover/handle-w:h-10'
                : 'bg-border/80 group-hover/handle-w:bg-primary group-hover/handle-w:h-10'
          )}
        />
        <div
          className={cn(
            'w-1 h-8 rounded-full transition-all duration-150',
            activeDir === 'w'
              ? 'bg-primary h-12 shadow-md shadow-primary/50 scale-x-125'
              : isEditing
                ? 'bg-primary/45 group-hover/handle-w:bg-primary group-hover/handle-w:h-10'
                : 'bg-border/80 group-hover/handle-w:bg-primary group-hover/handle-w:h-10'
          )}
        />
      </div>

      {/* 右边缘：左右拖拉调整宽度 (East) — 置于盒内 right-0 防止 contain:paint 裁剪 */}
      <div
        aria-hidden="true"
        data-resize-handle="e"
        onPointerDown={(e) => startResize('e', e)}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
        title="左右拖拉右边框调整模块宽度（双击恢复默认尺寸）"
        className={cn(
          'group/handle-e absolute inset-y-2 right-0 w-3 z-30 cursor-ew-resize flex flex-col items-end justify-between py-8 pr-0.5 select-none transition-opacity',
          isEditing || activeDir === 'e'
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
        )}
      >
        <div
          className={cn(
            'w-1 h-8 rounded-full transition-all duration-150',
            activeDir === 'e'
              ? 'bg-primary h-12 shadow-md shadow-primary/50 scale-x-125'
              : isEditing
                ? 'bg-primary/45 group-hover/handle-e:bg-primary group-hover/handle-e:h-10'
                : 'bg-border/80 group-hover/handle-e:bg-primary group-hover/handle-e:h-10'
          )}
        />
        <div
          className={cn(
            'w-1 h-8 rounded-full transition-all duration-150',
            activeDir === 'e'
              ? 'bg-primary h-12 shadow-md shadow-primary/50 scale-x-125'
              : isEditing
                ? 'bg-primary/45 group-hover/handle-e:bg-primary group-hover/handle-e:h-10'
                : 'bg-border/80 group-hover/handle-e:bg-primary group-hover/handle-e:h-10'
          )}
        />
      </div>

      {/* 上边缘：上下拖拉调整高度 (North) — 置于盒内 top-0 */}
      <div
        aria-hidden="true"
        data-resize-handle="n"
        onPointerDown={(e) => startResize('n', e)}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
        title="上下拖拉上边框调整模块高度（双击恢复默认尺寸）"
        className={cn(
          'group/handle-n absolute inset-x-8 top-0 h-3 z-30 cursor-ns-resize flex items-start justify-center pt-0.5 select-none transition-opacity',
          isEditing || activeDir === 'n'
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
        )}
      >
        <div
          className={cn(
            'h-1 w-12 rounded-full transition-all duration-150',
            activeDir === 'n'
              ? 'bg-primary w-20 shadow-md shadow-primary/50 scale-y-125'
              : isEditing
                ? 'bg-primary/40 group-hover/handle-n:bg-primary group-hover/handle-n:w-16'
                : 'bg-border/70 group-hover/handle-n:bg-primary group-hover/handle-n:w-16'
          )}
        />
      </div>

      {/* 下边缘：上下拖拉调整高度 (South) — 置于盒内 bottom-0 */}
      <div
        aria-hidden="true"
        data-resize-handle="s"
        onPointerDown={(e) => startResize('s', e)}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
        title="上下拖拉下边框调整模块窗口高度（双击恢复自适应高度）"
        className={cn(
          'group/handle-s absolute inset-x-8 bottom-0 h-3.5 z-30 cursor-ns-resize flex items-end justify-center pb-0.5 select-none transition-opacity',
          isEditing || activeDir === 's'
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
        )}
      >
        <div
          className={cn(
            'h-1.5 w-14 rounded-full transition-all duration-150',
            activeDir === 's'
              ? 'bg-primary w-24 shadow-md shadow-primary/50 scale-y-125'
              : isEditing
                ? 'bg-primary/45 group-hover/handle-s:bg-primary group-hover/handle-s:w-20'
                : 'bg-border/80 group-hover/handle-s:bg-primary group-hover/handle-s:w-20'
          )}
        />
      </div>

      {/* 左下角：双向自由缩放手柄 (South-West) */}
      <div
        aria-hidden="true"
        data-resize-handle="sw"
        onPointerDown={(e) => startResize('sw', e)}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
        title="按住左下角同时左右上下拖拉窗口大小（双击重置）"
        className={cn(
          'group/handle-sw absolute bottom-0 left-0 w-4 h-4 z-35 cursor-nesw-resize flex items-end justify-start p-1 select-none transition-opacity',
          isEditing || activeDir === 'sw'
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
        )}
      >
        <div
          className={cn(
            'w-2.5 h-2.5 border-l-2 border-b-2 rounded-bl-xs transition-colors',
            activeDir === 'sw'
              ? 'border-primary scale-125'
              : 'border-muted-foreground/60 group-hover/handle-sw:border-primary'
          )}
        />
      </div>

      {/* 右下角：双向自由缩放手柄 (South-East) */}
      <div
        aria-hidden="true"
        data-resize-handle="se"
        onPointerDown={(e) => startResize('se', e)}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
        title={`当前尺寸: ${displayCol} 列 × ${displayRow !== undefined ? `${displayRow} 行` : displayHeight ? `${displayHeight}px` : '自适应'}（按住右下角左右上下自由拖拉，双击重置）`}
        className={cn(
          'group/handle-se absolute bottom-0 right-0 p-1.5 z-35 cursor-nwse-resize flex items-end justify-end text-muted-foreground hover:text-primary transition-all select-none',
          isEditing || activeDir === 'se'
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 hover:opacity-100'
        )}
      >
        <span className="opacity-0 group-hover/handle-se:opacity-100 text-[10px] font-mono bg-background/95 border border-border/80 px-1.5 py-0.5 rounded mr-1 mb-0.5 shadow-xs transition-opacity whitespace-nowrap">
          {displayCol}列×{displayRow !== undefined ? `${displayRow}行` : displayHeight ? `${displayHeight}px` : '自适应'}
        </span>
        <svg
          className="w-3 h-3 fill-current opacity-75 group-hover/handle-se:opacity-100"
          viewBox="0 0 6 6"
        >
          <path d="M6 6H4V4H6V6ZM6 2H4V0H6V2ZM2 6H0V4H2V6Z" />
        </svg>
      </div>
    </>
  )
}
