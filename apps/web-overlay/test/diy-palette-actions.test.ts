/**
 * 8c：⌘K 面板 DIY 操作匹配 —— 只测纯匹配函数。
 * 执行（toggleEditingLayout / applyDIYPreset / 分享复制 / 导入 / 重置）
 * 复用 useHomeDIY 与备份对话框的现有函数，不在这里重复测。
 */
import { describe, expect, it } from 'vitest'
import { matchDiyPaletteActions } from '@/lib/modular/diy-palette-actions'

const PRESETS = [
  { id: 'geek-terminal', name: '极客高密终端', description: '高密' },
  { id: 'balanced-hub', name: '均衡枢纽', description: '均衡' },
  { id: 'visual-gallery', name: '视觉画廊', description: '视觉' },
  { id: 'zen-focus', name: '禅定专注', description: '专注' },
]

describe('matchDiyPaletteActions', () => {
  it('空查询与单字查询不匹配（空面板直接展示全部操作，不走匹配）', () => {
    expect(matchDiyPaletteActions('', PRESETS)).toEqual([])
    expect(matchDiyPaletteActions('   ', PRESETS)).toEqual([])
    expect(matchDiyPaletteActions('e', PRESETS)).toEqual([])
  })

  it('通用词 diy / 布局 / 排版命中全部操作，预设展开为每预设一行', () => {
    const items = matchDiyPaletteActions('布局', PRESETS)
    const actionIds = items.map((i) => i.actionId)
    expect(actionIds).toContain('edit')
    expect(actionIds).toContain('share')
    expect(actionIds).toContain('import')
    expect(actionIds).toContain('reset')
    expect(items.filter((i) => i.actionId === 'preset')).toHaveLength(4)
    expect(items.filter((i) => i.actionId === 'preset').map((i) => i.presetId)).toEqual([
      'geek-terminal',
      'balanced-hub',
      'visual-gallery',
      'zen-focus',
    ])
  })

  it('「预设」只展开预设行', () => {
    const items = matchDiyPaletteActions('预设', PRESETS)
    expect(items).toHaveLength(4)
    expect(items.every((i) => i.actionId === 'preset')).toBe(true)
    expect(items[0]!.title).toContain('极客高密终端')
  })

  it('「分享」只命中分享一行；「reset」只命中重置一行', () => {
    expect(matchDiyPaletteActions('分享', PRESETS).map((i) => i.actionId)).toEqual(['share'])
    expect(matchDiyPaletteActions('reset', PRESETS).map((i) => i.actionId)).toEqual(['reset'])
    expect(matchDiyPaletteActions('导入', PRESETS).map((i) => i.actionId)).toEqual(['import'])
  })

  it('编辑操作带真实快捷键提示 Ctrl/⌘+E；其余操作没有编造的快捷键', () => {
    const items = matchDiyPaletteActions('编辑', PRESETS)
    expect(items).toHaveLength(1)
    expect(items[0]!.actionId).toBe('edit')
    expect(items[0]!.hint).toBe('Ctrl/⌘+E')
    const share = matchDiyPaletteActions('分享', PRESETS)
    expect(share[0]!.hint).toBeUndefined()
  })

  it('已在编辑态时 edit 行说「退出排版编辑模式」，而不是「进入…"', () => {
    const items = matchDiyPaletteActions('编辑', PRESETS, { isEditingLayout: true })
    expect(items).toHaveLength(1)
    expect(items[0]!.actionId).toBe('edit')
    expect(items[0]!.title).toBe('退出排版编辑模式')
    expect(items[0]!.hint).toBe('Ctrl/⌘+E')
    // 默认（不传 opts）仍是进入
    expect(matchDiyPaletteActions('编辑', PRESETS)[0]!.title).toBe('进入排版编辑模式')
  })

  it('无关查询不命中', () => {
    expect(matchDiyPaletteActions('github', PRESETS)).toEqual([])
    expect(matchDiyPaletteActions('天气预报', PRESETS)).toEqual([])
  })
})
