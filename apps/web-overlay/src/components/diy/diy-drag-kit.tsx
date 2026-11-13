/**
 * dnd-kit 重型层：DragDropProvider + 可拖拽/可落下/可排序包装器。
 *
 * 本文件是唯一直接 import @dnd-kit/* 的地方（导航卡片只 import 轻量的
 * diy-drag-context）。包体实测：dnd-kit（react + dom + sortable）
 * 约 133 KB minified——
 *   - 导航侧：provider 与包装器由 navigation-content（coordinator 接线）
 *     与 navigation-category-section 在**进入编辑态时动态 import**，
 *     首页 / 首屏不付这笔钱；
 *   - 画布侧：modular-canvas 本身已是 ssr:false 的动态 chunk，
 *     这里静态 import 不影响任何首屏路由。
 *
 * 传感器（实测自已装包的类型定义）：
 *   - PointerSensor / KeyboardSensor 只从 @dnd-kit/react import——
 *     它把两个传感器都重新导出了；@dnd-kit/dom 不是直接依赖，
 *     pnpm 下直接 import 它会让构建失败（见下 sensors 的注释）；
 *   - KeyboardSensor 默认键位：Space/Enter 开始、Esc 取消、方向键移动、
 *     Space/Enter/Tab 结束；
 *   - 其余插件（Accessibility / AutoScroller / Cursor / Feedback /
 *     PreventSelection）走 defaultPreset，不在这里重复配。
 *
 * 读屏播报只有一套中文：dnd-kit Accessibility 插件的英文默认播报被
 * plugins={(defaults) => withoutAccessibilityPlugin(defaults)} 排除掉
 * 了（W2-8），中文 live-region 是唯一播报源。排除它也会去掉它注入的
 * tabindex/role/aria-roledescription——拖拽手柄本身是原生 <button>，
 * 带显式 aria-label + 指向中文说明的 aria-describedby，不丢信息。
 */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { GripVertical } from 'lucide-react'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { createCustomSiteId } from '@/lib/modular/custom-site-input'
import { isSafeSiteHref } from '@/lib/modular/diy-presets'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  buildDragAnnouncement,
  DIY_DRAG_INSTRUCTIONS_ID,
  KEYBOARD_DRAG_INSTRUCTIONS,
  readDiyDragData,
  resolveCardDrop,
  setDiyDragActive,
  withoutAccessibilityPlugin,
  type DiyCardDragData,
  type DiyCategoryDropData,
  type DiyPaletteDragData,
  type DiyWidgetDragData,
} from '@/lib/modular/diy-drag'
import { flushPendingLayoutSyncMessages } from '@/lib/modular/use-home-diy-grid'
import { DiyDragActiveContext, DiyDragHandleContext } from './diy-drag-context'

/** readDiyDragData 的唯一来源是轻量层 diy-drag.ts，这里只 re-export 供旧调用方用 */
export { readDiyDragData } from '@/lib/modular/diy-drag'

export interface DiyDragProviderProps {
  children: ReactNode
  /**
   * 是否启用内置的卡片落点处理（导航首页用；画布关掉，改走 onDragEnd）。
   * 默认 true。
   */
  enableCardDrops?: boolean
  /**
   * 画布等调用方自己的落点处理（小组件排序、调色板拖入）。
   * 与内置卡片处理可并存：先调外部，再调内置。
   */
  onDragEnd?: (event: DragEndEvent) => void
}

