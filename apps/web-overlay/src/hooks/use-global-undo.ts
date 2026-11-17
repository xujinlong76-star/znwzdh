'use client'

/**
 * 全局 Ctrl/Cmd+Z 监听（全站只挂一次，由 Providers 调用）。
 *
 * 收敛前三处监听为一处分发（use-home-diy.ts:608 仅编排态、
 * modular-canvas.tsx:166、navigation-content.tsx:499），三处旧监听
 * 已删除，只留这里一处真源；DIY/画布/回收站的按钮仍调各自 undo，
 * 只监听收敛。useNumberDial 的捕获阶段监听不动（数字键与 Ctrl+Z 无交集）。
 *
 * 优先级（一次按键只做一件事，命中即 preventDefault + stopImmediatePropagation）：
 *  (1) IME 输入中（isComposing / keyCode 229）→ 放行；
 *  (2) 焦点在可编辑元素 → 放行原生文字撤销（INPUT / TEXTAREA / SELECT /
 *      contentEditable / role=textbox 等，以 keyboard-guards 的统一判定为准，
 *      修掉 modular-canvas 只认前两项的 bug）；
 *  (3) 有模态 Dialog / 搜索面板打开 → 放行；
 *  (4) claimHomeDiyHistoryStep() 已被认领 → 返回（保留现有认领制）；
 *  (5) DIY 编排态且 canUndo → undoHomeDiy()；否则画布 canUndo → 画布 undo()；
 *      否则 feature-mask trashBin 非空 → undoLastRemove()（+ 分类双写）；
 *      否则全局收藏栈 pop → 执行其 undo()；
 *  (6) Ctrl+Shift+Z / Ctrl+Y（非 Mac 的 Y）：只重做 DIY/画布快照栈，
 *      收藏类无 redo；无可重做时放行，不吞按键；
 *  (7) Mac 用 metaKey，其余用 ctrlKey；候选键在同步分流后先行认领
 *      （preventDefault + stopImmediatePropagation），再加载重实现决策——
 *      非输入场景下 Ctrl+Z 无浏览器默认行为，提前认领不改变可观察行为；
 *      放行场景（1）-（4）在认领前已返回。
 *
 * 首屏网守（U-24）：监听本身只静态依赖 keyboard-guards + undo-stack +
 * home-diy-claim（均为同步轻量模块）；DIY/画布/掩码三棵重实现
 * （home-diy-storage、canvas-undo-registry、feature-mask-store）与
 * useFavorites 链只在第一次按下候选撤销/重做键时才 dynamic import，
 * 平时不进全路由共享 chunk。
 */

import { useEffect } from 'react'
import {
  claimHomeDiyHistoryStep,
  didHomeDiyHistoryStepClaimThisTask,
} from '@/lib/modular/home-diy-claim'
import { peekGlobalUndo, popGlobalUndo } from '@/lib/undo-stack'
import { isAnyDialogOpen, isEventTargetTyping } from '@/lib/keyboard-guards'

export type GlobalUndoAction =
  | 'undo-diy'
  | 'undo-canvas'
  | 'undo-mask'
  | 'undo-favorites'
  | 'redo-diy'
  | 'redo-canvas'
  | 'ignore'

export interface GlobalUndoKeyState {
  /** IME 输入中 */
  composing: boolean
  /** 焦点在可编辑元素 */
  typing: boolean
  /** 有模态 Dialog / 搜索面板打开 */
  dialogOpen: boolean
  /** 已被别的监听认领（同一任务内只撤一步） */
  diyClaimed: boolean
  /** DIY 编排态且有历史可撤 */
  diyCanUndo: boolean
  /** 画布有历史可撤 */
  canvasCanUndo: boolean
  /** feature-mask 回收站非空 */
  maskHasTrash: boolean
  /** 全局收藏栈非空（8 秒窗口内） */
  favoritesHasUndo: boolean
  /** DIY 有历史可重做 */
  diyCanRedo: boolean
  /** 画布有历史可重做 */
  canvasCanRedo: boolean
  /** 是否按下 Shift（重做分支） */
  shiftKey: boolean
  /** 按的是 Y（Ctrl+Y 重做，非 Mac） */
  isY: boolean
  /** 按的是 Z */
  isZ: boolean
  /** 修饰键（Mac=meta，其余=ctrl）是否按下 */
  modifier: boolean
  /** 是否 Mac（Y 重做只在非 Mac 生效） */
  isMac: boolean
}

