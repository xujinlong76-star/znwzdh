/**
 * 批量键盘：首页 + 收藏页共用的薄 hook。
 *
 * 抄 hooks/use-number-dial.ts：只负责收集守卫快照 + 同步执行回调，不含判定。
 * 判定全在 lib/batch-keyboard.ts 的纯函数 resolveBatchKeyboardAction 里，
 * 执行全部走宿主传进来的回调——hook 内不直接 import 任何一面的处理器，
 * 两个面共用一个 hook + 各自的回调表（surface: 'home' | 'favorites'）。
 *
 * 挂载点：首页 components/navigation-content.tsx（useNumberDial 旁边）、
 * 收藏页 app/favorites/page.tsx（批量处理器旁边）。不挂 keyboard-shortcuts-dialog.tsx
 *（它受 feat:keyboard-nav 掩码控制）、不挂视频页、不并入 useNumberDial、
 * 不动 use-global-undo.ts 的决策函数。
 *
 * 监听相位：冒泡阶段 window keydown（与全局撤销同级）。不用捕获：
 * useNumberDial 的捕获监听在多选态已返回 null 会放行；捕获会抢在
 * diy-card-menu 的 Esc（捕获）和 undo-bar 的 Esc 之前，破坏优先级。
 * 命中即 preventDefault + stopImmediatePropagation：冒泡阶段截停，Esc 在
 * 批量模式内不再落到 undo-bar（撤销条等 8 秒自然消失）——一次按键只做一件事。
 * 注册顺序上这招成立：本 hook 挂在页面内容里，UndoBar 挂在 layout 尾部且
 * 每次 top 变化都重挂监听，故本监听先注册、先触发（须 Playwright 实测，
 * 不能只看代码）。
 *
 * Space/Enter 的切换归卡片级 onKeyDown 与按钮原生激活：焦点在 <a>/按钮上时
 * window 层再切换一次会来回跳——toggle-focused 在 window 层只处理焦点不在
 * 可交互元素上的后备情形（实践中几乎走不到，留作防线）。
 */
'use client'

import { useEffect, useRef } from 'react'
import {
  resolveBatchKeyboardAction,
  type BatchKeyboardAction,
  type BatchKeyboardContext,
  type BatchKeyboardGuards,
  type BatchKeyboardSurface,
} from '@/lib/batch-keyboard'
import {
  isAnyDialogOpen,
  isAnyMenuOpen,
  isDragHandleFocused,
  isEventTargetTyping,
} from '@/lib/keyboard-guards'

export interface BatchKeyboardCallbacks {
  onToggleMode: () => void
  onClearSelection: () => void
  onExitMode: () => void
  onToggleFocused: (siteId: string) => void
  onSelectAllVisible: () => void
  onPin?: () => void
  onExportMarkdown?: () => void
  onExportHtml?: () => void
  onDownloadMarkdown?: () => void
  onFocusMoveTarget?: () => void
  onLinkPack?: () => void
  onBatchRemove?: () => void
}

export interface UseBatchKeyboardArgs {
  surface: BatchKeyboardSurface
  inBatchMode: boolean
  hasSelection: boolean
  editingLayout: boolean
  /** 首页传 mounted（水合前不启用）；收藏页不传，默认启用 */
  enabled?: boolean
  callbacks: BatchKeyboardCallbacks
}

/**
 * 从当前焦点推导所在卡片：首页卡片根节点带 data-navhub-site-id，
 * 收藏页卡片根节点带 data-favorite-site-id。
 */
function focusedSiteIdFromDom(): string | null {
  if (typeof document === 'undefined') return null
  const active = document.activeElement as HTMLElement | null
  const card = active?.closest?.('[data-navhub-site-id], [data-favorite-site-id]') as HTMLElement | null
  if (!card) return null
  return card.dataset.navhubSiteId ?? card.dataset.favoriteSiteId ?? null
}

/** 把已认领的动作分发到宿主回调（纯分发，可单测；'ignore' 是显式吞掉，无操作）。 */
export function executeBatchKeyboardAction(
  action: BatchKeyboardAction,
  callbacks: BatchKeyboardCallbacks,
): void {
  switch (action.kind) {
    case 'toggle-mode':
      callbacks.onToggleMode()
      return
    case 'clear-selection':
      callbacks.onClearSelection()
      return
    case 'exit-mode':
      callbacks.onExitMode()
      return
    case 'toggle-focused':
      callbacks.onToggleFocused(action.siteId)
      return
    case 'select-all-visible':
      callbacks.onSelectAllVisible()
      return
    case 'pin':
      callbacks.onPin?.()
      return
    case 'export-md':
      callbacks.onExportMarkdown?.()
      return
    case 'export-html':
      callbacks.onExportHtml?.()
      return
    case 'download-md':
      callbacks.onDownloadMarkdown?.()
      return
    case 'focus-move-target':
      callbacks.onFocusMoveTarget?.()
      return
    case 'link-pack':
      callbacks.onLinkPack?.()
      return
    case 'batch-remove':
      callbacks.onBatchRemove?.()
      return
    case 'ignore':
      return
  }
}

export function useBatchKeyboard(args: UseBatchKeyboardArgs): void {
  const argsRef = useRef(args)
  argsRef.current = args

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const current = argsRef.current
      if (current.enabled === false) return
      const guards: BatchKeyboardGuards = {
        composing: e.isComposing,
        typing: isEventTargetTyping(e),
        dialogOpen: isAnyDialogOpen(),
        menuOpen: isAnyMenuOpen(),
        editingLayout: current.editingLayout,
        dragHandleFocused: isDragHandleFocused(),
      }
      const ctx: BatchKeyboardContext = {
        surface: current.surface,
        inBatchMode: current.inBatchMode,
        hasSelection: current.hasSelection,
        focusedSiteId: focusedSiteIdFromDom(),
      }
      const action = resolveBatchKeyboardAction(e, guards, ctx)
      if (!action) return
      // Space/Enter 的切换归卡片级 onKeyDown 与按钮原生激活：焦点在 <a>/按钮上
      // 时 window 层再切换一次会来回跳，这里直接放行（不 preventDefault，
      // 原生激活/卡片处理照常进行）。
      if (action.kind === 'toggle-focused') {
        const target = e.target as HTMLElement | null
        if (target?.closest?.('button, a, input, select, textarea, [role="button"]')) return
      }
      // 命中：冒泡阶段截停，不再往下冒泡给其它全局监听（Esc 不再关撤销条）。
      e.preventDefault()
      e.stopImmediatePropagation()
      executeBatchKeyboardAction(action, current.callbacks)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