export function DiyDragProvider({
  children,
  enableCardDrops = true,
  onDragEnd: externalOnDragEnd,
}: DiyDragProviderProps) {
  const [announcement, setAnnouncement] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const lastOverTargetRef = useRef<string | null>(null)
  const { toast } = useToast()
  const { isEditingLayout, customCategories, addSiteToCustomCategory, reclassifySite } = useHomeDIY()

  const sensors = useMemo(
    () => [
      // 库默认值，不显式配激活约束：构造 Distance 约束要用的
      // PointerActivationConstraints 没有被 @dnd-kit/react 重新导出，
      // 而 @dnd-kit/dom 不是直接依赖（两个 package.json 都只 pin 了
      // @dnd-kit/react），pnpm 下直接 import 它构建会失败。
      // 默认值已够用：鼠标在手柄上按下即激活（手柄是专用拖拽目标，
      // 没有点按动作可保护）；触屏默认 250ms 延迟 + 5px 容差，
      // 点按不会误触发拖拽（与旧 180ms 长按同一量级）。
      PointerSensor.configure({}),
      KeyboardSensor.configure({}),
    ],
    [],
  )

  /**
   * 播报里拖拽源的显示名：分类拖拽源的 data 里有 title（手柄传的分类名），
   * 没有就回退 categoryId——绝不能把「cat-xxx」这种 id 念给读屏用户。
   */
  const displayTitle = useCallback((source: NonNullable<ReturnType<typeof readDiyDragData>>) => {
    return source.kind === 'category' ? (source.title ?? source.categoryId) : source.title
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const source = readDiyDragData(event.operation.source)
    lastOverTargetRef.current = null
    if (!source) return
    setIsDragging(true)
    // 模块级标记与 isDragging 同步：跨标签通道回调在 React 渲染之外，
    // 读这份标记决定远端改动是合并还是排队（见 diy-drag.ts）。
    setDiyDragActive(true)
    const title = displayTitle(source)
    setAnnouncement(buildDragAnnouncement('start', { title }))
  }, [displayTitle])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const source = readDiyDragData(event.operation.source)
    const target = readDiyDragData(event.operation.target)
    if (!source || !target) return
    // 同一落点反复播报会吵死读屏用户：只在落点变化时报一次。
    const targetKey = target.kind === 'category' ? `category:${target.categoryId}` : target.kind
    if (lastOverTargetRef.current === targetKey) return
    lastOverTargetRef.current = targetKey
    const title = displayTitle(source)
    const toLabel =
      target.kind === 'category'
        ? `「${target.title ?? target.categoryId}」分类`
        : target.kind === 'widget'
          ? `「${target.title}」小组件`
          : undefined
    setAnnouncement(buildDragAnnouncement('over', { title, toLabel }))
  }, [displayTitle])

  const handleDragEndInner = useCallback(
    (event: DragEndEvent) => {
      const source = readDiyDragData(event.operation.source)
      const target = readDiyDragData(event.operation.target)
      lastOverTargetRef.current = null
      setIsDragging(false)
      if (externalOnDragEnd) externalOnDragEnd(event)

      if (!source) return
      const title = displayTitle(source)
      if (event.canceled) {
        setAnnouncement(buildDragAnnouncement('cancel', { title }))
        return
      }

      if (enableCardDrops && source.kind === 'card' && target?.kind === 'category') {
        const targetCategory = customCategories.find((c) => c.id === target.categoryId)
        const targetHasSite = target.isCustom
          ? Boolean(
              targetCategory?.items.some(
                (item) => item.href === source.href || item.title === source.title,
              ),
            )
          : false
        const decision = resolveCardDrop({
          source,
          target,
          isEditing: isEditingLayout,
          targetHasSite,
        })
        if (decision.action === 'collect') {
          if (!isSafeSiteHref(source.href)) {
            toast({
              title: '⚠️ 拖拽收录已拦截',
              description: '该卡片地址不安全，仅允许 http/https 或站内路径。',
            })
            setAnnouncement(`「${title}」的地址不安全，已拦截收录。`)
            return
          }
          const outcome = addSiteToCustomCategory(target.categoryId, {
            id: createCustomSiteId(),
            title: source.title,
            href: source.href,
            description: source.description || undefined,
            icon: source.icon || undefined,
          })
          if (outcome === 'failed') {
            toast({
              title: '这一下没能保存',
              description: '浏览器拒绝写入本地存储（隐私模式或空间已满），刷新后这条收录会消失。',
              variant: 'destructive',
            })
            setAnnouncement(`「${title}」收录失败，浏览器拒绝写入本地存储。`)
          } else if (outcome === 'duplicate') {
            toast({ title: 'ℹ️ 站点已存在', description: `「${title}」已在目标分类中。` })
            setAnnouncement(`「${title}」已在目标分类中，没有重复收录。`)
          } else {
            toast({
              title: '📥 拖拽收录成功',
              description: `已成功将站点「${title}」收录进专属分类！`,
            })
            setAnnouncement(buildDragAnnouncement('end', { title, toLabel: '目标分类' }))
          }
          return
        }
        if (decision.action === 'reclassify') {
          reclassifySite(source.siteId, target.categoryId)
          toast({
            title: '🔄 跨分类迁移成功',
            description: `已将站点「${title}」重排归类至目标分类！`,
          })
          setAnnouncement(buildDragAnnouncement('end', { title, toLabel: '目标分类' }))
          return
        }
        // 决策是 noop（同分类内落下 / 目标里已有该站）：拖拽确实放下了，
        // 不是取消——报「位置没有变化」，别报「已取消」。
        setAnnouncement(buildDragAnnouncement('nochange', { title }))
        return
      }

      setAnnouncement(buildDragAnnouncement('end', { title }))
    },
    [
      externalOnDragEnd,
      enableCardDrops,
      customCategories,
      isEditingLayout,
      addSiteToCustomCategory,
      reclassifySite,
      toast,
      displayTitle,
    ],
  )

  /**
   * 拖拽结束的收尾（W2-6）：本地落点提交（分类重排 / 卡片收录 / 重归类）
   * 都在 inner 里同步完成，finally 再清拖拽标记、放出拖拽中排队的远端
   * 改动——合并发生在最终本地状态之上，不会被拖拽提交盖掉；取消的拖拽
   * 同样走这里（inner 里 early return 也会进 finally）。
   */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      try {
        handleDragEndInner(event)
      } finally {
        setDiyDragActive(false)
        flushPendingLayoutSyncMessages()
      }
    },
    [handleDragEndInner],
  )

  // provider 卸载时拖拽不可能再继续：清标记、放出排队的远端改动，
  // 避免标记卡在 true 让此后的跨标签合并永远排队。
  useEffect(() => {
    return () => {
      setDiyDragActive(false)
      flushPendingLayoutSyncMessages()
    }
  }, [])

  return (
    <DragDropProvider
      sensors={sensors}
      plugins={(defaults) => withoutAccessibilityPlugin(defaults)}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <DiyDragActiveContext.Provider value={isDragging}>
        {children}
      </DiyDragActiveContext.Provider>
      {/* 读屏拖拽说明（全页一份）与操作播报（aria-live） */}
      <p id={DIY_DRAG_INSTRUCTIONS_ID} className="sr-only">
        {KEYBOARD_DRAG_INSTRUCTIONS}
      </p>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </DragDropProvider>
  )
}

