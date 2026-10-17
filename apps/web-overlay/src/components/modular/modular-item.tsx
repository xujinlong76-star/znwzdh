'use client'

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { WidgetInstance } from '@/types/modular'
import { WIDGET_REGISTRY } from '@/lib/modular/registry'
import { ModuleErrorBoundary } from './module-error-boundary'
import { 
  GripVertical, 
  Trash2, 
  Maximize2, 
  Sparkles,
  MoveHorizontal,
  ArrowUp,
  ArrowDown,
  Settings,
  AlertTriangle
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

interface ModularItemProps {
  widget: WidgetInstance
  index: number
  totalWidgets: number
  isEditing: boolean
  onRemove: (id: string) => void
  onResize: (id: string, colSpan: number, rowSpan?: number, recordHistory?: boolean) => void
  /** 一次连续交互（拖拽/缩放）开始时调用：只压入一份历史快照，保证拖拽流畅且可整体撤销 */
  onBeginInteraction?: () => void
  onShiftPosition?: (index: number, direction: 'up' | 'down') => void
  onOpenConfig?: (widget: WidgetInstance) => void
  onDragStart: (e: React.DragEvent, index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDragEnd: (e: React.DragEvent) => void
  isDraggedOver?: boolean
  isDragging?: boolean
}

// 快速尺寸预设选项
const COL_PRESETS = [
  { label: '1/4', value: 3, description: '紧凑卡片' },
  { label: '1/3', value: 4, description: '标准小组件' },
  { label: '1/2', value: 6, description: '半屏展示' },
  { label: '全宽', value: 12, description: '全景通栏' },
]

function ModularItemImpl({
  widget,
  index,
  totalWidgets,
  isEditing,
  onRemove,
  onResize,
  onBeginInteraction,
  onShiftPosition,
  onOpenConfig,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDraggedOver,
  isDragging,
}: ModularItemProps) {
  const def = WIDGET_REGISTRY[widget.type]
  const [showSizeMenu, setShowSizeMenu] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)
  const sizeBtnRef = useRef<HTMLButtonElement | null>(null)
  const sizeMenuRef = useRef<HTMLDivElement | null>(null)
  const [sizeMenuPos, setSizeMenuPos] = useState<{ top: number; left: number } | null>(null)

  /**
   * 尺寸菜单用 portal 挂到 body 上，位置按触发器实测。
   *
   * 为什么不能像以前那样 `absolute top-full`：卡片自带 `overflow-hidden`（内圆角裁切
   * 内容需要），下拉会被卡片下边缘直接切掉 —— rowSpan=1 的矮卡片上「高度跨度 1x/2x/3x」
   * 整行点不到，缩放功能废一半。portal + fixed 既躲开裁剪，也不受画布 transform 影响。
   */
  useLayoutEffect(() => {
    if (!showSizeMenu) {
      setSizeMenuPos(null)
      return
    }
    const MENU_H = 214 // 5 个宽度预设 + 3 个高度预设 + 两个分组标题的实测高度
    const MENU_W = 112
    const place = () => {
      const btn = sizeBtnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      // 下方放不下就翻到上方；左右都往视口内夹，避免贴边被裁
      const top = spaceBelow < MENU_H + 12 && r.top > MENU_H + 12 ? r.top - MENU_H - 6 : r.bottom + 6
      const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8))
      setSizeMenuPos({ top, left })
    }
    place()
    // 滚动/缩放时跟着重新定位（捕获阶段：画布内部容器滚动也要能收到）
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [showSizeMenu])

  // 尺寸菜单打开后，点击菜单外部区域自动收起（挂载延迟一帧，
  // 避免触发菜单的那一次 pointerdown 被自己立刻关掉）。
  // 菜单已 portal 到 body，"外部"要同时排除触发按钮和菜单本身。
  useEffect(() => {
    if (!showSizeMenu) return
    const handleOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (sizeBtnRef.current?.contains(target) || sizeMenuRef.current?.contains(target)) return
      setShowSizeMenu(false)
    }
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleOutsidePointerDown)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', handleOutsidePointerDown)
    }
  }, [showSizeMenu])

  // Esc 关菜单：捕获阶段拦截，避免同时触发全局快捷键
  useEffect(() => {
    if (!showSizeMenu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setShowSizeMenu(false)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [showSizeMenu])

  // 缩放手柄拖拽状态（必须在任何提前 return 之前声明，保证 hook 顺序稳定）
  const isResizingRef = useRef(false)
  const currentColRef = useRef(widget.colSpan || 4)
  const currentRowRef = useRef(widget.rowSpan || 1)

  if (!def) {
    // 模块类型已不存在（多见于导入的旧版 JSON / 注册表改名）。
    // 不能直接 return null：卡片会变成没有删除入口的"僵尸占位"，
    // 用户没有任何办法把它从看板里清掉。这里渲染降级占位卡，
    // 保留卡片骨架与删除按钮，保证任何布局都可恢复。
    return (
      <div
        className="relative col-span-12 md:col-span-6 rounded-2xl border border-dashed border-amber-500/50 bg-amber-500/5 flex flex-col items-center justify-center gap-2 p-4 text-center min-h-[120px]"
      >
        <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4" />
        </div>
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-foreground">模块已失效</div>
          <div className="text-xs text-muted-foreground">
            类型「{widget.type || '未知'}」已不在组件库中
          </div>
        </div>
        {isEditing ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-red-500 hover:bg-red-500/10 rounded-md"
            onClick={() => onRemove(widget.id)}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            移除此模块
          </Button>
        ) : (
          <div className="text-xs text-muted-foreground/70">开启编辑模式后可移除此模块</div>
        )}
      </div>
    )
  }
  const Component = def.component

  // 映射跨度到实际高度与网格类名
  const colSpan = widget.colSpan || def.defaultColSpan
  const rowSpan = widget.rowSpan || def.defaultRowSpan

  // Tailwind CSS 动态网格类映射
  const colSpanClass = {
    3: 'lg:col-span-3 md:col-span-3 col-span-12',
    4: 'lg:col-span-4 md:col-span-3 col-span-12',
    5: 'lg:col-span-5 md:col-span-3 col-span-12',
    6: 'lg:col-span-6 md:col-span-6 col-span-12',
    7: 'lg:col-span-7 md:col-span-6 col-span-12',
    8: 'lg:col-span-8 md:col-span-6 col-span-12',
    9: 'lg:col-span-9 md:col-span-6 col-span-12',
    10: 'lg:col-span-10 md:col-span-6 col-span-12',
    11: 'lg:col-span-11 md:col-span-6 col-span-12',
    12: 'lg:col-span-12 md:col-span-6 col-span-12',
  }[colSpan] || 'lg:col-span-4 md:col-span-3 col-span-12'

  const minHeightStyle = {
    1: 'min-h-[175px]',
    2: 'min-h-[290px]',
    3: 'min-h-[420px]',
  }[rowSpan] || 'min-h-[175px]'

  /**
   * 右下角缩放手柄：Pointer Events（鼠标 / 触屏 / 触控笔统一）。
   *
   * 两处修正：
   *  1. 原实现把"1 列 ≈ 80px"写死（假设容器 1200px）。实际列宽随视口变化——
   *     1440px 屏上 1 列约 110px，375px 屏上约 20px，写死会让手感飘忽、跳格。
   *     这里在按下时**实测**栅格容器宽度与 columnGap，算出真实列宽。
   *  2. 原来只能横向改列宽，行高只能进菜单点。现在纵向拖动同时改行高（按 115px 档位）。
   *
   * 流畅性：按下时先 beginInteraction() 压入一份历史快照，过程中用
   * recordHistory=false 更新，避免每个栅格变化都做一次 boards 深拷贝 + 历史入栈。
   */
  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const container = itemRef.current?.parentElement
    if (!container) return

    const styles = window.getComputedStyle(container)
    const gap = parseFloat(styles.columnGap || '0') || 0
    const gridWidth = container.clientWidth
    // 12 栅格：11 个间隙 + 12 列
    const colWidth = Math.max(24, (gridWidth - gap * 11) / 12)
    // 行高档位增量：min-h 175 / 290 / 420 → 每档约 115px
    const rowUnit = 115

    const startX = e.clientX
    const startY = e.clientY
    const startCol = widget.colSpan || def.defaultColSpan
    const startRow = widget.rowSpan || def.defaultRowSpan

    isResizingRef.current = true
    onBeginInteraction?.()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
      /* 某些浏览器不支持捕获，退化为 window 监听 */
    }

    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

    const handleMove = (moveEvent: PointerEvent) => {
      if (!isResizingRef.current) return
      const deltaCols = Math.round((moveEvent.clientX - startX) / colWidth)
      const deltaRows = Math.round((moveEvent.clientY - startY) / rowUnit)
      const targetCol = clamp(startCol + deltaCols, def.minColSpan, def.maxColSpan)
      const targetRow = clamp(startRow + deltaRows, def.minRowSpan, def.maxRowSpan)
      if (targetCol !== currentColRef.current || targetRow !== currentRowRef.current) {
        currentColRef.current = targetCol
        currentRowRef.current = targetRow
        onResize(widget.id, targetCol, targetRow, false)
      }
    }

    const handleUp = () => {
      isResizingRef.current = false
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
  }

  // widget 变化（菜单改尺寸 / 撤销）时同步 ref：拖拽过程中不覆盖
  if (!isResizingRef.current) {
    currentColRef.current = widget.colSpan || def.defaultColSpan
    currentRowRef.current = widget.rowSpan || def.defaultRowSpan
  }

  return (
    <div
      ref={itemRef}
      draggable={isEditing}
      onDragStart={(e) => {
        // 缩放手柄按下后指针还在本卡片内，移动会触发父级的原生 HTML5 拖拽，
        // 浏览器随即 pointercancel 掉指针流（实测 ds:1/pc:1/pu:0）——缩放永远失败。
        // 因此缩放进行中必须拒绝原生拖拽，让 pointermove 继续驱动缩放。
        if (isResizingRef.current) {
          e.preventDefault()
          return
        }
        onDragStart(e, index)
      }}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      className={`relative group @container rounded-2xl border transition-all duration-200 flex flex-col justify-between overflow-hidden ${colSpanClass} ${minHeightStyle} ${
        isEditing
          ? 'cursor-grab active:cursor-grabbing border-primary/40 ring-1 ring-primary/20 hover:border-primary/80 bg-card/90 shadow-sm'
          : 'border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs shadow-xs hover:shadow-md'
      } ${isDragging ? 'opacity-40 scale-95 border-dashed border-primary' : ''} ${
        isDraggedOver ? 'ring-2 ring-primary ring-offset-2 scale-[1.01]' : ''
      }`}
    >
      {/* 顶部标题栏 / 编辑手柄 */}
      {isEditing && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border/50 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-grab">
              <GripVertical className="w-3.5 h-3.5" />
            </span>
            <span className="font-semibold text-foreground truncate text-xs">
              {widget.customTitle || def.title}
            </span>
            {def.badge && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                {def.badge}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* 移动端与触控设备上移与下移快捷按钮 */}
            {onShiftPosition && (
              <div className="flex items-center gap-0.5 bg-background/80 rounded-md border border-border/60 p-0.5">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onShiftPosition(index, 'up')}
                  className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title="向前移动此模块"
                >
                  <ArrowUp className="w-2.5 h-2.5" />
                </button>
                <button
                  type="button"
                  disabled={index === totalWidgets - 1}
                  onClick={() => onShiftPosition(index, 'down')}
                  className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  title="向后移动此模块"
                >
                  <ArrowDown className="w-2.5 h-2.5" />
                </button>
              </div>
            )}

            {/* 快速修改宽度 */}
            <div className="relative">
              <button
                ref={sizeBtnRef}
                onClick={() => setShowSizeMenu(!showSizeMenu)}
                className="px-1.5 py-0.5 rounded text-xs bg-background/80 hover:bg-background border border-border/60 text-muted-foreground flex items-center gap-1"
                title="调整网格尺寸"
              >
                <MoveHorizontal className="w-2.5 h-2.5" />
                <span>{colSpan}列</span>
              </button>

              {/* portal 到 body：卡片 overflow-hidden 会把 absolute 下拉切掉 */}
              {showSizeMenu && sizeMenuPos && typeof document !== 'undefined' &&
                createPortal(
                  <div
                    ref={sizeMenuRef}
                    role="menu"
                    aria-label="调整模块尺寸"
                    style={{ position: 'fixed', top: sizeMenuPos.top, left: sizeMenuPos.left }}
                    className="z-[120] w-28 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-xl p-1.5 flex flex-col gap-1 animate-in fade-in zoom-in-95"
                  >
                    <div className="text-xs text-muted-foreground px-1 pb-1 border-b">选择宽度跨度</div>
                    {COL_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() => {
                          onResize(widget.id, preset.value)
                          setShowSizeMenu(false)
                        }}
                        className={`text-left text-xs px-2 py-1 rounded-md transition-colors flex items-center justify-between ${
                          colSpan === preset.value
                            ? 'bg-primary/15 text-primary font-semibold'
                            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <span>{preset.label}</span>
                        <span className="text-xs font-mono opacity-60">{preset.value}格</span>
                      </button>
                    ))}
                    <div className="text-xs text-muted-foreground px-1 pt-1 border-t">高度跨度</div>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3].map((r) => (
                        <button
                          key={r}
                          onClick={() => {
                            onResize(widget.id, colSpan, r)
                            setShowSizeMenu(false)
                          }}
                          className={`flex-1 text-xs py-0.5 rounded font-mono ${
                            rowSpan === r ? 'bg-primary text-primary-foreground font-bold' : 'bg-muted/60 hover:bg-muted'
                          }`}
                        >
                          {r}x
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body,
                )}

            </div>

            {/* 独立配置参数按钮 */}
            {onOpenConfig && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground rounded-md"
                onClick={() => onOpenConfig(widget)}
                title="配置模块参数"
              >
                <Settings className="w-3 h-3" />
              </Button>
            )}

            {/* 删除按钮 */}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500 rounded-md"
              onClick={() => onRemove(widget.id)}
              title="删除此模块"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* 模块内部独立内容 —— 用错误边界圈住：该模块崩溃时只降级这一张卡片 */}
      <div className="flex-1 w-full min-h-0">
        <ModuleErrorBoundary
          title={widget.customTitle || def.title}
          isEditing={isEditing}
          onRemove={() => onRemove(widget.id)}
        >
          <Component config={widget.config} />
        </ModuleErrorBoundary>
      </div>

      {/* 右下角自由缩放手柄 (仅在编辑模式展示；Pointer 事件，鼠标/触屏通用) */}
      {isEditing && (
        <div
          onPointerDown={handleResizePointerDown}
          className="absolute bottom-0 right-0 p-1.5 z-10 cursor-se-resize flex items-end justify-end text-muted-foreground/60 hover:text-primary transition-all select-none group/resize touch-none"
          title={`当前尺寸: ${colSpan} 列 × ${rowSpan} 行 (按住右下角横向改宽度、纵向改高度)`}
        >
          <span className="opacity-0 group-hover/resize:opacity-100 text-xs font-mono bg-background/90 border border-border/80 px-1.5 py-0.5 rounded mr-1 mb-0.5 shadow-xs transition-opacity">
            {colSpan}×{rowSpan}
          </span>
          <svg className="w-3 h-3 fill-current opacity-70 group-hover/resize:opacity-100" viewBox="0 0 6 6">
            <path d="M6 6H4V4H6V6ZM6 2H4V0H6V2ZM2 6H0V4H2V6Z" />
          </svg>
        </div>
      )}
    </div>
  )
}

/**
 * memo 包装：缩放/拖拽时 boards 每帧变化，若不 memo，12 栅格里所有卡片都会
 * 跟着重渲染。前提是 canvas 传入的回调引用稳定（handleDragStart/Over/End、
 * handleOpenConfig 均已 useCallback 化），widget/index 等 props 本身就是值比较。
 */
export const ModularItem = React.memo(ModularItemImpl)
