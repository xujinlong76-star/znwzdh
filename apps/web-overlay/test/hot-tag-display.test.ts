import { describe, expect, it } from 'vitest'
import { canonicalizeTag, filterDisplayTags, normalizeTag } from '../src/lib/tag-hygiene'

/**
 * 榜单/首页卡片标签展示规范化（2026-11-21）。
 *
 * /hot 站点卡此前直接渲染 site.tags 原始值，绕过全站统一的 tag-hygiene 管道，
 * 于是 # ai-编程 / # 对话ai / # ai赋能 / # google 这类分类 slug 复读、
 * 同义分裂与大小写失范标签直接漏到界面。本测试锁住展示口径。
 */
describe('canonicalizeTag 大小写规范', () => {
  it.each([
    ['google', 'Google'],
    ['mdn', 'MDN'],
    ['nodejs', 'Node.js'],
    ['github', 'GitHub'],
    ['javascript', 'JavaScript'],
    ['typescript', 'TypeScript'],
    ['react', 'React'],
    ['figma', 'Figma'],
    ['openai', 'OpenAI'],
    ['css', 'CSS'],
    ['sql', 'SQL'],
    ['rag', 'RAG'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalizeTag(input)).toBe(expected)
  })
})

describe('filterDisplayTags 清洗连字符分类 slug', () => {
  const catIndex = new Set(['ai', 'ai工具', '对话ai'].map(normalizeTag))

  it('剥离连字符分类 slug（ai-编程 / 组件与-ui-体系）', () => {
    const out = filterDisplayTags(['ai-编程', '组件与-ui-体系', '开源'], catIndex, { maxTags: 2 })
    expect(out).not.toContain('ai-编程')
    expect(out).not.toContain('组件与-ui-体系')
  })

  it('剥掉与分类名重复的标签（对话ai / ai赋能 若被判定为分类复读）', () => {
    const out = filterDisplayTags(['对话ai', '开源', 'Rust'], catIndex, { maxTags: 2 })
    expect(out.length).toBeLessThanOrEqual(2)
    expect(out.every((t) => !t.includes('-'))).toBe(true)
  })

  it('最多返回 maxTags 个（卡片只展示 2 个）', () => {
    const out = filterDisplayTags(['开源', 'Rust', 'CLI', '本地优先', 'WASM'], new Set(), { maxTags: 2 })
    expect(out).toHaveLength(2)
  })

  it('空标签不产生空项', () => {
    expect(filterDisplayTags(['', '  ', null as never], new Set())).toEqual([])
  })
})
