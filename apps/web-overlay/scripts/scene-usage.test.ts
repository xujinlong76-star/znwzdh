/**
 * AI 找站场景包的客户端逻辑测试：换一批分页轮换 + 按使用习惯排序。
 *
 * 锁定三条体验纪律：
 *  1. 「换一批」整页步进，相邻两页不重叠，连点能轮完一圈回到起点；
 *  2. 常用的场景排前面，同次数保持默认精选顺序，排序不改原数组；
 *  3. localStorage 里的坏数据/写入失败都退化为默认顺序，绝不抛错崩页。
 */
import { describe, expect, it } from 'vitest'
import {
  SCENE_PAGE_SIZE,
  SCENE_USAGE_STORAGE_KEY,
  loadSceneUsage,
  nextSceneOffset,
  orderScenesByUsage,
  parseSceneUsage,
  recordSceneUse,
  scenePage,
} from '../src/lib/scene-usage'

const SCENES = Array.from({ length: 18 }, (_, i) => ({ id: `scene-${i}` }))

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

describe('换一批：分页轮换', () => {
  it('偏移整页步进并循环：0→6→12→0', () => {
    expect(nextSceneOffset(0, 18)).toBe(6)
    expect(nextSceneOffset(6, 18)).toBe(12)
    expect(nextSceneOffset(12, 18)).toBe(0)
  })

  it('相邻两页完全不重叠，三页正好轮完一圈', () => {
    const pages = [0, 6, 12].map((offset) => scenePage(SCENES, offset).map((s) => s.id))
    const flat = pages.flat()
    expect(new Set(flat).size).toBe(18)
    for (const page of pages) expect(page.length).toBe(SCENE_PAGE_SIZE)
  })

  it('总数不超过一页时不轮换、整表返回', () => {
    const few = SCENES.slice(0, 4)
    expect(nextSceneOffset(0, few.length)).toBe(0)
    expect(scenePage(few, 0).map((s) => s.id)).toEqual(few.map((s) => s.id))
  })

  it('偏移越界自动环绕取模，不会取空', () => {
    expect(scenePage(SCENES, 99).length).toBe(SCENE_PAGE_SIZE)
    expect(scenePage([], 0)).toEqual([])
  })
})

describe('按使用习惯排序', () => {
  it('点得多的排前面，同次数保持默认顺序', () => {
    const ordered = orderScenesByUsage(SCENES, { 'scene-5': 3, 'scene-2': 3, 'scene-9': 1 })
    expect(ordered.slice(0, 3).map((s) => s.id)).toEqual(['scene-2', 'scene-5', 'scene-9'])
    expect(ordered[3]?.id).toBe('scene-0')
  })

  it('冷启动（无记录）就是默认精选顺序，且不修改原数组', () => {
    const before = SCENES.map((s) => s.id)
    const ordered = orderScenesByUsage(SCENES, {})
    expect(ordered.map((s) => s.id)).toEqual(before)
    expect(SCENES.map((s) => s.id)).toEqual(before)
  })

  it('计数表里不存在的 id 被忽略，不产生幽灵场景', () => {
    const ordered = orderScenesByUsage(SCENES, { ghost: 99 })
    expect(ordered.length).toBe(18)
    expect(ordered[0]?.id).toBe('scene-0')
  })
})

describe('本地计数存取', () => {
  it('recordSceneUse 累加并落盘，loadSceneUsage 能读回', () => {
    const storage = fakeStorage()
    recordSceneUse('make-ppt', storage)
    const usage = recordSceneUse('make-ppt', storage)
    recordSceneUse('travel-plan', storage)
    expect(usage['make-ppt']).toBe(2)
    expect(loadSceneUsage(storage)).toEqual({ 'make-ppt': 2, 'travel-plan': 1 })
    expect(storage.getItem(SCENE_USAGE_STORAGE_KEY)).toContain('make-ppt')
  })

  it('坏数据一律当作无记录', () => {
    expect(parseSceneUsage(null)).toEqual({})
    expect(parseSceneUsage('{oops')).toEqual({})
    expect(parseSceneUsage('[1,2]')).toEqual({})
    expect(parseSceneUsage('{"a":"x","b":2,"c":-1,"d":1.9}')).toEqual({ b: 2, d: 1 })
  })

  it('无 storage（服务端/隐私模式）时读写都不抛错', () => {
    expect(loadSceneUsage(null)).toEqual({})
    expect(recordSceneUse('make-ppt', null)).toEqual({ 'make-ppt': 1 })
  })
})
