/**
 * 批量键盘：纯决策函数（可单测，不 import React）。
 *
 * 判定全在这里：hook（hooks/use-batch-keyboard.ts）只负责从 DOM 收集守卫快照
 * 与同步执行回调，卡片级 onKeyDown（首页 navigation-card.tsx、收藏页
 * app/favorites/page.tsx）也调同一份判定——三处同源，改键只改这里。
 *
 * 守卫与优先级（设计 §3.4，抄 use-global-undo.ts 的注释风格）：
 *   1. isComposing → 放行（中文组字）；
 *   2. isEventTargetTyping → 放行（搜索框、备注/标签/文件夹改名等行内输入框；
 *      Ctrl+A 在此放行原生全选）；
 *   3. isAnyDialogOpen / isAnyMenuOpen → 放行（Spotlight、快捷键指南、速览、
 *      链接包对话框、Radix 下拉菜单）；
 *   4. DIY 编排态 / 拖拽手柄聚焦 → 放行；
 *   5. 不在多选/批量模式 → 只认 M（进入模式），其余一律放行
 *      （裸字母键平时不劫持键盘——WCAG 2.1.4 单字符快捷键冲突的既有处理思路）；
 *   6. Esc 优先级：dialog/menu 自身的 Esc → 批量 Esc（清空/退出模式）→
 *      undo-bar 的 Esc（关撤销条）。批量模式内 Esc 不再关撤销条——代价是撤销条
 *      要等 8 秒自然消失，换来「一次按键只做一件事」的确定性；
 *   7. Ctrl/Cmd+Z、⌘/Ctrl+K、/、Ctrl/Cmd+J、D/B/T/?、Alt+1/2/3、Ctrl/Cmd+E、
 *      数字键一律不认领、不 stopPropagation（数字直达在多选态已自行让位，
 *      无需本函数干预）。
 *
 * 11b 已补撤销，Delete 可用（第 11 项后续 (b) 撤销栈）：
 * 首页批量 add/remove/pin 现经全局撤销栈（home.batch-add /
 * home.batch-remove / home.batch-pin，8 秒窗口、各自独立一条），
 * Delete/Backspace 在多选态有选中时发 batch-remove，与收藏页同款；
 * 无选中返回 null（放行，不吞）。旧裁决 (a)（v1 首页不上键盘 Delete，
 * 因当时无撤销）已失效，见提交说明。
 * 收藏页 Delete 照常发 batch-remove（已有完整撤销：逐条 remove 进栈，
 * 8 秒内同 kind 合并成一条）。
 */

export type BatchKeyboardSurface = 'home' | 'favorites'

/** 只取判定需要的键字段：卡片级 React 事件与 window 层原生事件都能喂进来 */
export interface BatchKeyboardEventLike {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  isComposing?: boolean
}

export interface BatchKeyboardGuards {
  /** 中文输入法组字中 */
  composing: boolean
  /** 焦点/目标在输入态（INPUT/TEXTAREA/SELECT/contentEditable/role 输入框） */
  typing: boolean
  /** 任意 role=dialog/alertdialog（非 aria-hidden）正打开 */
  dialogOpen: boolean
  /** 任意 role=menu（非 aria-hidden）正打开（Radix 下拉菜单） */
  menuOpen: boolean
  /** DIY 编排态 */
  editingLayout: boolean
  /** 焦点在 dnd-kit 拖拽手柄上（键盘拖拽进行中时焦点一定在这里） */
  dragHandleFocused: boolean
}

export interface BatchKeyboardContext {
  surface: BatchKeyboardSurface
  /** 首页 selectionMode / 收藏页 batchMode */
  inBatchMode: boolean
  /** 是否已有选中项（Esc 两段式与收藏页删除用） */
  hasSelection?: boolean
  /** 焦点所在卡片的站点 id（卡片级调用传本卡 id；window 层由 hook 从 activeElement 推导） */
  focusedSiteId?: string | null
}

