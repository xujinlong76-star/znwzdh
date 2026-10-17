'use client'

import { useCallback, useEffect, useRef } from 'react'

/** 浮层内可聚焦元素。新浮层接入时直接复用，避免各处各写一份还漏项。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * 手写浮层的公共行为层。
 *
 * 背景：项目里有 5 处浮层是手写的（三个 modular 弹窗 + 首页/视频页两个移动端抽屉），
 * 没有用 Radix Dialog，于是集体缺失五件事：Esc 不关、点遮罩不关、背景照样滚、
 * 焦点不圈养也不还原、读屏软件根本不认为它是对话框（没有 role/aria-modal）。
 *
 * 这个 hook 把这五件事一次做齐，接入方只负责把 `containerProps` 摊到浮层根节点上：
 *
 * ```tsx
 * const { containerProps, scrim } = useOverlayBehavior({ open, onClose })
 * return open ? (
 *   <div className="fixed inset-0 z-50 ...">
 *     {scrim}
 *     <div {...containerProps} className="relative ...">{children}</div>
 *   </div>
 * ) : null
 * ```
 *
 * 两个实现细节值得说明：
 * 1. **Esc 用捕获阶段 + 停止传播**：全局快捷键（检索引擎、键盘导航）也挂在
 *    document/window 上。若不用捕获阶段拦下来，关弹窗的 Esc 会同时触发全局
 *    快捷键——按 Esc 想关速览，结果把搜索面板也唤出来了。
 * 2. **滚动锁用引用计数**：浮层可能嵌套（弹窗里再开弹窗），先关的不应该把
 *    后开的滚动锁解掉。
 */

/** 滚动锁引用计数：多个浮层嵌套时，只有最后一个关闭才恢复 body 滚动 */
let scrollLockCount = 0
let scrollLockPrevOverflow = ''

function acquireScrollLock() {
  if (scrollLockCount === 0 && typeof document !== 'undefined') {
    scrollLockPrevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount++
}

function releaseScrollLock() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0 && typeof document !== 'undefined') {
    document.body.style.overflow = scrollLockPrevOverflow
  }
}

/** 打开中的浮层栈：Esc 只关最上面那个，不会一层 Esc 关掉所有 */
const overlayStack: Array<{ close: () => void }> = []

export interface OverlayBehaviorOptions {
  open: boolean
  onClose: () => void
  /** 关闭后是否把焦点还给打开前的元素，默认 true */
  restoreFocus?: boolean
}

export interface OverlayBehavior {
  /** 摊到浮层根节点：ref + role=dialog + aria-modal + tabIndex */
  containerProps: {
    ref: React.RefObject<HTMLDivElement | null>
    role: 'dialog'
    'aria-modal': boolean
    tabIndex: -1
  }
  /** 遮罩层：点它即关闭。放在浮层面板的兄弟节点，点击不会冒泡到面板 */
  scrim: React.ReactNode
  /** 遮罩的类名由调用方决定时可用这个代替 scrim */
  scrimProps: {
    'aria-hidden': boolean
    onClick: () => void
  }
}

export function useOverlayBehavior({
  open,
  onClose,
  restoreFocus = true,
}: OverlayBehaviorOptions): OverlayBehavior {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // 用 ref 存回调：调用方常常传内联箭头函数，闭包过期会让 Esc 关掉旧状态的浮层
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const handleClose = useCallback(() => closeRef.current(), [])

  useEffect(() => {
    if (!open) return

    const entry = { close: handleClose }
    overlayStack.push(entry)
    acquireScrollLock()

    // 焦点还原：记住打开前聚焦的元素，关闭时还回去
    const previouslyFocused = document.activeElement as HTMLElement | null

    // 初始焦点落到面板本身（tabIndex=-1）：既不抢输入框，也让读屏立刻定位到对话框
    const raf = requestAnimationFrame(() => containerRef.current?.focus({ preventScroll: true }))

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 捕获阶段拦截：别让 Esc 同时触发全局快捷键
        e.stopPropagation()
        e.preventDefault()
        // 只关最上层的浮层
        if (overlayStack[overlayStack.length - 1] === entry) entry.close()
        return
      }

      if (e.key === 'Tab' && containerRef.current) {
        // 焦点圈养：Tab / Shift+Tab 都在浮层内循环
        const focusable = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (focusable.length === 0) {
          e.preventDefault()
          containerRef.current.focus({ preventScroll: true })
          return
        }
        const first = focusable[0]!
        const last = focusable[focusable.length - 1]!
        const active = document.activeElement
        if (!containerRef.current.contains(active)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus({ preventScroll: true })
        } else if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus({ preventScroll: true })
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus({ preventScroll: true })
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      const idx = overlayStack.indexOf(entry)
      if (idx >= 0) overlayStack.splice(idx, 1)
      releaseScrollLock()
      // 焦点还原：元素可能已被卸载，做个存在性检查
      if (restoreFocus && previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open, handleClose, restoreFocus])

  return {
    containerProps: {
      ref: containerRef,
      role: 'dialog',
      'aria-modal': true,
      tabIndex: -1,
    },
    scrim: (
      <div
        aria-hidden="true"
        onClick={handleClose}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150"
      />
    ),
    scrimProps: {
      'aria-hidden': true,
      onClick: handleClose,
    },
  }
}
