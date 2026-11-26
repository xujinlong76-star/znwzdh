/**
 * 对比分享 sitemap loader 端到端打通（P13 补 `GET /api/compare/shares` 后）。
 *
 * 真实跑 web-overlay 的 `app/sitemap.ts`：`hubGet` mock 成中枢列表接口的
 * 响应形态（`{ items: [{ slug, updatedAt, publishedAt }] }`，即列表接口
 * 契约），其余取数路给空数组（取到数据、合法空态，不触发「四路全线失败」
 * 抛错），断言 `sitemap()` 产出 `/pub/compare/<slug>` 条目。
 *
 * 这是 loader 这一侧的验证；另一侧（列表接口真实返回该形态）由
 * apps/api/test/compare-share-list-api.test.ts 钉住，两侧合起来即打通。
 */
import { describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://navhub.example.com'

/** mock 实现可按用例替换：中枢列表接口的响应形态 + 其余路的空态。 */
const hubState = vi.hoisted(() => ({
  shares: [] as { slug: string; updatedAt?: number; publishedAt?: number }[],
}))

vi.mock('@/lib/server/hub', () => ({
  hubGet: vi.fn(async (url: string) => {
    if (url.startsWith('/api/compare/shares')) return { items: hubState.shares }
    if (url.startsWith('/api/plugins')) return { items: [], total: 0 }
    if (url.startsWith('/api/sites')) return []
    if (url.startsWith('/api/tags')) return []
    if (url.startsWith('/api/categories')) return []
    if (url.startsWith('/api/collections')) return []
    if (url.startsWith('/api/scenes')) return { scenes: [] }
    return null
  }),
}))

vi.mock('@/lib/seo/origin', () => ({
  siteOrigin: vi.fn(async () => ORIGIN),
}))

import sitemap from '../src/app/sitemap'

describe('sitemap loader：已发布对比分享进 sitemap', () => {
  it('2 条已发布快照 → 产出 2 条 /pub/compare/<slug>，weekly / 0.6，lastModified 取 updatedAt', async () => {
    hubState.shares = [
      { slug: 'compare-aaa', updatedAt: Date.UTC(2026, 10, 20), publishedAt: Date.UTC(2026, 10, 19) },
      { slug: 'compare-bbb', updatedAt: Date.UTC(2026, 10, 21), publishedAt: Date.UTC(2026, 10, 20) },
    ]
    const entries = await sitemap()
    const shares = entries.filter((e) => e.url.includes('/pub/compare/'))
    expect(shares).toHaveLength(2)
    expect(shares.map((e) => e.url).sort()).toEqual([
      `${ORIGIN}/pub/compare/compare-aaa`,
      `${ORIGIN}/pub/compare/compare-bbb`,
    ])
    for (const entry of shares) {
      expect(entry.changeFrequency).toBe('weekly')
      expect(entry.priority).toBe(0.6)
    }
    expect(shares.find((e) => e.url.endsWith('/compare-aaa'))?.lastModified).toEqual(
      new Date(Date.UTC(2026, 10, 20)),
    )
    expect(shares.find((e) => e.url.endsWith('/compare-bbb'))?.lastModified).toEqual(
      new Date(Date.UTC(2026, 10, 21)),
    )
  })

  it('0 条已发布快照 → 不产 /pub/compare 条目，整份 sitemap 不垮', async () => {
    hubState.shares = []
    const entries = await sitemap()
    expect(entries.filter((e) => e.url.includes('/pub/compare/'))).toHaveLength(0)
    // 静态页仍在：loader 空态不拖垮整份 sitemap。
    expect(entries.some((e) => e.url === `${ORIGIN}/`)).toBe(true)
  })
})
