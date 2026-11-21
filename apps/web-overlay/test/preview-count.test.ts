import { describe, expect, it } from 'vitest'
import { PREVIEW_ROWS, previewCountForColumns } from '../src/lib/preview-count'

/**
 * 折叠态预览张数（2026-11-21 要求 1）。
 *
 * 验收口径：任何列数下 previewCount 都必须是该列数的**整倍数**，
 * 否则折叠态会出现「孤儿行」（旧行为 4 列 6 张 = 4+2，右端留豁口）。
 */
describe('previewCountForColumns', () => {
  it('默认两行：等于列数 × PREVIEW_ROWS', () => {
    expect(PREVIEW_ROWS).toBe(2)
    expect(previewCountForColumns(1)).toBe(2)
    expect(previewCountForColumns(2)).toBe(4)
    expect(previewCountForColumns(3)).toBe(6)
    expect(previewCountForColumns(4)).toBe(8)
    expect(previewCountForColumns(5)).toBe(10)
  })

  it('任何列数下都是整行（无孤儿行）', () => {
    for (let cols = 1; cols <= 8; cols++) {
      const n = previewCountForColumns(cols)
      expect(n % cols, `cols=${cols} → ${n} 张出现孤儿行`).toBe(0)
    }
  })

  it('与旧固定值 6 的差异点：4 列不再产生 4+2', () => {
    expect(6 % 4).not.toBe(0) // 旧行为确实是孤儿行
    expect(previewCountForColumns(4) % 4).toBe(0) // 新行为整行
  })

  it('支持自定义行数', () => {
    expect(previewCountForColumns(3, 1)).toBe(3)
    expect(previewCountForColumns(4, 3)).toBe(12)
  })

  it('脏列数（0 / 负数 / NaN / Infinity）回退到 1，不会把分组清空', () => {
    expect(previewCountForColumns(0)).toBe(1)
    expect(previewCountForColumns(-3)).toBe(1)
    expect(previewCountForColumns(Number.NaN)).toBe(1)
    expect(previewCountForColumns(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('脏行数回退到 1 行', () => {
    expect(previewCountForColumns(3, 0)).toBe(3)
    expect(previewCountForColumns(3, Number.NaN)).toBe(3)
  })
})