/* ------------------------------------------------------------------ *
 * 导航卡片：可拖拽包装器（section 在编辑态动态 import 本模块后使用）
 * ------------------------------------------------------------------ */

export interface DiyDraggableCardProps {
  data: DiyCardDragData
  className?: string
  children: ReactNode
}

export function DiyDraggableCard({ data, className, children }: DiyDraggableCardProps) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `card:${data.siteId}`,
    data,
  })
  return (
    <div
      ref={ref}
      data-diy-draggable={data.siteId}
      className={cn(
        'relative h-full',
        isDragging && 'opacity-60',
        className,
      )}
    >
      <DiyDragHandleContext.Provider value={handleRef}>{children}</DiyDragHandleContext.Provider>
    </div>
  )
}

/**
 * 分类拖拽手柄：按住拖到别的分类落点上重排。由 category-in-situ-controls
 * 以组件 prop 接入（该文件绝不能静态 import 本文件，否则 133KB 进首屏）。
 * 调用方只在 dnd-kit chunk 已加载时传（dragKit?.DiyCategoryDragGrip）。
 */
export function DiyCategoryDragGrip({
  categoryId,
  isCustom,
  title,
}: {
  categoryId: string
  isCustom: boolean
  title: string
}) {
  const { ref: dragRef } = useDraggable({
    id: `category:${categoryId}`,
    // title 进 data：provider 播报念分类名，不念 categoryId
    data: { kind: 'category', categoryId, isCustom, title },
  })
  return (
    <button
      type="button"
      ref={dragRef}
      // 原生 button：自带按钮语义；tabIndex={0} 让它进 Tab 序列——
      // KeyboardSensor 只在手柄元素本身收到 keydown 时才激活（它监听的是
      // handle 元素上的 keydown，event.target 必须是手柄自己），
      // 不可聚焦的 div 按 Space 永远到不了传感器。
      tabIndex={0}
      style={{ touchAction: 'none' }}
      aria-label={`拖动排序分类：${title}（聚焦后按空格开始，方向键移动，回车放下，Esc 取消）`}
      aria-describedby={DIY_DRAG_INSTRUCTIONS_ID}
      title={`按住拖拽调整「${title}」在页面上的排列位置`}
      className="flex items-center justify-center h-8 w-8 rounded-md cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * 分类区块：可落下目标（section 在编辑态动态 import 本模块后使用）
 *
 * 刻意渲染 null：落点就是 section 本身（element 传 section 的 ref），
 * 不包一层 div——包一层会打断父级网格的 col-span（section 必须是
 * 网格的直接子元素）。isDropTarget 经回调回传给 section 做高亮。
 * ------------------------------------------------------------------ */

export interface DiyCategoryDropTargetProps {
  data: DiyCategoryDropData
  element: React.RefObject<Element | null>
  onDropTargetChange: (isDropTarget: boolean) => void
}

export function DiyCategoryDropTarget({
  data,
  element,
  onDropTargetChange,
}: DiyCategoryDropTargetProps) {
  const { isDropTarget } = useDroppable({
    id: `category:${data.categoryId}`,
    data,
    element,
  })
  const prevRef = useRef(isDropTarget)
  useEffect(() => {
    if (prevRef.current !== isDropTarget) {
      prevRef.current = isDropTarget
      onDropTargetChange(isDropTarget)
    }
  }, [isDropTarget, onDropTargetChange])
  return null
}

/* ------------------------------------------------------------------ *
 * 画布小组件：可排序包装器（RGL 之外的触屏/键盘排序通道）
 *
 * 位置关系：RGL GridItem 直接克隆外层 wrapper 并注入定位 style，
 * 所以 useSortable 的 ref 必须挂在**内层** div 上——两套 transform
 * 各管一层，互不抢。手柄是内层里的绝对定位按钮，
 * RGL 的 dragConfig.cancel 会排除它（见 diy-rgl-grid）。
 * ------------------------------------------------------------------ */

export interface DiySortableWidgetProps {
  data: DiyWidgetDragData
  group: string
  disabled?: boolean
  className?: string
  children: ReactNode
}

export function DiySortableWidget({
  data,
  group,
  disabled = false,
  className,
  children,
}: DiySortableWidgetProps) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: `widget:${data.widgetId}`,
    index: data.index,
    group,
    data,
    disabled,
  })
  return (
    <div
      ref={ref}
      data-diy-sortable={data.widgetId}
      className={cn(
        'relative h-full',
        isDragging && 'opacity-50',
        isDropTarget && 'ring-2 ring-primary ring-offset-2 rounded-2xl',
        className,
      )}
    >
      {!disabled && (
        <button
          type="button"
          ref={handleRef}
          data-diy-sort-handle=""
          style={{ touchAction: 'none' }}
          aria-label={`拖动排序：${data.title}`}
          aria-describedby={DIY_DRAG_INSTRUCTIONS_ID}
          title="拖动排序（按住拖动；键盘：聚焦后按空格开始，方向键移动，回车放下，Esc 取消）"
          className="absolute -top-2 -left-2 z-30 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/95 text-muted-foreground shadow-md backdrop-blur-md hover:text-foreground hover:border-primary/60 cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}
      {children}
    </div>
  )
}

/** 通用可落下区（画布容器接调色板拖入用；id/data 由调用方定） */
export interface DiyDroppableZoneProps {
  id: string
  data: DiyCategoryDropData | { kind: 'canvas-grid' }
  className?: string
  children: ReactNode
}

export function DiyDroppableZone({ id, data, className, children }: DiyDroppableZoneProps) {
  const { ref } = useDroppable({ id, data })
  return (
    <div ref={ref} data-diy-droppable={id} className={className}>
      {children}
    </div>
  )
}

export type { DiyCardDragData, DiyCategoryDropData, DiyPaletteDragData, DiyWidgetDragData }