/**
 * 纯决策函数：一次按键只做一件事。测试直接调它，不用挂真实监听。
 * isZ/isY/modifier 先由调用方从 KeyboardEvent 换算好。
 */
export function decideGlobalUndoKey(state: GlobalUndoKeyState): GlobalUndoAction {
  if (!state.modifier) return 'ignore'
  if (state.composing) return 'ignore'
  if (state.typing) return 'ignore'
  if (state.dialogOpen) return 'ignore'
  if (state.diyClaimed) return 'ignore'
  if (state.isY) {
    // Ctrl+Y 只重做 DIY/画布；收藏类无 redo；无可重做时放行，不吞按键
    if (state.isMac) return 'ignore'
    if (state.diyCanRedo) return 'redo-diy'
    if (state.canvasCanRedo) return 'redo-canvas'
    return 'ignore'
  }
  if (!state.isZ) return 'ignore'
  if (state.shiftKey) {
    // Ctrl+Shift+Z 只重做 DIY/画布
    if (state.diyCanRedo) return 'redo-diy'
    if (state.canvasCanRedo) return 'redo-canvas'
    return 'ignore'
  }
  if (state.diyCanUndo) return 'undo-diy'
  if (state.canvasCanUndo) return 'undo-canvas'
  if (state.maskHasTrash) return 'undo-mask'
  if (state.favoritesHasUndo) return 'undo-favorites'
  return 'ignore'
}

/** 从 KeyboardEvent 换算出 decideGlobalUndoKey 的输入（DOM 判定放这里，决策放纯函数） */
export function describeGlobalUndoKeyEvent(e: KeyboardEvent): Omit<GlobalUndoKeyState, 'diyCanUndo' | 'canvasCanUndo' | 'maskHasTrash' | 'favoritesHasUndo' | 'diyCanRedo' | 'canvasCanRedo'> {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  return {
    composing: e.isComposing || e.keyCode === 229,
    typing: isEventTargetTyping(e),
    dialogOpen: isAnyDialogOpen(),
    diyClaimed: didHomeDiyHistoryStepClaimThisTask(),
    shiftKey: e.shiftKey,
    isY: e.key.toLowerCase() === 'y',
    isZ: e.key.toLowerCase() === 'z',
    modifier: isMac ? e.metaKey : e.ctrlKey,
    isMac,
  }
}

/**
 * 与 useFavorites().undoLast()（hooks/useFavorites.ts:1172-1180）逐行等价：
 * 取栈顶并执行其 undo()；空栈 / 抛错时返回 { ok: false, message }。
 * undoLast 不读任何 hook 本地状态，只依赖 undo-stack 单例——直接走
 * undo-stack 即可，不必为这一个调用把整条 useFavorites 链
 * （82,203B 源码 + import-workbench / quicklinks / favorites-triage 等闭包）
 * 拉进根 layout 的静态 import。
 */
async function undoLast(): Promise<{ ok: boolean; message?: string }> {
  const entry = popGlobalUndo()
  if (!entry) return { ok: false, message: '没有可撤销的操作' }
  try {
    return await entry.undo()
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '撤销失败' }
  }
}