export type BatchKeyboardAction =
  | { kind: 'toggle-mode' }
  | { kind: 'clear-selection' }
  | { kind: 'exit-mode' }
  | { kind: 'toggle-focused'; siteId: string }
  | { kind: 'select-all-visible' }
  | { kind: 'pin' }
  | { kind: 'export-md' }
  | { kind: 'export-html' }
  | { kind: 'download-md' }
  | { kind: 'focus-move-target' }
  | { kind: 'link-pack' }
  | { kind: 'batch-remove' }
  /** 显式吞掉、不执行任何操作（11b 后首页 Delete 不再返回它；卡片级仍在用，见 navigation-card.tsx） */
  | { kind: 'ignore' }

/**
 * 按序短路判定一次批量按键：返回 null = 不是批量键，放行、不吞；
 * 返回动作 = 已认领，调用方必须 preventDefault + stopImmediatePropagation。
 */
export function resolveBatchKeyboardAction(
  e: BatchKeyboardEventLike,
  guards: BatchKeyboardGuards,
  ctx: BatchKeyboardContext,
): BatchKeyboardAction | null {
  // 1–4. 守卫短路：任一命中都放行。
  if (
    guards.composing ||
    guards.typing ||
    guards.dialogOpen ||
    guards.menuOpen ||
    guards.editingLayout ||
    guards.dragHandleFocused
  ) {
    return null
  }

  const key = e.key
  const ctrl = Boolean(e.ctrlKey)
  const meta = Boolean(e.metaKey)
  const shift = Boolean(e.shiftKey)
  const alt = Boolean(e.altKey)
  const mod = ctrl || meta
  const lower = typeof key === 'string' ? key.toLowerCase() : ''

  // 6. Esc 两段式：dialog/menu 已在守卫里放行，这里只剩批量自己的 Esc。
  // 模式外 Esc 不认领（不抢各浮层的关闭键）；模式内有选中先清空，无选中再退出。
  if (key === 'Escape' && !mod && !shift && !alt) {
    if (!ctx.inBatchMode) return null
    return ctx.hasSelection ? { kind: 'clear-selection' } : { kind: 'exit-mode' }
  }

  // 5. 模式外只认裸 M（进入模式），其余一律放行。
  if (!ctx.inBatchMode) {
    if (lower === 'm' && !mod && !alt) return { kind: 'toggle-mode' }
    return null
  }

  // 模式内：Ctrl/Cmd+A 全选可见/已渲染（输入态已在守卫里放行原生全选）。
  if (mod && !shift && !alt && lower === 'a') return { kind: 'select-all-visible' }

  // Space / Enter：只在焦点有卡片时切换该卡。卡片级 onKeyDown 先处理
  // （<a> 的 Enter 原生激活拦不住，window 冒泡 preventDefault 来不及）；
  // window 层是后备，焦点不在 <a>/按钮上时才可能走到这里。
  if (!mod && !alt && (key === ' ' || e.code === 'Space' || key === 'Enter')) {
    return ctx.focusedSiteId ? { kind: 'toggle-focused', siteId: ctx.focusedSiteId } : null
  }

  // Delete / Backspace：收藏页与首页批量删除（11b：首页已有完整撤销）；
  // 有选中发 batch-remove，无选中返回 null（放行，不吞）。
  if (!mod && !shift && !alt && (key === 'Delete' || key === 'Backspace')) {
    return ctx.hasSelection ? { kind: 'batch-remove' } : null
  }

  // 7. 其余一律不认领：Ctrl+Z / ⌘K / / / Ctrl+J / D/B/T/? / Alt+1/2/3 /
  // Ctrl+E / 数字键都不在下面出现，自然落到 null。
  if (mod || alt) return null
  // 单动作裸键：Shift 不区分动作时容忍 Shift（与大写锁定一致）。
  if (lower === 'm') return { kind: 'toggle-mode' }
  if (ctx.surface === 'home') {
    if (lower === 'p') return { kind: 'pin' }
    // E：复制 Markdown；Shift+E：下载 .md（Shift 在此区分动作，不容忍）。
    if (lower === 'e') return shift ? { kind: 'download-md' } : { kind: 'export-md' }
    if (lower === 'f') return { kind: 'focus-move-target' }
    return null
  }
  // favorites：E 导出 MD；Shift+E 导出 HTML；F 聚焦移夹下拉；L 打包成链接包。
  if (lower === 'e') return shift ? { kind: 'export-html' } : { kind: 'export-md' }
  if (lower === 'f') return { kind: 'focus-move-target' }
  if (lower === 'l') return { kind: 'link-pack' }
  return null
}
