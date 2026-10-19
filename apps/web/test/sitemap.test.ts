import { describe, expect, it } from 'vitest'
import { pluginSitemapEntries } from '../src/lib/plugins/sitemap'

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
