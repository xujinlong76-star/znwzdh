import { describe, expect, it } from 'vitest'
import {
  categoryHref,
  categoryUrlKey,
  isCategoryUuidRef,
  isHiddenCategory,
} from '../src/lib/seo/category-url'

/**
 * 类目 URL 的口径（2026-10-22，类目树升级 P1-5）。
 *
 * 这个模块是「站内所有类目链接的唯一出口」：链接产出点、sitemap、首页目录带
 * 都从这里取，所以它的兜底行为直接决定站内会不会出现半死链。
 */

describe('categoryUrlKey', () => {
  it('slug 优先，前后空白归一', () => {
    expect(categoryUrlKey({ id: 'x', slug: ' ai-tools ' })).toBe('ai-tools')
  })

  it('历史行没有 slug 时退回 id（宁可短链一段，不制造 404）', () => {
    expect(categoryUrlKey({ id: 'cat-ai' })).toBe('cat-ai')
    expect(categoryUrlKey({ id: 'cat-ai', slug: null })).toBe('cat-ai')
    expect(categoryUrlKey({ id: 'cat-ai', slug: '   ' })).toBe('cat-ai')
  })
})

describe('categoryHref', () => {
  it('第 1 页是裸路径：?page=1 与裸 URL 是同一个页面，不能两个形态都发出去', () => {
    expect(categoryHref({ id: 'x', slug: 'ai-tools' })).toBe('/category/ai-tools')
    expect(categoryHref('ai-tools', 1)).toBe('/category/ai-tools')
  })

  it('第 2 页起带 ?page=N', () => {
    expect(categoryHref({ id: 'x', slug: 'ai-tools' }, 3)).toBe('/category/ai-tools?page=3')
  })

  it('中文 slug 要百分号编码（slugify 允许保留中文）', () => {
    expect(categoryHref({ id: 'x', slug: 'ai-编程' })).toBe('/category/ai-%E7%BC%96%E7%A8%8B')
  })

  it('传字符串时不再取 slug：调用方已经解析过就不能被覆盖', () => {
    expect(categoryHref({ id: 'x', slug: 'real' }, 1)).toBe('/category/real')
    expect(categoryHref('0f1f2c3d-0000-4000-8000-000000000000')).toBe(
      '/category/0f1f2c3d-0000-4000-8000-000000000000',
    )
  })
})

describe('isCategoryUuidRef', () => {
  it('认标准 uuid（大小写都可以）', () => {
    expect(isCategoryUuidRef('0f1f2c3d-0000-4000-8000-000000000000')).toBe(true)
    expect(isCategoryUuidRef('0F1F2C3D-ABCD-4000-8000-000000000000')).toBe(true)
  })

  it('slug 与种子 id 不是 uuid 形态', () => {
    expect(isCategoryUuidRef('ai-tools')).toBe(false)
    expect(isCategoryUuidRef('cat-ai')).toBe(false)
    expect(isCategoryUuidRef('')).toBe(false)
    // 段数/长度不对的伪 uuid 不能被当成老链接（否则会 301 到不存在的 slug）
    expect(isCategoryUuidRef('0f1f2c3d-0000-4000-8000-00000000000')).toBe(false)
  })
})

describe('isHiddenCategory', () => {
  it('「未分类」按固定 id 或 slug 命中，不依赖标题', () => {
    expect(isHiddenCategory({ id: 'cat-uncategorized', slug: 'uncategorized' })).toBe(true)
    expect(isHiddenCategory({ id: 'cat-uncategorized' })).toBe(true)
    expect(isHiddenCategory({ id: 'x', slug: 'uncategorized' })).toBe(true)
  })

  it('真实类目不受影响', () => {
    expect(isHiddenCategory({ id: 'x', slug: 'ai-tools' })).toBe(false)
  })
})
