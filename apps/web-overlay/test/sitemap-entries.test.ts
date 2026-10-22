import { describe, expect, it } from 'vitest'
import {
  STATIC_PATHS,
  categoryEntries,
  collectionEntries,
  countCategorySites,
  siteEntries,
  staticEntries,
  tagEntries,
} from '../src/lib/seo/sitemap-entries'
import { MIN_SITES_FOR_TAG_INDEX } from '../src/lib/seo/thresholds'

const base = 'https://navhub.example.com'

describe('staticEntries', () => {
  it('输出绝对 URL，base 末尾斜杠归一，首页优先级最高', () => {
    const entries = staticEntries(base + '/')
    expect(entries).toHaveLength(STATIC_PATHS.length)
    expect(entries[0]!.url).toBe(`${base}/`)
    expect(entries[0]!.priority).toBe(1)
    expect(entries.some((e) => e.url === `${base}/sites`)).toBe(true)
    expect(entries.some((e) => e.url === `${base}/category`)).toBe(true)
  })
})

describe('countCategorySites', () => {
  it('一级与子级指针都计数，同一站点的两个指针只算一次', () => {
    const counts = countCategorySites([
      { id: 'a', categoryId: 'parent', subCategoryId: 'child' },
      { id: 'b', categoryId: 'parent', subCategoryId: 'child' },
      { id: 'c', categoryId: 'parent', subCategoryId: null },
      { id: 'd', categoryId: null, subCategoryId: 'child' },
      { id: 'e', categoryId: '  ', subCategoryId: '' },
    ])
    expect(counts.get('parent')).toBe(3)
    expect(counts.get('child')).toBe(3)
    expect(counts.size).toBe(2)
  })
})

describe('categoryEntries', () => {
  it('只收录 enabled 且达到阈值的分类，URL 用 slug、没有 slug 才退回 id', () => {
    // 分类门槛已按权威树分档（MIN_SITES_FOR_CATEGORY_INDEX = 12）：
    // 达标样本必须 ≥12，薄样本保持 4 以验证淘汰逻辑。
    const counts = countCategorySites([
      ...Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, categoryId: 'ok' })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, categoryId: 'thin' })),
      ...Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, categoryId: 'cat-uncategorized' })),
      ...Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, categoryId: 'a/b c' })),
    ])
    const entries = categoryEntries(base, [
      { id: 'ok', slug: 'ai-tools', updatedAt: 1_700_000_000_000 },
      { id: 'thin' },
      { id: 'disabled', slug: 'disabled', enabled: false },
      { id: 'ok', slug: 'ai-tools' },
      // 同一 slug 挂在不同 id 上（合并中的重复行）也只能出一条
      { id: 'ok-legacy', slug: 'ai-tools' },
      { id: 'a/b c' },
      { id: 'cat-uncategorized', slug: 'uncategorized' },
    ], counts)
    expect(entries.map((e) => e.url)).toEqual([
      `${base}/category/ai-tools`,
      `${base}/category/a%2Fb%20c`,
    ])
    expect(entries[0]!.priority).toBe(0.6)
    // G3：分类 updatedAt 有值必须写 lastModified（此前 5 条分类页全缺）
    expect(new Date(entries[0]!.lastModified!).getTime()).toBe(1_700_000_000_000)
  })

  it('分类没有 updatedAt 时不伪造 lastModified', () => {
    const counts = countCategorySites(
      // 必须达到分类门槛（12），否则条目会被阈值过滤掉，测不到 lastModified 分支
      Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, categoryId: 'ok' })),
    )
    const entries = categoryEntries(base, [{ id: 'ok' }], counts)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.lastModified).toBeUndefined()
  })

  it('计数缺失（中枢失败）时不产出分类条目', () => {
    expect(categoryEntries(base, [{ id: 'ok' }], null)).toHaveLength(0)
  })
})

describe('siteEntries', () => {
  it('去重、跳过空 id、id 做 encode', () => {
    const entries = siteEntries(base, [
      { id: 'alpha', updatedAt: 1_700_000_000_000 },
      { id: 'alpha', updatedAt: 1_700_000_000_000 },
      { id: '  ' },
      { id: '' },
      { id: 'a/b c' },
    ])
    expect(entries.map((e) => e.url)).toEqual([
      `${base}/site/alpha`,
      `${base}/site/a%2Fb%20c`,
    ])
  })

  it('时间戳非法时不写 lastModified，秒级时间戳按毫秒解释', () => {
    const [ok, seconds, bad] = siteEntries(base, [
      { id: 'a', updatedAt: 1_700_000_000_000 },
      { id: 'b', updatedAt: 1_700_000_000 },
      { id: 'c', updatedAt: Number.NaN },
    ])
    // MetadataRoute.Sitemap 的 lastModified 类型是 string | Date，先归一再取值
    expect(new Date(ok!.lastModified!).getTime()).toBe(1_700_000_000_000)
    expect(new Date(seconds!.lastModified!).getTime()).toBe(1_700_000_000 * 1000)
    expect(bad!.lastModified).toBeUndefined()
  })

  it('未来时间戳不写 lastModified（防止脏数据把页面写成刚更新）', () => {
    const [entry] = siteEntries(base, [{ id: 'a', updatedAt: Date.now() + 86400 * 1000 * 2 }])
    expect(entry!.lastModified).toBeUndefined()
  })
})

describe('tagEntries', () => {
  it('按阈值过滤：低于阈值的标签不进 sitemap', () => {
    const entries = tagEntries(base, [
      { slug: '开源', count: 123 },
      { slug: '冷门', count: MIN_SITES_FOR_TAG_INDEX - 1 },
      { slug: '无计数' },
      { slug: '  ' },
      { slug: '开源', count: 123 },
    ])
    expect(entries.map((e) => e.url)).toEqual([`${base}/tags/%E5%BC%80%E6%BA%90`])
  })

  it('阈值可配置（分类页上线后可能调高）', () => {
    const entries = tagEntries(base, [{ slug: 'x', count: 10 }], 20)
    expect(entries).toHaveLength(0)
  })
})

describe('collectionEntries', () => {
  it('跳过未启用与重复 slug', () => {
    const entries = collectionEntries(base, [
      { slug: 'ai-coding', enabled: true },
      { slug: 'draft', enabled: false },
      { slug: 'ai-coding', enabled: true },
    ])
    expect(entries.map((e) => e.url)).toEqual([`${base}/collections/ai-coding`])
  })
})