/**
 * 全局监听（Providers 里只调一次）。返回 true 表示本次按键已被消费。
 * 注意：DIY undo 走 claim 制（按钮入口也认领），其余分支不认领——
 * 认领只拦"同一按键撤两步 DIY"，收藏/mask/画布各只有一条路。
 *
 * 两段式：同步轻量分流（只读 keyboard-guards + 认领叶子模块）先筛掉
 * 非候选键与放行场景；候选键先行认领（preventDefault +
 * stopImmediatePropagation），再 dynamic import 三棵重实现做完整决策
 * 与执行。监听只挂一次（deps []），重实现加载后常驻 chunk，后续按键
 * 不再重复加载。
 */
export function useGlobalUndo(): void {
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      const desc = describeGlobalUndoKeyEvent(e)
      // 同步分流：不是撤销/重做键，或应放行的场景（IME/输入框/对话框/
      // 已被认领）——直接返回，不加载重实现。
      if (!desc.modifier) return
      if (!desc.isZ && !desc.isY) return
      if (desc.composing || desc.typing || desc.dialogOpen || desc.diyClaimed) return
      // 候选撤销/重做键：先同步认领再加载。非输入场景下 Ctrl+Z 无浏览器
      // 默认行为，等加载回来再拦截会漏掉；放行场景已在上面返回，不会被吞键。
      e.preventDefault()
      e.stopImmediatePropagation()
      const [
        {
          commitHomeDiyConfig,
          getHomeDiySnapshot,
          redoHomeDiy,
          undoHomeDiy,
        },
        { getCanvasUndoHandler },
        {
          getFeatureMaskSnapshot,
          stripFeaturePrefix,
          undoLastFeatureRemove,
        },
      ] = await Promise.all([
        import('@/lib/modular/home-diy-storage'),
        import('@/lib/modular/canvas-undo-registry'),
        import('@/lib/modular/feature-mask-store'),
      ])

      /** feature-mask 恢复的分类双写（navigation-content.tsx:462 的模式） */
      const undoMaskRemove = (): boolean => {
        const restored = undoLastFeatureRemove()
        if (!restored) return false
        if (restored.level === 'L2_CATEGORY') {
          // 两份账本（DIY hiddenCategoryIds + 掩码 hiddenCategories）一起清，
          // 只清掩码会让下一次 syncHiddenCategoriesFromDIY 又把它藏回去
          commitHomeDiyConfig((prev) => ({
            ...prev,
            hiddenCategoryIds: (prev.hiddenCategoryIds ?? []).filter(
              (id) => id !== stripFeaturePrefix(restored.id),
            ),
            updatedAt: Date.now(),
          }))
        }
        return true
      }

      const snapshot = getHomeDiySnapshot()
      const canvas = getCanvasUndoHandler()
      const action = decideGlobalUndoKey({
        ...desc,
        diyCanUndo: snapshot.isEditingLayout && snapshot.history.past.length > 0,
        canvasCanUndo: canvas !== null && canvas.canUndo,
        maskHasTrash: getFeatureMaskSnapshot().trashBin.length > 0,
        // 收藏栈的"有无"不经过 React 状态：按键处理是事件驱动，读单例最准；
        // peek 会剪掉过期条（条消失 = 撤销失效，D1）。
        favoritesHasUndo: peekGlobalUndo() !== null,
        diyCanRedo: snapshot.history.future.length > 0,
        canvasCanRedo: canvas !== null && canvas.canRedo,
      })
      if (action === 'ignore') return
      switch (action) {
        case 'undo-diy': {
          // 认领失败说明别的入口已处理了这次按键，直接返回，不再撤第二步
          if (!claimHomeDiyHistoryStep()) return
          undoHomeDiy()
          return
        }
        case 'redo-diy': {
          if (!claimHomeDiyHistoryStep()) return
          redoHomeDiy()
          return
        }
        case 'undo-canvas': {
          canvas?.undo()
          return
        }
        case 'redo-canvas': {
          canvas?.redo()
          return
        }
        case 'undo-mask': {
          undoMaskRemove()
          return
        }
        case 'undo-favorites': {
          await undoLast()
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
