import { describe, it, expect } from 'vitest'
import {
  BUILTIN_WIDGET_CATALOG,
  BUILTIN_PRESET_TEMPLATES,
  createWidgetInstanceData,
  reorderWidgetsList,
  shiftWidgetPosition,
  clampWidgetSpan,
  mergeWidgetConfig,
  compactWidgetsGrid,
} from '../src/modular'

describe('模块化页面系统架构与算法测试 (Modular Layout Architecture)', () => {
  it('所有注册的模块必须具备合法的 12 栅格尺寸约束和元数据', () => {
    const modules = Object.values(BUILTIN_WIDGET_CATALOG)
    expect(modules.length).toBeGreaterThanOrEqual(13) // 包含 github-heatmap, weather-clock, iframe-embed

    for (const m of modules) {
      expect(m.type).toBeTruthy()
      expect(m.title).toBeTruthy()
      expect(m.description).toBeTruthy()
      expect(m.defaultColSpan).toBeGreaterThanOrEqual(1)
      expect(m.defaultColSpan).toBeLessThanOrEqual(12)
      expect(m.minColSpan).toBeGreaterThanOrEqual(1)
      expect(m.maxColSpan).toBeLessThanOrEqual(12)
      expect(m.minColSpan).toBeLessThanOrEqual(m.maxColSpan)
      expect(m.defaultRowSpan).toBeGreaterThanOrEqual(1)
      expect(m.minRowSpan).toBeLessThanOrEqual(m.maxRowSpan)

      if (m.configSchema) {
        expect(Array.isArray(m.configSchema)).toBe(true)
        for (const schema of m.configSchema) {
          expect(schema.key).toBeTruthy()
          expect(schema.label).toBeTruthy()
          expect(['select', 'boolean', 'number', 'text']).toContain(schema.type)
        }
      }
    }
  })

  it('createWidgetInstanceData 能够为合法模块类型生成具备唯一标识符的实例', () => {
    const instance = createWidgetInstanceData('quick-tools')
    expect(instance.id).toMatch(/^widget-quick-tools-/)
    expect(instance.type).toBe('quick-tools')
    expect(instance.colSpan).toBe(4)
    expect(instance.rowSpan).toBe(1)
    expect(instance.config).toEqual({})
    expect(instance.createdAt).toBeGreaterThan(0)
  })

  it('createWidgetInstanceData 对不存在的模块类型抛出可预期的异常', () => {
    expect(() => createWidgetInstanceData('non-existent-widget')).toThrowError(/未知模块类型/)
  })

  it('所有预设模版内的子模块类型均必须在模块注册表中合法登记', () => {
    expect(BUILTIN_PRESET_TEMPLATES.length).toBeGreaterThanOrEqual(4)

    for (const tpl of BUILTIN_PRESET_TEMPLATES) {
      expect(tpl.id).toBeTruthy()
      expect(tpl.name).toBeTruthy()
      expect(tpl.widgets.length).toBeGreaterThan(0)

      for (const widget of tpl.widgets) {
        expect(BUILTIN_WIDGET_CATALOG[widget.type]).toBeDefined()
        expect(widget.colSpan).toBeGreaterThanOrEqual(1)
        expect(widget.colSpan).toBeLessThanOrEqual(12)
      }
    }
  })

  it('列表重排算法 (reorderWidgetsList): 能够正确互换两个模块的位置次序且保持总长度不变', () => {
    const list = ['a', 'b', 'c', 'd', 'e']
    const sourceIndex = 1 // 'b'
    const destinationIndex = 3 // 'd'

    const reordered = reorderWidgetsList(list, sourceIndex, destinationIndex)

    expect(reordered).toEqual(['a', 'c', 'd', 'b', 'e'])
    expect(reordered.length).toBe(list.length)

    // 原地重排测试
    expect(reorderWidgetsList(list, 2, 2)).toEqual(list)
  })

  it('移动端方向位移算法 (shiftWidgetPosition): 能够正确上移/下移并防御首尾边界越界', () => {
    const list = ['first', 'second', 'third']

    // 向上移动中间元素
    const movedUp = shiftWidgetPosition(list, 1, 'up')
    expect(movedUp).toEqual(['second', 'first', 'third'])

    // 向下移动中间元素
    const movedDown = shiftWidgetPosition(list, 1, 'down')
    expect(movedDown).toEqual(['first', 'third', 'second'])

    // 首部元素无法再向上移动 (边界保护)
    expect(shiftWidgetPosition(list, 0, 'up')).toEqual(list)

    // 尾部元素无法再向下移动 (边界保护)
    expect(shiftWidgetPosition(list, 2, 'down')).toEqual(list)

    // 越界索引测试
    expect(shiftWidgetPosition(list, 99, 'up')).toEqual(list)
  })

  it('模块尺寸缩放约束算法 (clampWidgetSpan): 超出范围的 colSpan 必须被正确约束在 [min, max]', () => {
    const def = BUILTIN_WIDGET_CATALOG['clock-pomodoro']
    expect(clampWidgetSpan(1, def.minColSpan, def.maxColSpan)).toBe(def.minColSpan) // 3
    expect(clampWidgetSpan(12, def.minColSpan, def.maxColSpan)).toBe(def.maxColSpan) // 6
    expect(clampWidgetSpan(4, def.minColSpan, def.maxColSpan)).toBe(4)
  })

  it('配置合并算法 (mergeWidgetConfig): 能够正确安全合并补丁配置并保留未修改字段', () => {
    const initial = { theme: 'dark', limit: 5, enabled: true }
    const patch = { limit: 10, newOption: 'abc' }

    const merged = mergeWidgetConfig(initial, patch)

    expect(merged).toEqual({
      theme: 'dark',
      limit: 10,
      enabled: true,
      newOption: 'abc',
    })
    // 确保纯函数不破坏原对象
    expect(initial.limit).toBe(5)
  })

  it('智能紧凑网格排版算法 (compactWidgetsGrid): 能够紧凑打包 12 栅格行，消除空间碎片', () => {
    const widgets = [
      { id: 'w1', colSpan: 3 },
      { id: 'w2', colSpan: 6 },
      { id: 'w3', colSpan: 9 },
      { id: 'w4', colSpan: 3 },
    ]

    const compacted = compactWidgetsGrid(widgets)

    // 总数保持不变
    expect(compacted.length).toBe(widgets.length)
    // 第 1 行贪心塞入 3 + 6 + 3 = 12 满栅格
    expect(compacted[0].id).toBe('w1')
    expect(compacted[1].id).toBe('w2')
    expect(compacted[2].id).toBe('w4')
    // 第 2 行排入剩余的 9 栅格模块
    expect(compacted[3].id).toBe('w3')
  })
})

