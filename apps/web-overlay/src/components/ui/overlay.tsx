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
  /**
   * 对话框的可读名称（`role="dialog"` 没有名称时，读屏只会念出内容，
   * 用户不知道"这是哪个弹窗"）。三种给法按优先级：
   * `ariaLabelledBy`（标题元素 id）> `ariaLabel`（直接给词）> 两者都不给则留空，
   * 由调用方自己把 `aria-label` 摊在根节点上。
   */
  ariaLabel?: string
  ariaLabelledBy?: string
  /**
   * 打开后自动聚焦的元素（搜索弹窗的输入框、配置弹窗的标题框…）。
   *
   * 为什么由 hook 来做而不是调用方自己 `useEffect(() => ref.current?.focus())`：
   * hook 的面板聚焦排在 `requestAnimationFrame` 里，调用方的 effect 在它**之前**执行，
   * 于是「先聚焦输入框」必然被随后落地的面板聚焦抢走 —— 接入方的自动聚焦看似写了，实际全废。
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

export interface OverlayBehavior {
  /**
   * 摊到浮层根节点：ref + role + tabIndex。
   *
   * 注意 `open` 为假时这里会给 `aria-hidden` + `inert`：抽屉是常驻 DOM 的
   * （靠 transform 移出屏外），如果关闭态还带着 role="dialog"，那么
   * `document.querySelector('[role="dialog"]')` 这类"有没有开着的模态"判定
   * 会永久为真 —— 键盘导航与全局快捷键会被一起关掉。aria-hidden + inert
   * 同时解决三件事：读屏跳过、焦点进不去、模态判定不再误报。
   */
  containerProps: {
    ref: React.RefObject<HTMLDivElement | null>
    role: 'dialog'
    'aria-modal': 'true' | 'false'
    'aria-hidden'?: 'true'
    'aria-label'?: string
    'aria-labelledby'?: string
    inert?: boolean
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
  ariaLabel,
  ariaLabelledBy,
  initialFocusRef,
}: OverlayBehaviorOptions): OverlayBehavior {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // 用 ref 存回调：调用方常常传内联箭头函数，闭包过期会让 Esc 关掉旧状态的浮层
  const closeRef = useRef(onClose)
  // 在 effect 里同步（而非渲染期赋值）：避免渲染阶段写 ref 的副作用
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  const handleClose = useCallback(() => closeRef.current(), [])

  useEffect(() => {
    if (!open) return

    const entry = { close: handleClose }
    overlayStack.push(entry)
    acquireScrollLock()

    // 焦点还原：记住打开前聚焦的元素，关闭时还回去
    const previouslyFocused = document.activeElement as HTMLElement | null

    // 初始焦点：优先落到调用方指定的输入元素，否则落到面板本身（tabIndex=-1）——
    // 既不抢正文，也让读屏立刻定位到对话框
    const raf = requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? containerRef.current
      target?.focus({ preventScroll: true })
    })

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
  }, [open, handleClose, restoreFocus, initialFocusRef])

  return {
    containerProps: {
      ref: containerRef,
      role: 'dialog',
      'aria-modal': open ? 'true' : 'false',
      // 名称：labelledby（指向真实标题）优先于 label（直接给词），两者都不给就不写，
      // 避免 aria-label="" 这种「有属性但没内容」的空名称
      ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : ariaLabel ? { 'aria-label': ariaLabel } : {}),
      // 关闭态从辅助树与焦点顺序里摘掉（见 interface 注释：这是模态判定的防误报关键）
      ...(open ? {} : { 'aria-hidden': 'true' as const, inert: true }),
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
