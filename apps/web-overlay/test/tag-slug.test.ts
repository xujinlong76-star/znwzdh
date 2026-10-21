/**
 * `tagSlug` 的契约用例：与 packages/store/src/repository/dialect.ts 的
 * `slugify` 同构是硬要求——两侧漂移等于全站标签 URL 分叉（sitemap、
 * 标签云、卡片三处 URL 形态不一致，canonical 白做）。
 *
 * 关键行为（全部来自 store 侧实现，逐条钉住）：
 *   1. 中文必须保留（最初的实现把非 [a-z0-9] 全删了，「天气」slug 成空串，
 *      中文标签永远无法被过滤命中——这是 store 注释里记下的硬伤）；
 *   2. 小写化 + 空白转连字符（"AI 编程" → "ai-编程"）；
 *   3. 其余符号剥掉（"Node.js" → "nodejs"，"C++" → "c"）；
 *   4. 空结果兜底 "tag"（避免空 slug 让多个标签互相覆盖）。
 */
import { describe, expect, it } from 'vitest'

import { tagSlug } from '../src/lib/seo/tag-slug'

describe('tagSlug：与 store slugify 同构', () => {
  it('中文原样保留（导航站主体是中文标签）', () => {
    expect(tagSlug('开源')).toBe('开源')
    expect(tagSlug('天气')).toBe('天气')
    expect(tagSlug('前端开发')).toBe('前端开发')
  })

  it('小写化 + 空白转连字符', () => {
    expect(tagSlug('AI 编程')).toBe('ai-编程')
    expect(tagSlug('  Design   Tools  ')).toBe('design-tools')
    expect(tagSlug('GitHub')).toBe('github')
  })

  it('其余符号剥掉（点号、加号、斜杠、冒号）', () => {
    expect(tagSlug('Node.js')).toBe('nodejs')
    expect(tagSlug('C++')).toBe('c')
    expect(tagSlug('a/b:c')).toBe('abc')
    expect(tagSlug('AI, 工具!')).toBe('ai-工具')
  })

  it('空结果兜底 "tag"，绝不返回空串', () => {
    expect(tagSlug('')).toBe('tag')
    expect(tagSlug('   ')).toBe('tag')
    expect(tagSlug('!!!')).toBe('tag')
    expect(tagSlug('。。。')).toBe('tag')
  })

  it('混合中英与数字保持可读', () => {
    expect(tagSlug('Web3 工具')).toBe('web3-工具')
    expect(tagSlug('VS Code')).toBe('vs-code')
  })

  it('产出可直接 encodeURIComponent 进 URL（消费方约定）', () => {
    // 卡片 / sitemap / 标签云都走 encodeURIComponent(slug)；
    // 这里钉住「编码后不含会破坏路径的字符」
    const encoded = encodeURIComponent(tagSlug('AI 编程/进阶'))
    expect(encoded).toBe('ai-%E7%BC%96%E7%A8%8B%E8%BF%9B%E9%98%B6')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain(' ')
  })
})
