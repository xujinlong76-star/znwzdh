/**
 * 快捷指令（原「一句话排版」）关键词匹配口径。
 *
 * 匹配逻辑是纯函数 parseDiyShortcut（diy-presets.ts），工具栏只剩接线；
 * 这里把占位符与提示文案承诺的每一个关键词都钉住：承诺了就必须识别，
 * 没列出来的词不许假装能懂；一个意图都没命中时 feedback 必须为空，
 * 调用方据此如实说没听懂，不许弹假成功。
 */
import { describe, expect, it } from 'vitest'
import { parseDiyShortcut } from '../src/lib/modular/diy-presets'

const CATS = ['frontend', 'backend', 'ai-lab', 'design', 'life']
const TITLES: Record<string, string> = {
  frontend: '前端开发',
  backend: '后端服务',
  'ai-lab': 'AI 实验室',
  design: '设计创意',
  life: '生活日常',
}

function run(input: string) {
  return parseDiyShortcut(input, { allCategoryIds: CATS, categoryTitleMap: TITLES })
}

describe('密度关键词', () => {
  it.each([
    ['3列', 'spacious'],
    ['宽松', 'spacious'],
    ['4列', 'comfortable'],
    ['标准', 'comfortable'],
    ['5列', 'dense'],
    ['6列', 'dense'],
    ['高密', 'dense'],
    ['紧凑', 'dense'],
  ] as const)('「%s」→ %s', (input, density) => {
    expect(run(input).density).toBe(density)
  })
})

describe('卡片形态关键词', () => {
  it.each([
    ['胶囊', 'minimal'],
    ['mini', 'minimal'],
    ['紧凑', 'compact'],
    ['标准', 'standard'],
    ['丰富', 'rich'],
    ['深度', 'rich'],
  ] as const)('「%s」→ %s', (input, mode) => {
    expect(run(input).cardDisplayMode).toBe(mode)
  })
})

describe('画布背景关键词', () => {
  it.each([
    ['极简', 'clean'],
    ['clean', 'clean'],
    ['网格', 'grid'],
    ['grid', 'grid'],
    ['极光', 'aurora'],
    ['aurora', 'aurora'],
  ] as const)('「%s」→ %s', (input, bg) => {
    expect(run(input).canvasBackground).toBe(bg)
  })
})

describe('类目聚焦关键词', () => {
  it('「只看AI与前端」同时命中两组，只留匹配任一模式的类目', () => {
    const m = run('只看AI与前端')
    expect(m.hiddenCategoryIds).toEqual(['life'])
    expect(m.feedback).toContain('聚焦技术+AI类目')
  })

  it('只说前端：只聚焦技术类目', () => {
    const m = run('只看前端')
    expect(m.feedback).toContain('聚焦技术类目')
    expect(m.hiddenCategoryIds).toEqual(['design', 'life'])
  })

  it('只说 AI：只聚焦 AI 类目', () => {
    const m = run('只看AI')
    expect(m.feedback).toContain('聚焦AI类目')
    expect(m.hiddenCategoryIds).toEqual(['frontend', 'backend', 'life'])
  })

  it('「创作」也算 AI 意图', () => {
    expect(run('只看创作').feedback).toContain('聚焦AI类目')
  })
})

describe('组合与兜底', () => {
  it('占位符里的例子都能命中：「5列紧凑胶囊、极光背景、只看AI与前端」', () => {
    const m = run('5列紧凑胶囊、极光背景、只看AI与前端')
    expect(m.density).toBe('dense')
    expect(m.cardDisplayMode).toBe('minimal')
    expect(m.canvasBackground).toBe('aurora')
    expect(m.hiddenCategoryIds).toEqual(['life'])
    expect(m.feedback).toEqual(['紧凑高密', '极速胶囊', '极光流光', '聚焦技术+AI类目'])
  })

  it('没一个词命中：feedback 为空，调用方必须如实说没听懂', () => {
    const m = run('今天天气怎么样')
    expect(m.feedback).toEqual([])
    expect(m.density).toBeUndefined()
    expect(m.cardDisplayMode).toBeUndefined()
    expect(m.canvasBackground).toBeUndefined()
    expect(m.hiddenCategoryIds).toBeUndefined()
  })

  it('「只看AI与前端」这个旧承诺现在真的能同时聚焦两组（不是 else-if 只取其一）', () => {
    const m = run('只看AI与前端')
    // 两组模式取并集：前端/后端/AI 实验室/设计创意都留，只藏生活日常
    expect(m.hiddenCategoryIds).not.toContain('design')
    expect(m.hiddenCategoryIds).not.toContain('ai-lab')
    expect(m.hiddenCategoryIds).toEqual(['life'])
  })
})
