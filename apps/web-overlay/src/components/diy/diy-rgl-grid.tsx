/**
 * RGL v2 外层 Bento 网格（模块化画布专用）。
 *
 * 为什么单独包一层：react-grid-layout v2 的 GridLayout 是「半受控」的——
 * layout 只在挂载与 props 变化时同步，拖拽中走内部 state；所以画布
 * 只需在 onDragStop / onResizeStop 时提交一次（见 modular-canvas 的
 * commitGridLayout），拖拽中不写盘、不推历史。
 *
 * 关键行为（均已按已装包的类型/源码核对）：
 *   - v2 配置对象化：gridConfig / dragConfig / resizeConfig / dropConfig，
 *     不再有顶层 isDraggable / isResizable；
 *   - GridItem 直接 clone 子元素并注入定位 style，所以这里的直接子元素
 *     必须是普通 div（key 与 layout 的 i 对应），dnd-kit 的 sortable
 *     ref 挂在更内一层（见 DiySortableWidget），两套 transform 各管一层；
 *   - RGL v2 的拖拽是鼠标 only（react-draggable，没有 pointer/touch
 *     处理）：触屏拖拽走 dnd-kit sortable，键盘走 dnd-kit
 *     KeyboardSensor 或模块自带的 ↑/↓ 按钮，本文件不假装 RGL 能摸；
 *   - dragConfig.cancel 排除一切可交互元素 + dnd-kit 手柄，避免
 *     「点链接却开始拖拽」与「鼠标在手柄上同时触发两套拖拽」；
 *     ModuleResizeHandles 的 8 个手柄（data-resize-handle）也在 cancel
 *     里：它们只 stop 掉 pointerdown，RGL 监听的是 mousedown，
 *     不排除的话抓缩放手柄会同时启动 RGL 拖拽；
 *   - RGL 自己的缩放手柄是关掉的（resizeConfig.enabled: false）：
 *     ModularItem 里的 ModuleResizeHandles 已有 8 方向手柄 + 实时尺寸
 *     HUD + 双击重置，RGL 只留一个 se 角会和它在右下角叠成两个，
 *     且 ModularItem 的手柄走 onBeginInteraction 快照、一次缩放一步撤销，
 *     是权威的缩放入口；
 *   - 响应式列数（grid-layout.ts 的 colsForWidth）：容器 ≥1024px 为 12 列
 *     与桌面旧行为一致，窄屏逐档收窄到 2 列；列数只影响读时派生的
 *     布局坐标，小组件自身的 colSpan/rowSpan 不丢。
 *   - rowHeight 175px：ModularItem rowSpan=1 最小高度就是 175px，
 *     行高小于内容会被下一行视觉重叠（见 grid-layout.ts）。
 */
'use client'

import { useMemo, type ReactNode } from 'react'
import { GridLayout, useContainerWidth, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import {
  GRID_MARGIN_PX,
  GRID_ROW_HEIGHT_PX,
  colsForWidth,
  widgetsToGrid,
  type GridItem,
  type WidgetGridInput,
} from '@/lib/modular/grid-layout'

export interface DiyRglGridProps<T extends WidgetGridInput> {
  widgets: T[]
  isEditing: boolean
  /** 拖拽/缩放开始：画布用来压一份撤销快照（缩放）或记状态（拖拽） */
  onDragStart?: () => void
  onResizeStart?: () => void
  /**
   * 拖拽/缩放结束：提交最新 layout（画布折回顺序 + 尺寸后写盘）。
   * 第二个参数是提交时的列数：窄屏断点下 w 是断点相对值，
   * 画布只在 12 列时写回尺寸，窄屏只提交顺序。
   */
  onCommitLayout?: (layout: GridItem[], cols: number) => void
  renderItem: (widget: T, index: number) => ReactNode
  className?: string
}

const toRglLayout = (layout: GridItem[]): Layout =>
  layout.map((item) => ({ ...item }))

export function DiyRglGrid<T extends WidgetGridInput>({
  widgets,
  isEditing,
  onDragStart,
  onResizeStart,
  onCommitLayout,
  renderItem,
  className,
}: DiyRglGridProps<T>) {
  const { width, mounted, containerRef } = useContainerWidth()
  // 响应式列数：桌面容器 ≥1024px 仍是 12 列；窄屏收窄（见 colsForWidth）。
  const cols = colsForWidth(width)
  const layout = useMemo(() => widgetsToGrid(widgets, cols), [widgets, cols])

  if (!mounted) {
    return <div ref={containerRef} className="min-h-[220px] w-full" aria-hidden="true" />
  }

  return (
    <div ref={containerRef} className={className}>
      <GridLayout
        width={width}
        layout={toRglLayout(layout)}
        gridConfig={{
          cols,
          rowHeight: GRID_ROW_HEIGHT_PX,
          margin: [GRID_MARGIN_PX, GRID_MARGIN_PX],
        }}
        dragConfig={{
          enabled: isEditing,
          // 可交互元素不启动拖拽；dnd-kit 手柄也不启动 RGL 拖拽（它走 sortable）。
          // ModuleResizeHandles 的手柄（data-resize-handle）必须也在内：
          // 它们 onPointerDown 里 stopPropagation 只拦 pointerdown，
          // RGL（react-draggable）监听的是 mousedown，拦不住。
          cancel: 'input,textarea,select,button,a,[data-diy-sort-handle],[data-resize-handle]',
          threshold: 3,
        }}
        resizeConfig={{
          // RGL 自己的缩放手柄关掉：ModularItem 的 ModuleResizeHandles
          //（8 方向 + HUD + 双击重置）是权威缩放入口；留着会在右下角
          // 与它叠成两个 se 手柄。onResizeStart/Stop 保留接线（永不触发）。
          enabled: false,
        }}
        onDragStart={() => onDragStart?.()}
        onDragStop={(nextLayout) => onCommitLayout?.(nextLayout as GridItem[], cols)}
        onResizeStart={() => onResizeStart?.()}
        onResizeStop={(nextLayout) => onCommitLayout?.(nextLayout as GridItem[], cols)}
      >
        {widgets.map((widget, index) => (
          <div key={widget.id} className="h-full">
            {renderItem(widget, index)}
          </div>
        ))}
      </GridLayout>
    </div>
  )
}
