/**
 * 移动端 DIY 拖拽的纯逻辑：长按激活判定 + 命中目标判定。
 *
 * 为什么不用 HTML5 drag：移动端浏览器不触发 dragstart/dragover，桌面端那套
 * 在手机上完全失效，只能退回 ⬆️/⬇️ 按钮。这里用 Pointer Events 自己实现一套
 * 「长按手柄 → 拖到目标卡片 → 松手换位」，桌面端行为不变。
 *
 * 纯函数放在这里是为了能单测：命中判定与激活阈值是最容易出错的部分。
 */

/** 长按多久才进入拖拽（太短会和页面滚动冲突） */
export const LONG_PRESS_MS = 180
/** 长按后仍需移动的最小距离，避免手指微抖就判定为拖拽 */
export const MOVE_THRESHOLD_PX = 8
/** 卡片根节点上的索引标记，命中测试靠它把坐标映射回目标卡片 */
export const ITEM_INDEX_ATTR = 'data-modular-item-index'

export interface ItemRect {
  index: number
  top: number
  bottom: number
  left: number
  right: number
}

/** 触控设备判定（没有 matchMedia 的环境一律按精确指针处理，即不启用触摸拖拽） */
export function isCoarsePointer(win?: { matchMedia?: (q: string) => { matches: boolean } } | null): boolean {
  const mm = win?.matchMedia
  if (!mm) return false
  try {
    return mm.call(win, '(pointer: coarse)').matches === true
  } catch {
    return false
  }
}

/** 是否可以从「按住」升级为「正在拖拽」 */
export function shouldActivateTouchDrag(input: {
  pointerType: string
  elapsedMs: number
  distancePx: number
}): boolean {
  if (input.pointerType !== 'touch' && input.pointerType !== 'pen') return false
  if (input.elapsedMs < LONG_PRESS_MS) return false
  return input.distancePx >= MOVE_THRESHOLD_PX
}

/**
 * 坐标 → 目标卡片索引：先找完全包含该点的卡片，找不到就取距离最近的一张。
 * 返回 null 表示当前没有任何可放置的卡片。
 */
export function resolveDropIndex(x: number, y: number, rects: ItemRect[]): number | null {
  if (!rects || rects.length === 0) return null
  for (const rect of rects) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return rect.index
    }
  }
  let bestIndex: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const rect of rects) {
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
    const distance = Math.sqrt(dx * dx + dy * dy)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = rect.index
    }
  }
  return bestIndex
}

/** 从 DOM 元素上读出卡片索引（用于命中测试） */
export function readItemIndex(el: Element | null): number | null {
  if (!el) return null
  const raw = el.getAttribute(ITEM_INDEX_ATTR)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isInteger(value) ? value : null
}
