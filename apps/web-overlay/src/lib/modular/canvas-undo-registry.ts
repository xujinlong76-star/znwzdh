'use client'

/**
 * 画布撤销注册表（全局 Ctrl+Z 分发用）。
 *
 * 画布的 history/future 是 hook 内 useState，没有模块级真源——全局监听
 * （hooks/use-global-undo）够不着它。这里只登记「当前挂载的画布」的
 * undo/redo 与可否撤销，同一时间只有一个画布实例，登记即覆盖；
 * 卸载时清掉，不留野指针。按钮仍调 hook 自己的 undo/redo，只监听收敛。
 *
 * 单独成模块且零 import：use-global-undo 只需这个单例，不必拖进
 * use-modular-layout 及其全部传递依赖（registry、16 个 widget、
 * speculative.ts……），否则整条链路会进首屏同步集。
 */
export interface CanvasUndoHandler {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

let canvasUndoHandler: CanvasUndoHandler | null = null

export function registerCanvasUndoHandler(handler: CanvasUndoHandler | null): void {
  canvasUndoHandler = handler
}

export function getCanvasUndoHandler(): CanvasUndoHandler | null {
  return canvasUndoHandler
}
