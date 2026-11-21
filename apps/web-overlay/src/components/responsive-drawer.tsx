'use client'
/**
 * 响应式抽屉（2026-11-21）。
 *
 * 同一个面板在桌面端从右侧滑出、在移动端变成底部 Bottom Sheet。
 * 抽成基础设施的原因：/graph 的节点详情、/favorites 的冲突裁决、
 * /algorithms 的面板详情都要这个行为，各写一套媒体查询必然漂移。
 *
 * ## 为什么用 CSS 而非 JS 判断视口
 *
 * 用 matchMedia 判断会带来 SSR/水合不一致：服务端不知道视口宽度，
 * 首帧渲染成桌面还是移动版只能猜。这里两套容器同时渲染，用 CSS 媒体查询
 * 决定显示哪一套——首帧就能正确，且不依赖任何客户端状态。
 *
 * ## 关闭方式（三选一，全支持）
 *
 *  - Esc 键
 *  - 点击遮罩
 *  - 移动端向下拖拽超过阈值 / 点顶部把手
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

export interface ResponsiveDrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  /** 桌面端宽度类，默认 max-w-md */
  desktopWidthClass?: string
  children: React.ReactNode
}

/** 移动端底部抽屉最大高度：72dvh（保留 28% 可视页面上文） */
const MOBILE_MAX_HEIGHT = '72dvh'

/** 下拉关闭阈值（px） */
const DRAG_CLOSE_THRESHOLD = 96

export function ResponsiveDrawer({
  open,
  onClose,
  title,
  desktopWidthClass = 'sm:max-w-md',
  children,
}: ResponsiveDrawerProps) {
  const [dragY, setDragY] = useState(0)
  const dragStartRef = useRef<number | null>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    // 打开时锁滚动，避免背景跟着滑
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prev
    }
  }, [open, handleKeyDown])

  // 关闭时复位拖拽位移，否则下次打开还带着上次的偏移
  useEffect(() => {
    if (!open) setDragY(0)
  }, [open])

  if (!open) return null

  const onTouchStart = (e: React.TouchEvent) => {
    dragStartRef.current = e.touches[0]?.clientY ?? null
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartRef.current == null) return
    const dy = (e.touches[0]?.clientY ?? 0) - dragStartRef.current
    // 只允许向下拖（负值忽略）
    setDragY(Math.max(0, dy))
  }
  const onTouchEnd = () => {
    if (dragY > DRAG_CLOSE_THRESHOLD) onClose()
    else setDragY(0)
    dragStartRef.current = null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? '详情'}
    >
      {/* 遮罩：点击关闭 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-black/25 backdrop-blur-[1px]"
      />

      {/* 面板：移动端底部全宽，桌面端右侧固定宽 */}
      <div
        className={`relative flex w-full flex-col overflow-hidden border-border/60 bg-background shadow-2xl
          rounded-t-2xl border-t border-l-0
          sm:w-auto sm:rounded-none sm:border-l sm:border-t-0 ${desktopWidthClass}`}
        style={{
          maxHeight: MOBILE_MAX_HEIGHT,
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragStartRef.current == null ? 'transform 180ms ease-out' : undefined,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* 移动端把手：既是拖拽提示，也可点击关闭 */}
        <button
          type="button"
          onClick={onClose}
          aria-label="收起面板"
          className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border sm:hidden"
        />
        {title ? (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
      </div>
    </div>
  )
}
