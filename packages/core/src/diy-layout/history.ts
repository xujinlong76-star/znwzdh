/**
 * 撤销/重做时间旅行栈算法 (Time-Travel Undo/Redo Engine)。
 */

export interface LayoutHistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

export function createLayoutHistory<T>(initial: T): LayoutHistoryState<T> {
  return {
    past: [],
    present: initial,
    future: [],
  }
}

export function pushLayoutHistory<T>(
  history: LayoutHistoryState<T>,
  nextState: T,
  maxDepth = 25
): LayoutHistoryState<T> {
  if (JSON.stringify(history.present) === JSON.stringify(nextState)) {
    return history
  }

  const newPast = [...history.past, history.present]
  if (newPast.length > maxDepth) {
    newPast.shift()
  }

  return {
    past: newPast,
    present: nextState,
    future: [],
  }
}

export function undoLayoutHistory<T>(history: LayoutHistoryState<T>): LayoutHistoryState<T> {
  if (history.past.length === 0) return history

  const previous = history.past[history.past.length - 1]!
  const newPast = history.past.slice(0, -1)

  return {
    past: newPast,
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoLayoutHistory<T>(history: LayoutHistoryState<T>): LayoutHistoryState<T> {
  if (history.future.length === 0) return history

  const next = history.future[0]!
  const newFuture = history.future.slice(1)

  return {
    past: [...history.past, history.present],
    present: next,
    future: newFuture,
  }
}
