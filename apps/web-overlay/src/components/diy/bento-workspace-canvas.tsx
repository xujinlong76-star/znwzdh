'use client'

/**
 * DIY 排版工坊 Phase 2：12 列 Bento 自由画布引擎（仅在 DIY 编辑态按需动态加载）。
 *
 * 核心保障：
 * 1. 基于 react-grid-layout@2.3.0 `GridLayout` + `useContainerWidth`（ResizeObserver 测量父容器真实宽度），
 *    侧边栏展开/收起零错位，首次测量完成前关闭 transition 防 CLS 闪烁；
 * 2. 双层拖拽三道防线隔离：
 *    - `dragConfig.handle = '.js-block-drag-handle'` 仅允许从区块标题栏抓手拖区块；
 *    - `dragConfig.cancel` 严格排除卡片区与交互控件；
 *    - `activeDragLayer` 全局互斥锁：拖卡片时外层禁用拖拽/缩放，拖/缩区块时内层禁用卡片拖拽；
 * 3. 大区块拖动防指针飞离方案：
 *    - 手动「大纲全景」模式：全部区块以 `h=2` 紧凑胶囊呈现，俯瞰拼积木；
 *    - 普通展开态拖动高区块（>260px）：**不改变 RGL 上方网格行高**（彻底避免 `react-draggable` 锚点上移导致指针抓空飞离），
 *      而是将被拖区块内部视觉紧凑化 + 非目标兄弟区块降噪预览，松手后自动恢复展开并 `scrollIntoView({ block: 'nearest' })`；
 * 4. 支持 `heightMode: 'auto'`（ResizeObserver 防抖自算行数，不写撤销栈）与 `heightMode: 'fixed-scroll'`（主动拉高锁定并内部滚动）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  GridLayout,
  noCompactor,
  useContainerWidth,
  verticalCompactor,
  type Layout,
} from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import {
  DEFAULT_WORKSPACE_GAP,
  DEFAULT_WORKSPACE_ROW_HEIGHT,
  colsForBreakpoint,
  computeAutoRowsForHeight,
  reconcileBreakpointBlocks,
  resolveBreakpointForWidth,
  type ActiveDragLayer,
  type AvailableWorkspaceBlock,
  type LayoutBlock,
  type RglCommittedItem,
  type WorkspaceBreakpointKey,
  type WorkspaceLayoutV2,
} from '@/lib/modular/workspace-layout-v2'
import { cn } from '@/lib/utils'

export interface BentoWorkspaceCanvasProps {
  layout: WorkspaceLayoutV2
  availableBlocks: readonly AvailableWorkspaceBlock[]
  isEditing: boolean
  activeDragLayer: ActiveDragLayer
  outlineMode: boolean
  selectedBlockId: string | null
  onActiveDragLayerChange: (layer: ActiveDragLayer) => void
  onSelectBlock: (blockId: string | null) => void
  onCommitBreakpointLayout: (
    bp: WorkspaceBreakpointKey,
    committed: readonly RglCommittedItem[],
    options?: { markFixedScrollForId?: string },
  ) => void
  onSyncAutoHeight: (bp: WorkspaceBreakpointKey, blockId: string, nextH: number) => void
  onBreakpointChange?: (bp: WorkspaceBreakpointKey) => void
  renderBlock: (
    block: LayoutBlock,
    meta: {
      breakpoint: WorkspaceBreakpointKey
      totalCols: number
      index: number
      isCompactOutline: boolean
      isDraggingSelf: boolean
      isSiblingDimmed: boolean
    },
  ) => ReactNode
}

const OUTLINE_BLOCK_ROWS = 2
const TALL_BLOCK_THRESHOLD_PX = 260

interface AutoHeightObserverProps {
  blockId: string
  enabled: boolean
  currentH: number
  minH: number
  rowHeight: number
  gapY: number
  onMeasureRows: (blockId: string, rows: number) => void
  children: ReactNode
}

function AutoHeightObserver({
  blockId,
  enabled,
  currentH,
  minH,
  rowHeight,
  gapY,
  onMeasureRows,
  children,
}: AutoHeightObserverProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentHRef = useRef(currentH)
  currentHRef.current = currentH

  useEffect(() => {
    if (!enabled) return
    const el = innerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const scheduleMeasure = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const height = el.getBoundingClientRect().height
        if (height <= 0) return
        const nextRows = computeAutoRowsForHeight(height, rowHeight, gapY, minH)
        if (nextRows !== currentHRef.current) {
          onMeasureRows(blockId, nextRows)
        }
      }, 120)
    }

    scheduleMeasure()
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, blockId, minH, rowHeight, gapY, onMeasureRows])

  return (
    <div ref={innerRef} className="w-full">
      {children}
    </div>
  )
}

export function BentoWorkspaceCanvas({
  layout,
  availableBlocks,
  isEditing,
  activeDragLayer,
  outlineMode,
  selectedBlockId,
  onActiveDragLayerChange,
  onSelectBlock,
  onCommitBreakpointLayout,
  onSyncAutoHeight,
  onBreakpointChange,
  renderBlock,
}: BentoWorkspaceCanvasProps) {
  const { width, mounted, containerRef } = useContainerWidth()
  const [hasSettledMeasure, setHasSettledMeasure] = useState(false)
  const [tallDraggingBlockId, setTallDraggingBlockId] = useState<string | null>(null)
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null)
  const resizeOriginHRef = useRef<number | null>(null)

  const breakpoint: WorkspaceBreakpointKey =
    mounted && width > 0 ? resolveBreakpointForWidth(width) : 'lg'
  const totalCols = colsForBreakpoint(breakpoint)
  const rowHeight = layout.gridConfig.rowHeight || DEFAULT_WORKSPACE_ROW_HEIGHT
  const [gapX, gapY] = layout.gridConfig.gap || DEFAULT_WORKSPACE_GAP
  const compactType = layout.gridConfig.compactType

  useEffect(() => {
    onBreakpointChange?.(breakpoint)
  }, [breakpoint, onBreakpointChange])

  // 首次测量完成后的下一帧再放开 CSS 过渡，彻底消除初始水合 CLS 动画抖动
  useEffect(() => {
    if (!mounted || width <= 0) return
    const raf = window.requestAnimationFrame(() => setHasSettledMeasure(true))
    return () => window.cancelAnimationFrame(raf)
  }, [mounted, width])

  const blocks = useMemo(
    () => reconcileBreakpointBlocks(layout, breakpoint, availableBlocks),
    [layout, breakpoint, availableBlocks],
  )

  const blockById = useMemo(() => {
    const map = new Map<string, LayoutBlock>()
    for (const b of blocks) map.set(b.id, b)
    return map
  }, [blocks])

  const rglLayout: Layout = useMemo(
    () =>
      blocks.map((block) => ({
        i: block.id,
        x: block.x,
        y: outlineMode ? Math.floor(block.y / 3) : block.y,
        w: block.w,
        h: outlineMode ? OUTLINE_BLOCK_ROWS : block.h,
        minW: block.minW ?? Math.min(4, totalCols),
        maxW: block.maxW ?? totalCols,
        minH: outlineMode ? OUTLINE_BLOCK_ROWS : block.minH ?? 3,
        static: Boolean(block.locked),
        isDraggable: !block.locked,
        isResizable: !block.locked && !outlineMode,
      })),
    [blocks, outlineMode, totalCols],
  )

  const handleMeasureRows = useCallback(
    (blockId: string, rows: number) => {
      onSyncAutoHeight(breakpoint, blockId, rows)
    },
    [breakpoint, onSyncAutoHeight],
  )

  const handleDragStart = useCallback(
    (_layout: Layout, oldItem: { i: string; h: number } | null) => {
      onActiveDragLayerChange('block')
      if (!oldItem) return
      setDraggingBlockId(oldItem.i)
      onSelectBlock(oldItem.i)
      // 测量当前被拖区块真实像素高度；若超过阈值（260px）且不在手动大纲态，
      // 启用视觉紧凑预览（不修改上方区块网格行高，从根本上杜绝指针抓空飞离）。
      if (!outlineMode) {
        const el = containerRef.current?.querySelector<HTMLElement>(
          `[data-bento-block-id="${CSS.escape(oldItem.i)}"]`,
        )
        const measuredH = el ? el.getBoundingClientRect().height : oldItem.h * (rowHeight + gapY)
        if (measuredH > TALL_BLOCK_THRESHOLD_PX) {
          setTallDraggingBlockId(oldItem.i)
        }
      }
    },
    [onActiveDragLayerChange, onSelectBlock, outlineMode, containerRef, rowHeight, gapY],
  )

  const handleDragStop = useCallback(
    (nextLayout: Layout, _oldItem: { i: string } | null, newItem: { i: string } | null) => {
      setDraggingBlockId(null)
      setTallDraggingBlockId(null)
      onActiveDragLayerChange('none')

      // 手动大纲态下提交新位置时保持原区块展开态行高 h，只提交新的 (x, y, w)
      const committed: RglCommittedItem[] = nextLayout.map((item) => {
        const orig = blockById.get(item.i)
        return {
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: outlineMode && orig ? orig.h : item.h,
        }
      })
      onCommitBreakpointLayout(breakpoint, committed)

      if (newItem?.i) {
        window.requestAnimationFrame(() => {
          const el = containerRef.current?.querySelector<HTMLElement>(
            `[data-bento-block-id="${CSS.escape(newItem.i)}"]`,
          )
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
    },
    [onActiveDragLayerChange, blockById, outlineMode, onCommitBreakpointLayout, breakpoint, containerRef],
  )

  const handleResizeStart = useCallback(
    (_layout: Layout, oldItem: { i: string; h: number } | null) => {
      onActiveDragLayerChange('resize')
      resizeOriginHRef.current = oldItem?.h ?? null
      if (oldItem) onSelectBlock(oldItem.i)
    },
    [onActiveDragLayerChange, onSelectBlock],
  )

  const handleResizeStop = useCallback(
    (nextLayout: Layout, _oldItem: { i: string } | null, newItem: { i: string; h: number } | null) => {
      onActiveDragLayerChange('none')
      const heightExplicitlyResized =
        newItem != null &&
        resizeOriginHRef.current != null &&
        newItem.h !== resizeOriginHRef.current
      resizeOriginHRef.current = null

      const committed: RglCommittedItem[] = nextLayout.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }))
      onCommitBreakpointLayout(breakpoint, committed, {
        markFixedScrollForId: heightExplicitlyResized && newItem ? newItem.i : undefined,
      })
    },
    [onActiveDragLayerChange, onCommitBreakpointLayout, breakpoint],
  )

  const compactor = compactType === 'vertical' ? verticalCompactor : noCompactor
  const outerDraggable = isEditing && activeDragLayer !== 'card'
  const outerResizable = isEditing && activeDragLayer !== 'card' && !outlineMode

  return (
    <div
      ref={containerRef}
      data-bento-canvas="rgl"
      data-bento-bp={breakpoint}
      data-bento-cols={totalCols}
      data-bento-outline={outlineMode ? 'true' : 'false'}
      data-bento-compact={compactType ?? 'free'}
      data-active-drag-layer={activeDragLayer}
      className={cn(
        'relative w-full',
        !hasSettledMeasure && '[&_.react-grid-item]:!transition-none',
        // 美化 RGL 占位槽与 se/e 缩放手柄，避免突兀丑陋的默认样式
        '[&_.react-grid-placeholder]:!rounded-2xl [&_.react-grid-placeholder]:!bg-primary/15 [&_.react-grid-placeholder]:!border-2 [&_.react-grid-placeholder]:!border-dashed [&_.react-grid-placeholder]:!border-primary/60 [&_.react-grid-placeholder]:!opacity-100',
        '[&_.react-resizable-handle]:!z-30',
        '[&_.react-resizable-handle-e]:!w-3 [&_.react-resizable-handle-e]:!right-0 [&_.react-resizable-handle-e]:!top-3 [&_.react-resizable-handle-e]:!bottom-3 [&_.react-resizable-handle-e]:!h-auto [&_.react-resizable-handle-e]:!mt-0 [&_.react-resizable-handle-e]:!cursor-ew-resize',
        '[&_.react-resizable-handle-e]:after:!content-[""] [&_.react-resizable-handle-e]:after:!absolute [&_.react-resizable-handle-e]:after:!right-0.5 [&_.react-resizable-handle-e]:after:!top-1/2 [&_.react-resizable-handle-e]:after:!-translate-y-1/2 [&_.react-resizable-handle-e]:after:!h-8 [&_.react-resizable-handle-e]:after:!w-1 [&_.react-resizable-handle-e]:after:!rounded-full [&_.react-resizable-handle-e]:after:!bg-primary/45 [&_.react-resizable-handle-e]:hover:after:!bg-primary',
        '[&_.react-resizable-handle-se]:!w-5 [&_.react-resizable-handle-se]:!h-5 [&_.react-resizable-handle-se]:!right-0.5 [&_.react-resizable-handle-se]:!bottom-0.5 [&_.react-resizable-handle-se]:!cursor-nwse-resize',
      )}
    >
      {tallDraggingBlockId && (
        <div
          data-testid="bento-tall-drag-banner"
          className="pointer-events-none sticky top-2 z-40 mx-auto mb-2 flex w-fit items-center gap-2 rounded-full border border-primary/40 bg-background/95 px-3 py-1 text-xs font-medium text-primary shadow-md backdrop-blur-md"
        >
          <span>紧凑拖动预览中：松手自动恢复展开并定位视野</span>
        </div>
      )}

      {mounted && width > 0 ? (
        <GridLayout
          width={width}
          layout={rglLayout}
          compactor={compactor}
          gridConfig={{
            cols: totalCols,
            rowHeight,
            margin: [gapX, gapY],
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: outerDraggable,
            handle: '.js-block-drag-handle',
            cancel:
              '.js-block-no-drag, [data-dnd-card], [data-diy-draggable], [data-diy-card-capsule], button, a, input, textarea, select',
            threshold: 4,
          }}
          resizeConfig={{
            enabled: outerResizable,
            handles: ['se', 'e'],
            handleComponent: (axis, ref) => (
              <span
                ref={ref}
                data-testid={`block-resize-${axis}`}
                aria-label={axis === 'e' ? '向右/左拖拽调整区块列宽' : '拖拽右下角调整区块宽高'}
                className={`react-resizable-handle react-resizable-handle-${axis}`}
              />
            ),
          }}
          onDragStart={handleDragStart}
          onDragStop={handleDragStop}
          onResizeStart={handleResizeStart}
          onResizeStop={handleResizeStop}
        >
          {blocks.map((block, index) => {
            const isDraggingSelf = draggingBlockId === block.id
            const isTallSelf = tallDraggingBlockId === block.id
            const isSiblingDimmed = Boolean(tallDraggingBlockId && tallDraggingBlockId !== block.id)
            const autoHeightActive =
              !outlineMode &&
              block.heightMode !== 'fixed-scroll' &&
              activeDragLayer === 'none'
            const isSelected = selectedBlockId === block.id

            return (
              <div
                key={block.id}
                data-testid="layout-block"
                data-block-id={block.id}
                data-bento-block-id={block.id}
                data-bento-block-type={block.type}
                data-bento-bp={breakpoint}
                data-bento-x={block.x}
                data-bento-y={block.y}
                data-bento-w={block.w}
                data-bento-h={block.h}
                data-bento-selected={isSelected ? 'true' : undefined}
                data-bento-tall-preview={isTallSelf ? 'true' : undefined}
                className={cn(
                  'min-w-0 @container',
                  isSelected && 'z-20',
                  isDraggingSelf && 'z-30',
                  block.heightMode === 'fixed-scroll' && 'overflow-y-auto custom-scrollbar',
                  isTallSelf && 'max-h-[112px] overflow-hidden shadow-2xl',
                  isSiblingDimmed && 'opacity-70 transition-opacity duration-150',
                )}
                style={{ containerType: 'inline-size' }}
              >
                <AutoHeightObserver
                  blockId={block.id}
                  enabled={autoHeightActive}
                  currentH={block.h}
                  minH={block.minH ?? 3}
                  rowHeight={rowHeight}
                  gapY={gapY}
                  onMeasureRows={handleMeasureRows}
                >
                  {renderBlock(block, {
                    breakpoint,
                    totalCols,
                    index,
                    isCompactOutline: outlineMode || isTallSelf,
                    isDraggingSelf,
                    isSiblingDimmed,
                  })}
                </AutoHeightObserver>
              </div>
            )
          })}
        </GridLayout>
      ) : (
        <div className="min-h-[320px] w-full" aria-hidden="true" />
      )}
    </div>
  )
}
