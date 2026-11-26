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
  DragOverlay,
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
  resolveCardSortDrop,
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

/**
 * 读取 @dnd-kit/react/sortable 乐观排序后挂在 operation.source 上的投影索引与分组。
 * 当 OptimisticSortingPlugin 在 dragOver 阶段把被拖卡片移到新位置后，
 * dragEnd 时的 event.operation.target 往往指向 source 自身；此时通过
 * initialIndex / index / initialGroup / group 可精准还原最终落位。
 */
interface SortableProjection {
  index: number
  initialIndex: number
  group?: string
  initialGroup?: string
}

function readSortableProjection(raw: unknown): SortableProjection | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.index !== 'number' || typeof rec.initialIndex !== 'number') return null
  return {
    index: rec.index,
    initialIndex: rec.initialIndex,
    group: rec.group != null ? String(rec.group) : undefined,
    initialGroup: rec.initialGroup != null ? String(rec.initialGroup) : undefined,
  }
}

export function DiyDragProvider({
  children,
  enableCardDrops = true,
  onDragEnd: externalOnDragEnd,
}: DiyDragProviderProps) {
  const [announcement, setAnnouncement] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [activeCard, setActiveCard] = useState<DiyCardDragData | null>(null)
  const lastOverTargetRef = useRef<string | null>(null)
  const lastCardDropTargetRef = useRef<DiyCardDragData | DiyCategoryDropData | null>(null)
  const { toast } = useToast()
  const {
    isEditingLayout,
    customCategories,
    addSiteToCustomCategory,
    reorderSiteInCategory,
    moveSiteToCategoryAtIndex,
    setActiveDragLayer,
  } = useHomeDIY()

  const sensors = useMemo(
    () => [
      // Phase 1：为卡片本体自由拖拽定制 preventActivation：
      // @dnd-kit/dom 默认 preventActivation 会拦截 <a> 覆盖层上的 pointerdown，
      // 导致整卡拖拽无法激活。在 DIY 编辑态下 <a> 跳转已被拦截，因此卡片拖拽
      // 仅排除浮动编辑胶囊条与原生按钮/输入框，让整卡任意空白/标题区域按住即拖。
      PointerSensor.configure({
        preventActivation(event, source) {
          const target = event.target
          if (!(target instanceof Element)) return false
          if (source.type === 'card') {
            if (target.closest('[data-diy-card-capsule="true"]')) return true
            if (target.closest('button, input, textarea, select, [role="menuitem"]')) return true
            return false
          }
          if (target === source.element || target === source.handle) return false
          if (source.handle?.contains(target)) return false
          return Boolean(target.closest('button, a, input, textarea, select, [role="button"]'))
        },
      }),
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
    lastCardDropTargetRef.current = null
    if (!source) return
    setIsDragging(true)
    setActiveCard(source.kind === 'card' ? source : null)
    // Phase 2 双层拖拽全局互斥锁：拖卡片时锁死外层 Bento 网格，避免误拖整个分类区块
    if (source.kind === 'card') {
      setActiveDragLayer('card')
    }
    // 模块级标记与 isDragging 同步：跨标签通道回调在 React 渲染之外，
    // 读这份标记决定远端改动是合并还是排队（见 diy-drag.ts）。
    setDiyDragActive(true)
    const title = displayTitle(source)
    setAnnouncement(buildDragAnnouncement('start', { title }))
  }, [displayTitle, setActiveDragLayer])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const source = readDiyDragData(event.operation.source)
    const target = readDiyDragData(event.operation.target)
    if (!source || !target) return
    if (source.kind === 'card') {
      if (target.kind === 'card' && target.siteId !== source.siteId) {
        lastCardDropTargetRef.current = target
      } else if (target.kind === 'category') {
        // 仅在尚未命中该分类内具体卡片时记录分类级落点，避免覆盖精准索引
        const prev = lastCardDropTargetRef.current
        const prevContainer =
          prev?.kind === 'card' ? (prev.containerId ?? prev.sourceCategoryId) : prev?.categoryId
        if (!prev || prev.kind !== 'card' || prevContainer !== target.categoryId) {
          lastCardDropTargetRef.current = target
        }
      }
    }
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
      const rawTarget = readDiyDragData(event.operation.target)
      const projection = readSortableProjection(event.operation.source)
      const lastRecordedTarget = lastCardDropTargetRef.current
      lastOverTargetRef.current = null
      lastCardDropTargetRef.current = null
      setIsDragging(false)
      setActiveCard(null)
      if (externalOnDragEnd) externalOnDragEnd(event)

      if (!source) return
      const title = displayTitle(source)
      if (event.canceled) {
        setAnnouncement(buildDragAnnouncement('cancel', { title }))
        return
      }

      if (enableCardDrops && source.kind === 'card') {
        // 1. 优先识别 useSortable 乐观重排结果：
        //    同容器内拖动后 OptimisticSortingPlugin 可能将 target 置为 source 自身，
        //    此时 projection.initialIndex -> projection.index 是最精准的最终槽位。
        const sourceContainerId = source.containerId ?? source.sourceCategoryId ?? ''
        const effectiveTarget: DiyCardDragData | DiyCategoryDropData | null =
          rawTarget && (rawTarget.kind === 'category' || (rawTarget.kind === 'card' && rawTarget.siteId !== source.siteId))
            ? rawTarget
            : lastRecordedTarget

        const projectedSameGroup =
          projection != null &&
          sourceContainerId !== '' &&
          (!projection.group || !projection.initialGroup || projection.group === projection.initialGroup)
        const targetIsDifferentContainer =
          effectiveTarget != null &&
          ((effectiveTarget.kind === 'category' && effectiveTarget.categoryId !== sourceContainerId) ||
            (effectiveTarget.kind === 'card' &&
              (effectiveTarget.containerId ?? effectiveTarget.sourceCategoryId ?? '') !== sourceContainerId))

        if (
          projectedSameGroup &&
          !targetIsDifferentContainer &&
          projection.index !== projection.initialIndex &&
          source.displayedIds &&
          source.displayedIds.length > 1
        ) {
          const fromIdx = source.displayedIds.indexOf(source.siteId)
          const clampedTo = Math.max(0, Math.min(projection.index, source.displayedIds.length - 1))
          if (fromIdx !== -1 && fromIdx !== clampedTo) {
            const nextOrder = [...source.displayedIds]
            const [moved] = nextOrder.splice(fromIdx, 1)
            nextOrder.splice(clampedTo, 0, moved)
            reorderSiteInCategory(sourceContainerId, nextOrder)
            setAnnouncement(buildDragAnnouncement('end', { title, toLabel: `第 ${clampedTo + 1} 位` }))
            return
          }
        }

        if (effectiveTarget) {
          const resolvedTarget: DiyCardDragData | DiyCategoryDropData =
            effectiveTarget.kind === 'card' &&
            projection &&
            projection.group &&
            projection.group === (effectiveTarget.containerId ?? effectiveTarget.sourceCategoryId)
              ? { ...effectiveTarget, index: projection.index }
              : effectiveTarget

          const targetCatId =
            resolvedTarget.kind === 'category'
              ? resolvedTarget.categoryId
              : (resolvedTarget.containerId ?? resolvedTarget.sourceCategoryId ?? '')
          const targetCustomCat = customCategories.find((c) => c.id === targetCatId)
          const targetHasSite = Boolean(
            targetCustomCat?.items.some(
              (item) => item.href === source.href || item.title === source.title || item.id === source.siteId,
            ),
          )
          const plan = resolveCardSortDrop({
            source,
            target: resolvedTarget,
            isEditing: isEditingLayout,
            targetHasSite,
          })

          if (plan.action === 'reorder') {
            reorderSiteInCategory(plan.containerId, plan.orderedIds)
            setAnnouncement(buildDragAnnouncement('end', { title, toLabel: `第 ${plan.toIndex + 1} 位` }))
            return
          }

          if (plan.action === 'collect') {
            if (!isSafeSiteHref(source.href)) {
              toast({
                title: '⚠️ 拖拽收录已拦截',
                description: '该卡片地址不安全，仅允许 http/https 或站内路径。',
              })
              setAnnouncement(`「${title}」的地址不安全，已拦截收录。`)
              return
            }
            const outcome = addSiteToCustomCategory(plan.targetCategoryId, {
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
              setAnnouncement(buildDragAnnouncement('end', { title, toLabel: plan.targetLabel ?? '目标分类' }))
            }
            return
          }

          if (plan.action === 'move-to-index') {
            moveSiteToCategoryAtIndex({
              siteId: plan.siteId,
              sourceContainerId: plan.sourceContainerId,
              targetCategoryId: plan.targetCategoryId,
              targetContainerId: plan.targetContainerId,
              targetIndex: plan.targetIndex,
              sourceDisplayedIds: plan.sourceDisplayedIds,
              targetDisplayedIds: plan.targetDisplayedIds,
            })
            toast({
              title: '🔄 跨分类精准落位成功',
              description: `已将「${title}」移至目标分组第 ${plan.targetIndex + 1} 位（按 Ctrl+Z 可撤销）`,
            })
            setAnnouncement(
              buildDragAnnouncement('end', {
                title,
                toLabel: `${plan.targetLabel ?? '目标分类'}第 ${plan.targetIndex + 1} 位`,
              }),
            )
            return
          }

          setAnnouncement(buildDragAnnouncement('nochange', { title }))
          return
        }
      }

      setAnnouncement(buildDragAnnouncement('end', { title }))
    },
    [
      externalOnDragEnd,
      enableCardDrops,
      customCategories,
      isEditingLayout,
      addSiteToCustomCategory,
      reorderSiteInCategory,
      moveSiteToCategoryAtIndex,
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
        setActiveDragLayer('none')
        setDiyDragActive(false)
        flushPendingLayoutSyncMessages()
      }
    },
    [handleDragEndInner, setActiveDragLayer],
  )

  // provider 卸载时拖拽不可能再继续：清标记、放出排队的远端改动，
  // 避免标记卡在 true 让此后的跨标签合并永远排队。
  useEffect(() => {
    return () => {
      setActiveDragLayer('none')
      setDiyDragActive(false)
      flushPendingLayoutSyncMessages()
    }
  }, [setActiveDragLayer])

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
      {/* Phase 1 & 2：DragOverlay 脱离文档流并置于顶层（z-[9999] 高于外层 RGL 网格），GPU transform 零重排 */}
      <DragOverlay dropAnimation={null} className="z-[9999]">
        {activeCard ? (
          <div
            data-diy-drag-overlay="true"
            className="pointer-events-none relative z-[9999] flex max-w-[260px] items-center gap-2.5 rounded-xl border-2 border-primary/60 bg-card/95 px-3 py-2.5 shadow-2xl backdrop-blur-md ring-2 ring-primary/20 scale-[1.03]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold text-primary">
              {(activeCard.title || '?').slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-foreground">{activeCard.title}</div>
              {activeCard.href && (
                <div className="truncate text-[10px] font-mono text-muted-foreground">
                  {activeCard.href.replace(/^https?:\/\//, '').split('/')[0]}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DragOverlay>
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

/**
 * 过滤掉 @dnd-kit/dom/sortable 默认的 OptimisticSortingPlugin：
 * 该插件在跨容器 dragOver 时直接调用 insertAdjacentElement 把 React 管理的
 * DOM 节点私自挪进目标容器，导致 React 在 dragEnd 提交状态更新卸载源卡片时抛出
 * `NotFoundError: Failed to execute 'removeChild' on 'Node'`。
 * 保留 SortableKeyboardPlugin（无障碍键盘排序），视觉拖拽与占位由 DragOverlay + React 状态驱动。
 */
const CARD_SORTABLE_PLUGINS: NonNullable<Parameters<typeof useSortable>[0]['plugins']> = (defaults) =>
  defaults.filter((plugin) => !String(plugin).includes('initialGroup'))

export function DiyDraggableCard({ data, className, children }: DiyDraggableCardProps) {
  const { activeDragLayer } = useHomeDIY()
  const isOuterBlockInteracting = activeDragLayer === 'block' || activeDragLayer === 'resize'
  const containerId = data.containerId ?? data.sourceCategoryId ?? 'default'
  // Phase 1 & 2：升级为 useSortable —— 整张卡片本体可直接拖拽（GPU CSS transform），
  // 支持同容器平滑让位重排与跨容器精准落位；外层区块拖动/缩放期间通过 disabled 严格互斥隔离。
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: `card:${data.siteId}`,
    index: data.index ?? 0,
    group: containerId,
    type: 'card',
    accept: ['card'],
    disabled: isOuterBlockInteracting,
    // 卡片碰撞优先级高于外层分类区块（1），确保悬停在目标卡片上时精准命中索引，
    // 悬停在空分类或留白处时才回落到分类级落点。
    collisionPriority: 3,
    plugins: CARD_SORTABLE_PLUGINS,
    data,
  })
  return (
    <div
      ref={ref}
      data-dnd-card={data.siteId}
      data-diy-draggable={data.siteId}
      data-diy-container={containerId}
      data-diy-dragging={isDragging ? 'true' : undefined}
      onMouseDown={(e) => {
        // 阻止 mousedown 冒泡至外层 react-grid-layout（react-draggable 监听 mousedown）
        e.stopPropagation()
      }}
      style={{ touchAction: 'manipulation' }}
      className={cn(
        'js-block-no-drag relative h-full select-none transition-shadow duration-150',
        isOuterBlockInteracting
          ? 'pointer-events-none'
          : 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-35 rounded-xl ring-2 ring-dashed ring-primary/50',
        !isDragging && isDropTarget && 'rounded-xl ring-2 ring-primary/70 ring-offset-1',
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
    type: 'category',
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
    accept: ['card', 'category'],
    collisionPriority: 1,
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
