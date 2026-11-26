'use client'

/**
 * 浏览态 12 列 Bento 静态 CSS Grid 渲染器（零 react-grid-layout 运行时开销、零首屏 CLS）。
 *
 * 特点：
 * 1. 非 DIY 编辑态下不加载 RGL JS/CSS，不挂任何拖拽/缩放监听；
 * 2. 通过 ResizeObserver 测量父容器真实宽度，自动切换 lg(12列) / md(8列) / sm(4列) 独立断点；
 * 3. 每个区块外壳自带 `container-type: inline-size`（@container），左右并排时内部卡片列数按区块自身宽度自适应；
 * 4. 完整还原 `heightMode === 'fixed-scroll'` 固定高度内部滚动与视口外 `content-visibility: auto`。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_WORKSPACE_GAP,
  DEFAULT_WORKSPACE_ROW_HEIGHT,
  colsForBreakpoint,
  reconcileBreakpointBlocks,
  resolveBreakpointForWidth,
  type AvailableWorkspaceBlock,
  type LayoutBlock,
  type WorkspaceBreakpointKey,
  type WorkspaceLayoutV2,
} from '@/lib/modular/workspace-layout-v2'

export interface BentoStaticGridProps {
  layout: WorkspaceLayoutV2
  availableBlocks: readonly AvailableWorkspaceBlock[]
  renderBlock: (block: LayoutBlock, meta: { breakpoint: WorkspaceBreakpointKey; totalCols: number; index: number }) => ReactNode
}

export function BentoStaticGrid({
  layout,
  availableBlocks,
  renderBlock,
}: BentoStaticGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const sync = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0) setMeasuredWidth(rect.width)
    }
    sync()
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number' && w > 0) setMeasuredWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // SSR 首帧默认 lg（12 列）；客户端挂载后按容器真实宽度切换 lg / md / sm
  const breakpoint: WorkspaceBreakpointKey =
    measuredWidth !== null ? resolveBreakpointForWidth(measuredWidth) : 'lg'
  const totalCols = colsForBreakpoint(breakpoint)
  const rowHeight = layout.gridConfig.rowHeight || DEFAULT_WORKSPACE_ROW_HEIGHT
  const [gapX, gapY] = layout.gridConfig.gap || DEFAULT_WORKSPACE_GAP

  const blocks = useMemo(
    () => reconcileBreakpointBlocks(layout, breakpoint, availableBlocks),
    [layout, breakpoint, availableBlocks],
  )

  return (
    <div
      ref={containerRef}
      data-bento-canvas="static"
      data-bento-bp={breakpoint}
      data-bento-cols={totalCols}
      className="grid w-full items-start"
      style={{
        gridTemplateColumns: `repeat(${totalCols}, minmax(0, 1fr))`,
        columnGap: `${gapX}px`,
        rowGap: `${gapY}px`,
      }}
    >
      {blocks.map((block, index) => {
        const fixedMaxHeightPx =
          block.heightMode === 'fixed-scroll'
            ? block.h * rowHeight + Math.max(0, block.h - 1) * gapY
            : undefined
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
            className="min-w-0 @container"
            style={{
              gridColumn: `${block.x + 1} / span ${block.w}`,
              containerType: 'inline-size',
              ...(fixedMaxHeightPx
                ? { maxHeight: `${fixedMaxHeightPx}px`, overflowY: 'auto' as const }
                : {}),
              ...(index >= 3 && !fixedMaxHeightPx
                ? { contentVisibility: 'auto' as const, containIntrinsicSize: 'auto 340px' }
                : {}),
            }}
          >
            {renderBlock(block, { breakpoint, totalCols, index })}
          </div>
        )
      })}
    </div>
  )
}
