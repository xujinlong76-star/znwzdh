/**
 * 全局单字符/数字快捷键的「让位」守卫（共享版）。
 *
 * 原来只活在 keyboard-shortcuts-dialog.tsx 的 handleKeyDown 闭包里：
 * 输入态判定（target 与 document.activeElement 双查）+ 弹窗打开判定，
 * 是全仓最全的一份。数字直达（useNumberDial）与视图切换共用同一份守卫，
 * 两处判定一旦分叉，就会出现「输入框里按数字跳站」或「对话框里按 Alt+1
 * 切视图」这类按键劫持。不要用 lib/user-preferences.ts 的 isEditableTarget，
 * 那份只认 INPUT/TEXTAREA/SELECT/contentEditable，认不出 role=textbox /
 * combobox / searchbox 的自定义输入框与 SELECT 里的 type-ahead。
 *
 * 纯 DOM 判定，不 import React：测试可直接传替身元素。
 */

/** 输入态判定（强版）：INPUT / TEXTAREA / SELECT / contentEditable / role 输入框 */
export function isTypingTarget(el: {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
} | null | undefined): boolean {
  if (!el) return false
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null
  return role === 'textbox' || role === 'combobox' || role === 'searchbox'
}

/**
 * 一次按键是否正落在输入态：只看 e.target 不够——下拉框（SELECT）里的
 * type-ahead 选词、role=textbox/combobox 的自定义输入框，target 都不是
 * INPUT/TEXTAREA；e.target 与当前焦点偶尔不一致时，以 activeElement 为准。
 */
export function isEventTargetTyping(e: {
  target?: unknown
}): boolean {
  const target = e.target as Parameters<typeof isTypingTarget>[0] | null
  if (isTypingTarget(target)) return true
  if (typeof document !== 'undefined') {
    return isTypingTarget(document.activeElement as Parameters<typeof isTypingTarget>[0] | null)
  }
  return false
}

/**
 * 元素自身或任一祖先是否被 display:none 藏起（计算样式判定）。
 *
 * 小猫猫挂件的聊天/游戏面板是典型：关闭态常驻 DOM、无 aria-hidden，
 * 但 display:none——不排除会让 isAnyDialogOpen 在首页永久为真，
 * 全站 dialog 守卫的快捷键（数字直达、全局撤销、批量键盘）全被压住。
 * 无 defaultView / 无 getComputedStyle（如 node 单测替身）时不排除，
 * 退回「存在即打开」，避免测试环境里守卫静默失效。
 */
function isHiddenByDisplay(el: Element, doc: Document): boolean {
  const view = doc.defaultView
  if (!view || typeof view.getComputedStyle !== 'function') return false
  let node: Element | null = el
  while (node) {
    if (view.getComputedStyle(node).display === 'none') return true
    node = node.parentElement
  }
  return false
}

/**
 * 是否有任意模态正打开：role=dialog / alertdialog 且未 aria-hidden、
 * 且未被 display:none 藏起。
 * 排除 aria-hidden：常驻 DOM 的抽屉关闭态也带 role=dialog，不排除会让
 * 全局快捷键在移动端永久失效；排除 display:none：同理，小猫猫挂件的
 * 关闭态面板没有 aria-hidden，但 display:none——只看属性会让首页的
 * 全局快捷键永久失效（2026-11-14 批量键盘 E2E 实测）。
 */
export function isAnyDialogOpen(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): boolean {
  if (!doc) return false
  const nodes = doc.querySelectorAll('[role="dialog"]:not([aria-hidden="true"]), [role="alertdialog"]:not([aria-hidden="true"])')
  return Array.from(nodes).some((el) => !isHiddenByDisplay(el, doc))
}

/**
 * 是否有任意 Radix 下拉菜单正打开：role=menu 且未 aria-hidden、
 * 且未被 display:none 藏起（同 isAnyDialogOpen 的 display:none 排除）。
 * isAnyDialogOpen 只认 dialog/alertdialog；home-diy-toolbar.tsx:300 的 Esc
 * 处理里早就补了 role=menu——批量键盘把这份判定收进共享守卫，两处同源，
 * 菜单打开时批量键必须让位（菜单自己的 Esc 收起菜单，批量 Esc 不抢）。
 */
export function isAnyMenuOpen(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): boolean {
  if (!doc) return false
  const nodes = doc.querySelectorAll('[role="menu"]:not([aria-hidden="true"])')
  return Array.from(nodes).some((el) => !isHiddenByDisplay(el, doc))
}

/** 焦点是否正落在 dnd-kit 拖拽手柄上（键盘拖拽进行中时焦点一定在这里） */
export function isDragHandleFocused(
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): boolean {
  if (!doc) return false
  const active = doc.activeElement as HTMLElement | null
  return Boolean(active?.hasAttribute?.('data-diy-drag-handle'))
}
