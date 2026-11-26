/**
 * 对比分享 sitemap 条目纯函数单测（P13）。
 * 与 test/sitemap-entries.test.ts 的插件条目用例同一体例。
 */
import { describe, expect, it } from 'vitest'
import { compareShareSitemapEntries } from '../src/lib/compare-share-sitemap'

const ORIGIN = 'https://navhub.example.com'

describe('compareShareSitemapEntries', () => {
  it('已发布快照进 sitemap：URL 形如 /pub/compare/<slug>，weekly / 0.6', () => {
    const entries = compareShareSitemapEntries(ORIGIN, [
      { slug: 'abc123', updatedAt: Date.UTC(2026, 10, 20), publishedAt: Date.UTC(2026, 10, 19) },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].url).toBe('https://navhub.example.com/pub/compare/abc123')
    expect(entries[0].changeFrequency).toBe('weekly')
    expect(entries[0].priority).toBe(0.6)
    expect(entries[0].lastModified).toEqual(new Date(Date.UTC(2026, 10, 20)))
  })

  it('同一 slug 只出现一次', () => {
    const entries = compareShareSitemapEntries(ORIGIN, [
      { slug: 'abc123', updatedAt: 1000 },
      { slug: 'abc123', updatedAt: 2000 },
      { slug: 'def456', updatedAt: 1000 },
    ])
    expect(entries.map((e) => e.url)).toEqual([
      'https://navhub.example.com/pub/compare/abc123',
      'https://navhub.example.com/pub/compare/def456',
    ])
  })

  it('空 slug / 超长 slug 跳过，不产无效 URL', () => {
    const entries = compareShareSitemapEntries(ORIGIN, [
      { slug: '   ' },
      { slug: 'x'.repeat(201) },
      { slug: 'ok-slug' },
    ])
    expect(entries.map((e) => e.url)).toEqual(['https://navhub.example.com/pub/compare/ok-slug'])
  })

  it('时间戳优先 updatedAt，缺失回退 publishedAt，均非法不带 lastModified', () => {
    const entries = compareShareSitemapEntries(ORIGIN, [
      { slug: 'a', publishedAt: Date.UTC(2026, 10, 19) },
      { slug: 'b', updatedAt: Number.NaN, publishedAt: -5 },
      { slug: 'c' },
    ])
    expect(entries[0].lastModified).toEqual(new Date(Date.UTC(2026, 10, 19)))
    expect(entries[1]).not.toHaveProperty('lastModified')
    expect(entries[2]).not.toHaveProperty('lastModified')
  })

  it('slug 做 URL 编码，origin 尾斜杠不产生 //', () => {
    const entries = compareShareSitemapEntries(ORIGIN + '/', [{ slug: 'a b/c' }])
    expect(entries[0].url).toBe('https://navhub.example.com/pub/compare/a%20b%2Fc')
  })

  it('空清单返回空数组', () => {
    expect(compareShareSitemapEntries(ORIGIN, [])).toEqual([])
  })
})
