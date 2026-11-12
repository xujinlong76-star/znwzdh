/**
 * DRAG-2：网格布局模型（grid-layout.ts）单测——纯函数，node 环境可跑。
 * 覆盖：分类顺序 ↔ 网格坐标往返、迁移（含脏输入回退默认）、
 * 小组件流式排布与写回、移动步数规划。
 */
import { describe, expect, it } from 'vitest'
import {
  applyGridLayoutToWidgets,
  colsForWidth,
  defaultGridLayout,
  gridToCategoryOrder,
  migrateConfigToGrid,
  normalizeGridLayout,
  planOrderMoves,
  reorderGridItems,
  widgetsToGrid,
} from '../src/lib/modular/grid-layout'

describe('响应式列数：colsForWidth', () => {
  it('桌面容器 ≥1024px 仍是 12 列（与旧行为一致）', () => {
    expect(colsForWidth(1200)).toBe(12)
    expect(colsForWidth(1024)).toBe(12)
    expect(colsForWidth(2000)).toBe(12)
  })

  it('窄屏逐档收窄：768→8、480→4、390 手机→2', () => {
    expect(colsForWidth(1023)).toBe(8)
    expect(colsForWidth(768)).toBe(8)
    expect(colsForWidth(767)).toBe(4)
    expect(colsForWidth(480)).toBe(4)
    expect(colsForWidth(479)).toBe(2)
    expect(colsForWidth(390)).toBe(2)
    expect(colsForWidth(360)).toBe(2)
  })

  it('非法宽度不抛错，按最窄 2 列', () => {
    expect(colsForWidth(NaN)).toBe(2)
    expect(colsForWidth(-10)).toBe(2)
    expect(colsForWidth(0)).toBe(2)
  })
})

