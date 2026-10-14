import { describe, it, expect } from 'vitest'
import {
  calculateNextGridFocusIndex,
  calculateNextCategoryPointer,
} from '../src/keyboard-nav'

describe('极客全键盘漫游流算法引擎 (Keyboard-First Navigator Engine)', () => {
  it('网格内左右移动：在一行 4 列网格中计算左右移动并遵守边界', () => {
    // 4 列网格，共 10 个元素
    // [0, 1, 2, 3]
    // [4, 5, 6, 7]
    // [8, 9]

    // 1. 中间向右移动
    expect(calculateNextGridFocusIndex(10, 1, 'right', { columns: 4 })).toBe(2)

    // 2. 行末向右（非循环时保持在行末）
    expect(calculateNextGridFocusIndex(10, 3, 'right', { columns: 4, loop: false })).toBe(3)

    // 3. 行末向右（开启回环时回到该行行首）
    expect(calculateNextGridFocusIndex(10, 3, 'right', { columns: 4, loop: true })).toBe(0)

    // 4. 行首向左（非循环时保持行首）
    expect(calculateNextGridFocusIndex(10, 4, 'left', { columns: 4, loop: false })).toBe(4)

    // 5. 行首向左（循环时跳到该行行末）
    expect(calculateNextGridFocusIndex(10, 4, 'left', { columns: 4, loop: true })).toBe(7)
  })

  it('网格内上下移动：准确计算行跨越与末行不完整行保护', () => {
    // 1. 0 号向下跳到 4 号
    expect(calculateNextGridFocusIndex(10, 0, 'down', { columns: 4 })).toBe(4)

    // 2. 5 号向下跳到 9 号
    expect(calculateNextGridFocusIndex(10, 5, 'down', { columns: 4 })).toBe(9)

    // 3. 7 号向下（末行该列无元素，停在自身或受控边界）
    expect(calculateNextGridFocusIndex(10, 7, 'down', { columns: 4, loop: false })).toBe(7)

    // 4. 首行向上边界保护
    expect(calculateNextGridFocusIndex(10, 2, 'up', { columns: 4, loop: false })).toBe(2)

    // 5. first 与 last 快捷跳跃
    expect(calculateNextGridFocusIndex(10, 5, 'first')).toBe(0)
    expect(calculateNextGridFocusIndex(10, 5, 'last')).toBe(9)
  })

  it('跨分类流体漫游算法 (calculateNextCategoryPointer)', () => {
    // 三个分类，卡片数分别为 3, 0(空分类), 4
    const counts = [3, 0, 4]

    // 1. 下一分类（自动跨过空分类）
    const p1 = calculateNextCategoryPointer(counts, { categoryIndex: 0, cardIndex: 1 }, 'next_category')
    expect(p1.categoryIndex).toBe(2)
    expect(p1.cardIndex).toBe(0)

    // 2. 下一张卡片平滑跨越到下一分类首张卡片
    const p2 = calculateNextCategoryPointer(counts, { categoryIndex: 0, cardIndex: 2 }, 'next_card')
    expect(p2.categoryIndex).toBe(2)
    expect(p2.cardIndex).toBe(0)

    // 3. 上一张卡片平滑跨越到上一分类末尾卡片
    const p3 = calculateNextCategoryPointer(counts, { categoryIndex: 2, cardIndex: 0 }, 'prev_card')
    expect(p3.categoryIndex).toBe(0)
    expect(p3.cardIndex).toBe(2)
  })
})
