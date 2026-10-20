import { describe, expect, it } from 'vitest'
import {
  ITEM_INDEX_ATTR,
  LONG_PRESS_MS,
  MOVE_THRESHOLD_PX,
  isCoarsePointer,
  readItemIndex,
  resolveDropIndex,
  shouldActivateTouchDrag,
  type ItemRect,
} from '../src/lib/modular/touch-reorder'

const RECTS: ItemRect[] = [
  { index: 0, top: 0, bottom: 100, left: 0, right: 100 },
  { index: 1, top: 120, bottom: 220, left: 0, right: 100 },
  { index: 2, top: 240, bottom: 340, left: 0, right: 100 },
]

describe('移动端 DIY 拖拽：设备与激活判定', () => {
  it('matchMedia 命中 pointer: coarse 才算触控设备', () => {
    expect(isCoarsePointer({ matchMedia: () => ({ matches: true }) })).toBe(true)
    expect(isCoarsePointer({ matchMedia: () => ({ matches: false }) })).toBe(false)
  })

  it('缺少 matchMedia 或抛错时按精确指针处理（不启用触摸拖拽）', () => {
    expect(isCoarsePointer({})).toBe(false)
    expect(isCoarsePointer(null)).toBe(false)
    expect(
      isCoarsePointer({
        matchMedia: () => {
          throw new Error('boom')
        },
      }),
    ).toBe(false)
  })

  it('只有触控/笔 + 超过长按时长 + 超过移动阈值才激活拖拽', () => {
    expect(
      shouldActivateTouchDrag({ pointerType: 'touch', elapsedMs: LONG_PRESS_MS, distancePx: MOVE_THRESHOLD_PX }),
    ).toBe(true)
    expect(
      shouldActivateTouchDrag({ pointerType: 'pen', elapsedMs: LONG_PRESS_MS + 50, distancePx: 40 }),
    ).toBe(true)
    expect(shouldActivateTouchDrag({ pointerType: 'mouse', elapsedMs: 999, distancePx: 99 })).toBe(false)
    expect(
      shouldActivateTouchDrag({ pointerType: 'touch', elapsedMs: LONG_PRESS_MS - 1, distancePx: 40 }),
    ).toBe(false)
    expect(
      shouldActivateTouchDrag({ pointerType: 'touch', elapsedMs: LONG_PRESS_MS, distancePx: MOVE_THRESHOLD_PX - 1 }),
    ).toBe(false)
  })
})

describe('移动端 DIY 拖拽：命中判定', () => {
  it('落在卡片内直接命中该卡片', () => {
    expect(resolveDropIndex(50, 150, RECTS)).toBe(1)
    expect(resolveDropIndex(10, 10, RECTS)).toBe(0)
  })

  it('落在空白处取距离最近的卡片', () => {
    expect(resolveDropIndex(50, 110, RECTS)).toBe(0)
    expect(resolveDropIndex(50, 230, RECTS)).toBe(1)
  })

  it('没有卡片时返回 null', () => {
    expect(resolveDropIndex(10, 10, [])).toBeNull()
  })

  it('从元素属性读取索引', () => {
    const fake = (value: string | null) => ({ getAttribute: () => value }) as unknown as Element
    expect(readItemIndex(fake('2'))).toBe(2)
    expect(readItemIndex(fake(null))).toBeNull()
    expect(readItemIndex(fake('abc'))).toBeNull()
    expect(readItemIndex(null)).toBeNull()
    expect(ITEM_INDEX_ATTR).toBe('data-modular-item-index')
  })
})