describe('分类顺序 ↔ 网格坐标', () => {
  it('往返一致：顺序 → 网格 → 顺序', () => {
    const order = ['cat-a', 'cat-b', 'cat-c']
    const grid = defaultGridLayout(order)
    expect(grid).toEqual([
      { i: 'cat-a', x: 0, y: 0, w: 12, h: 1 },
      { i: 'cat-b', x: 0, y: 1, w: 12, h: 1 },
      { i: 'cat-c', x: 0, y: 2, w: 12, h: 1 },
    ])
    expect(gridToCategoryOrder(grid)).toEqual(order)
  })

  it('gridToCategoryOrder 按行列排序，缺失项补到末尾', () => {
    const grid = [
      { i: 'b', x: 0, y: 1, w: 12, h: 1 },
      { i: 'a', x: 0, y: 0, w: 12, h: 1 },
    ]
    expect(gridToCategoryOrder(grid, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('reorderGridItems 移动一项后重新编行号', () => {
    const grid = defaultGridLayout(['a', 'b', 'c', 'd'])
    const next = reorderGridItems(grid, 'a', 2)
    expect(next.map((g) => g.i)).toEqual(['b', 'c', 'a', 'd'])
    expect(next.map((g) => g.y)).toEqual([0, 1, 2, 3])
    expect(gridToCategoryOrder(next)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('reorderGridItems 对未知 id / 越界序号是空操作', () => {
    const grid = defaultGridLayout(['a', 'b'])
    expect(reorderGridItems(grid, 'zzz', 0)).toEqual(grid)
    expect(reorderGridItems(grid, 'a', 99).map((g) => g.i)).toEqual(['b', 'a'])
  })
})

describe('迁移：migrateConfigToGrid', () => {
  const ALL = ['a', 'b', 'c']

  it('完整顺序原样通过，不记 note', () => {
    const res = migrateConfigToGrid({ categoryOrder: ['b', 'a', 'c'] }, ALL)
    expect(res.migrated).toBe(false)
    expect(res.notes).toEqual([])
    expect(gridToCategoryOrder(res.layout)).toEqual(['b', 'a', 'c'])
  })

  it('空顺序 → 默认布局（当前分类顺序）', () => {
    const res = migrateConfigToGrid({ categoryOrder: [] }, ALL)
    expect(res.migrated).toBe(true)
    expect(gridToCategoryOrder(res.layout)).toEqual(ALL)
  })

  it('缺分类补到末尾，未知分类丢弃并记 note', () => {
    const res = migrateConfigToGrid({ categoryOrder: ['c', 'ghost'] }, ALL)
    expect(gridToCategoryOrder(res.layout)).toEqual(['c', 'a', 'b'])
    expect(res.notes.join('')).toContain('ghost')
    expect(res.notes.join('')).toContain('补到末尾')
  })

  it('重复 id 只保留第一次', () => {
    const res = migrateConfigToGrid({ categoryOrder: ['a', 'a', 'b'] }, ALL)
    expect(gridToCategoryOrder(res.layout)).toEqual(['a', 'b', 'c'])
    expect(res.notes.join('')).toContain('重复')
  })

  it('脏输入一律回退默认布局，绝不抛错', () => {
    for (const bad of [null, undefined, 42, 'x', [], { categoryOrder: 'not-an-array' }, { categoryOrder: [null, 1, {}] }]) {
      const res = migrateConfigToGrid(bad, ALL)
      expect(gridToCategoryOrder(res.layout)).toEqual(ALL)
      expect(res.migrated).toBe(true)
    }
  })
})

describe('normalizeGridLayout', () => {
  it('重叠项向下推，非法项丢弃', () => {
    const { layout, notes } = normalizeGridLayout(
      [
        { i: 'a', x: 0, y: 0, w: 12, h: 1 },
        { i: 'a', x: 0, y: 0, w: 12, h: 1 },
        { i: 'b', x: 0, y: 0, w: 12, h: 1 },
        { i: 'c', x: 0, y: 99, w: 99, h: 0 },
        { i: '', x: 0, y: 0, w: 1, h: 1 },
      ],
      ['a', 'b', 'c'],
    )
    expect(layout.map((g) => g.i)).toEqual(['a', 'b', 'c'])
    expect(layout[1]?.y).toBe(1)
    expect(layout[2]?.w).toBe(12)
    expect(notes.length).toBeGreaterThan(0)
  })

  it('非数组输入回退默认布局', () => {
    const { layout } = normalizeGridLayout('nope', ['a'])
    expect(layout).toEqual(defaultGridLayout(['a']))
  })
})

describe('小组件网格', () => {
  const widgets = [
    { id: 'w1', colSpan: 6, rowSpan: 1 },
    { id: 'w2', colSpan: 6, rowSpan: 1 },
    { id: 'w3', colSpan: 6, rowSpan: 2 },
    { id: 'w4', colSpan: 12, rowSpan: 1 },
  ]

  it('流式排布：同行放满即换行', () => {
    const grid = widgetsToGrid(widgets)
    expect(grid).toEqual([
      { i: 'w1', x: 0, y: 0, w: 6, h: 1 },
      { i: 'w2', x: 6, y: 0, w: 6, h: 1 },
      { i: 'w3', x: 0, y: 1, w: 6, h: 2 },
      { i: 'w4', x: 0, y: 3, w: 12, h: 1 },
    ])
  })

  it('写回：按 (y, x) 排回顺序', () => {
    const grid = widgetsToGrid(widgets)
    // w1 与 w2 对调位置（不重叠的有效布局）
    const swapped = grid.map((g) =>
      g.i === 'w1' ? { ...g, x: 6, y: 0 } : g.i === 'w2' ? { ...g, x: 0, y: 0 } : g,
    )
    const next = applyGridLayoutToWidgets(widgets, swapped)
    expect(next.map((w) => w.id)).toEqual(['w2', 'w1', 'w3', 'w4'])
  })

  it('写回：尺寸写回 colSpan/rowSpan，顺序不变', () => {
    const grid = widgetsToGrid(widgets)
    const resized = grid.map((g) => (g.i === 'w3' ? { ...g, w: 4, h: 3 } : g))
    const next = applyGridLayoutToWidgets(widgets, resized)
    expect(next.map((w) => w.id)).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(next.find((w) => w.id === 'w3')).toEqual({ id: 'w3', colSpan: 4, rowSpan: 3 })
  })

  it('写回：布局里没有的 widget 补到末尾，未知 id 丢弃', () => {
    const next = applyGridLayoutToWidgets(widgets, [
      { i: 'w2', x: 0, y: 0, w: 6, h: 1 },
      { i: 'ghost', x: 0, y: 1, w: 6, h: 1 },
    ])
    expect(next.map((w) => w.id)).toEqual(['w2', 'w1', 'w3', 'w4'])
  })

  it('尺寸钳制：超宽/超高收进 1..12 / 1..6', () => {
    const grid = widgetsToGrid([{ id: 'x', colSpan: 99, rowSpan: 99 }])
    expect(grid[0]).toMatchObject({ w: 12, h: 6 })
  })

  it('窄屏 2 列：colSpan:3 的组件钳到 2 列、每行只放一个', () => {
    // 390px 手机旧行为：12 列里 colSpan:3 只有约 90px 宽；
    // 2 列时它占满整行宽（约 170px+），能看能点
    const grid = widgetsToGrid(
      [
        { id: 'w1', colSpan: 3, rowSpan: 1 },
        { id: 'w2', colSpan: 3, rowSpan: 1 },
        { id: 'w3', colSpan: 12, rowSpan: 1 },
      ],
      2,
    )
    expect(grid).toEqual([
      { i: 'w1', x: 0, y: 0, w: 2, h: 1 },
      { i: 'w2', x: 0, y: 1, w: 2, h: 1 },
      { i: 'w3', x: 0, y: 2, w: 2, h: 1 },
    ])
  })

  it('8 列：两个 colSpan:6 并排、colSpan:12 钳到 8', () => {
    const grid = widgetsToGrid(
      [
        { id: 'w1', colSpan: 6, rowSpan: 1 },
        { id: 'w2', colSpan: 6, rowSpan: 1 },
        { id: 'w3', colSpan: 12, rowSpan: 1 },
      ],
      8,
    )
    expect(grid).toEqual([
      { i: 'w1', x: 0, y: 0, w: 6, h: 1 },
      { i: 'w2', x: 0, y: 1, w: 6, h: 1 },
      { i: 'w3', x: 0, y: 2, w: 8, h: 1 },
    ])
  })

  it('桌面 12 列与原来完全一致（默认参数不传 cols）', () => {
    expect(widgetsToGrid(widgets)).toEqual([
      { i: 'w1', x: 0, y: 0, w: 6, h: 1 },
      { i: 'w2', x: 6, y: 0, w: 6, h: 1 },
      { i: 'w3', x: 0, y: 1, w: 6, h: 2 },
      { i: 'w4', x: 0, y: 3, w: 12, h: 1 },
    ])
  })

  it('写回按传入的 cols 钳制（窄屏布局的 w 不会超过 cols）', () => {
    const next = applyGridLayoutToWidgets(widgets, [{ i: 'w1', x: 0, y: 0, w: 9, h: 1 }], 2)
    expect(next.find((w) => w.id === 'w1')).toEqual({ id: 'w1', colSpan: 2, rowSpan: 1 })
  })
})

describe('planOrderMoves', () => {
  it('只动一项时恰好一步', () => {
    expect(planOrderMoves(['a', 'b', 'c', 'd'], ['b', 'c', 'a', 'd'])).toEqual([[0, 2]])
  })

  it('顺序相同是零步', () => {
    expect(planOrderMoves(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('逆序也能拆出来，且按步执行能到达目标', () => {
    const from = ['a', 'b', 'c', 'd']
    const to = ['d', 'c', 'b', 'a']
    const moves = planOrderMoves(from, to)
    const current = [...from]
    for (const [f, t] of moves) {
      const [moved] = current.splice(f, 1)
      if (moved !== undefined) current.splice(t, 0, moved)
    }
    expect(current).toEqual(to)
    expect(moves.length).toBeLessThanOrEqual(3)
  })
})
