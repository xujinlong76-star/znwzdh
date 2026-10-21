import { describe, expect, it } from 'vitest'
import {
  STATIC_PATHS,
  collectionEntries,
  siteEntries,
  staticEntries,
  tagEntries,
} from '../src/lib/seo/sitemap-entries'
import { MIN_SITES_FOR_INDEX } from '../src/lib/seo/thresholds'

const base = 'https://navhub.example.com'

describe('staticEntries', () => {
  it('输出绝对 URL，base 末尾斜杠归一，首页优先级最高', () => {
    const entries = staticEntries(base + '/')
    expect(entries).toHaveLength(STATIC_PATHS.length)
    expect(entries[0]!.url).toBe(`${base}/`)
    expect(entries[0]!.priority).toBe(1)
    expect(entries.some((e) => e.url === `${base}/sites`)).toBe(true)
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
      { slug: '冷门', count: MIN_SITES_FOR_INDEX - 1 },
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
