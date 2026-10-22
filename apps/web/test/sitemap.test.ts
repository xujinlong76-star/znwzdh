import { describe, expect, it } from 'vitest'
import { authorSitemapEntries, pluginSitemapEntries } from '../src/lib/plugins/sitemap'

describe('pluginSitemapEntries', () => {
  const base = 'https://navhub.example.com'

  it('生成绝对 URL：去重、跳过空与超长 slug，base 末尾斜杠归一', () => {
    const entries = pluginSitemapEntries(base + '/', [
      { slug: 'alpha', updatedAt: 1_700_000_000_000 },
      { slug: 'alpha' },
      { slug: '  ' },
      { slug: '' },
      { slug: 'x'.repeat(201) },
      { slug: 'a/b c' },
    ])

    expect(entries.map((entry) => entry.url)).toEqual([
      `${base}/marketplace/alpha`,
      `${base}/marketplace/a%2Fb%20c`,
    ])
    expect(entries[0]!.changeFrequency).toBe('weekly')
    expect(entries[0]!.priority).toBe(0.7)
    expect(entries[0]!.lastModified?.getTime()).toBe(1_700_000_000_000)
  })

  it('时间戳非法时不产生 lastModified，updatedAt 缺失回退 publishedAt', () => {
    const [withPublished, invalid] = pluginSitemapEntries(base, [
      { slug: 'fallback', updatedAt: null, publishedAt: 1_700_000_000_000 },
      { slug: 'bad-time', updatedAt: Number.NaN, publishedAt: -1 },
    ])

    expect(withPublished!.lastModified?.getTime()).toBe(1_700_000_000_000)
    expect(invalid!.lastModified).toBeUndefined()
  })

  it('结果保持输入顺序（分页拼接后顺序稳定）', () => {
    const entries = pluginSitemapEntries(base, [{ slug: 'b' }, { slug: 'a' }, { slug: 'c' }])
    expect(entries.map((entry) => entry.url)).toEqual([
      `${base}/marketplace/b`,
      `${base}/marketplace/a`,
      `${base}/marketplace/c`,
    ])
  })
})

describe('authorSitemapEntries', () => {
  const base = 'https://navhub.example.com'
  const key = '0b2cf6fc3fe5dde6d0ef78e4'

  it('按 ownerKey 聚合：同作者多插件只产出一条作者页 URL', () => {
    const entries = authorSitemapEntries(base + '/', [
      { slug: 'a', ownerKey: key, updatedAt: 1_700_000_000_000 },
      { slug: 'b', ownerKey: key, updatedAt: 1_700_000_100_000 },
      { slug: 'a', ownerKey: key, updatedAt: 1_700_000_200_000 },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.url).toBe(`${base}/marketplace/author/${key}`)
    expect(entries[0]!.lastModified?.getTime()).toBe(1_700_000_100_000)
    expect(entries[0]!.priority).toBe(0.5)
  })

  it('跳过空 ownerKey 与非法 key（种子插件不该产出 404 作者页）', () => {
    const entries = authorSitemapEntries(base, [
      { slug: 'seed', ownerKey: null },
      { slug: 'seed2' },
      { slug: 'bad', ownerKey: '../../etc/passwd' },
      { slug: 'short', ownerKey: 'abc' },
    ])
    expect(entries).toEqual([])
  })

  it('时间戳非法时不写 lastModified', () => {
    const [entry] = authorSitemapEntries(base, [
      { slug: 'x', ownerKey: key, updatedAt: Number.NaN, publishedAt: -1 },
    ])
    expect(entry!.lastModified).toBeUndefined()
  })
})
