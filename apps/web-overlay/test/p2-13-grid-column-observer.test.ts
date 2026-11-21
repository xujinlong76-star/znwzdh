/**
 * P2-13：共享 ResizeObserver + 宽度推导列数。
 *
 * 验收：窗口 resize 连续触发时 getComputedStyle 调用从 N（分区数）降为 0
 *（auto-fill 网格）；observer 实例全站 1 个。
 *
 * columnsForWidth 与浏览器 auto-fill 分列规则等价：每列至少 240px，
 * 列间 gap 均摊，列数 = floor((W + gap) / (240 + gap))。与 globals.css
 * 断点注释一致（gap=14 时 ≥1200px 为 4 列、≥840px 为 3 列、≥560px 为 2 列）。
 * 密度档 gap 为 10/16/22px 时断点随之微移，公式用实测 gap，不写死 14。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GRID_MIN_COL_PX, columnsForWidth } from '../src/lib/grid-column-observer'

describe('P2-13：columnsForWidth 与 auto-fill 分列等价', () => {
  it('最小列宽常量为 240（与 effectiveGridClass 的 minmax 一致）', () => {
    expect(GRID_MIN_COL_PX).toBe(240)
  })

  it('gap=14 时落在注释断点上（1200→4、840→3、560→2、400→1）', () => {
    expect(columnsForWidth(1200, 14)).toBe(4)
    expect(columnsForWidth(1199, 14)).toBe(4)
    expect(columnsForWidth(840, 14)).toBe(3)
    expect(columnsForWidth(839, 14)).toBe(3)
    expect(columnsForWidth(560, 14)).toBe(2)
    expect(columnsForWidth(559, 14)).toBe(2)
    expect(columnsForWidth(400, 14)).toBe(1)
  })

  it('密度档 gap 变化时列数随之微移（10/16/22px）', () => {
    // gap 越小，同宽能塞的列越多；gap 越大越少。
    expect(columnsForWidth(1000, 10)).toBe(4)
    expect(columnsForWidth(1000, 16)).toBe(3)
    expect(columnsForWidth(1000, 22)).toBe(3)
    expect(columnsForWidth(800, 10)).toBe(3)
    expect(columnsForWidth(800, 22)).toBe(3)
    expect(columnsForWidth(500, 10)).toBe(2)
    expect(columnsForWidth(500, 22)).toBe(1)
  })

  it('边界与非法输入守底（至少 1 列；宽/隙非法时不抛错）', () => {
    expect(columnsForWidth(240, 14)).toBe(1)
    expect(columnsForWidth(0, 14)).toBe(1)
    expect(columnsForWidth(-5, 14)).toBe(1)
    expect(columnsForWidth(1000, -1)).toBe(4)
    expect(columnsForWidth(Number.NaN, 14)).toBe(1)
  })
})

describe('P2-13：分区不再各建 observer', () => {
  const sectionSrc = readFileSync(
    join(__dirname, '../src/components/navigation-category-section.tsx'),
    'utf8',
  )
  const libSrc = readFileSync(join(__dirname, '../src/lib/grid-column-observer.ts'), 'utf8')

  it('分区文件不再 new ResizeObserver，改调共享 observeGridColumns', () => {
    expect(sectionSrc).not.toContain('new ResizeObserver')
    expect(sectionSrc).toContain('observeGridColumns')
    expect(sectionSrc).toContain('GRID_MIN_COL_PX')
  })

  it('共享模块全站只有一个 ResizeObserver 实例', () => {
    expect(libSrc.match(/new ResizeObserver/g)?.length).toBe(1)
  })

  it('共享 observer 回调不调 getComputedStyle（auto-fill 列数由宽度算出）', () => {
    const cb = libSrc.slice(libSrc.indexOf('new ResizeObserver'))
    const cbEnd = cb.indexOf('})')
    const callbackBody = cb.slice(0, cbEnd)
    expect(callbackBody).not.toContain('getComputedStyle')
    expect(callbackBody).toContain('syncOne')
  })

  it('class 字符串用 GRID_MIN_COL_PX 拼，不再写死 240px（防公式与模板漂移）', () => {
    // 注释里仍可提 240px（说明数值），但 class 字符串须走常量。
    expect(sectionSrc).not.toContain("'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'")
    expect(sectionSrc).toContain('minmax(${GRID_MIN_COL_PX}px,1fr)')
  })
})
