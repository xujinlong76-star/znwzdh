/**
 * 插件市场 sitemap 条目构造（纯函数，单测覆盖）。
 *
 * 为什么从 app/sitemap.ts 里拆出来：元数据路由要读 headers() 并 fetch 中枢，
 * 在单测里既难启动也不稳定；把「选哪些 URL、如何编码、时间戳是否有效」抽成
 * 纯函数，路由只负责取数与拼装。
 */

import { toDate } from '@/lib/seo/sitemap-entries'

export interface SitemapPluginRef {
  slug: string
  /** 公开作者 key（身份不可逆哈希）；种子插件可能为空 */
  ownerKey?: string | null
  updatedAt?: number | null
  publishedAt?: number | null
}

export interface PluginSitemapEntry {
  url: string
  lastModified?: Date
  changeFrequency: 'weekly'
  priority: number
}

/** slug 上限与插件清单校验一致（core 的清单约束），超长视为脏数据直接跳过 */
const MAX_SLUG_LENGTH = 200

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * 生成已上架插件的详情页条目：
 * - 同一 slug 只出现一次（分页期间可能有新插件挤入导致重复）；
 * - 空 slug / 超长 slug 跳过，避免 sitemap 出现无效 URL；
 * - 时间戳优先 updatedAt，缺失或非法时回退 publishedAt，均非法则不带 lastModified
 *   （宁可不给，也不要给 1970 年让搜索引擎误判）。
 */
export function pluginSitemapEntries(
  base: string,
  plugins: SitemapPluginRef[],
): PluginSitemapEntry[] {
  const root = normalizeBase(base)
  const seen = new Set<string>()
  const entries: PluginSitemapEntry[] = []

  for (const plugin of plugins) {
    const slug = typeof plugin.slug === 'string' ? plugin.slug.trim() : ''
    if (!slug || slug.length > MAX_SLUG_LENGTH || seen.has(slug)) continue
    seen.add(slug)

    // 与站点/合集共用同一套时间戳归一：秒级、毫秒级、NaN、未来时间都处理
    const lastModified = toDate(plugin.updatedAt) ?? toDate(plugin.publishedAt)

    entries.push({
      url: `${root}/marketplace/${encodeURIComponent(slug)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'weekly',
      priority: 0.7,
    })
  }

  return entries
}

/** 作者 key 与 API 校验同构（sha256 前 24 位十六进制） */
const AUTHOR_KEY_RE = /^[a-f0-9]{8,64}$/i

/**
 * 公开作者页条目：从已上架插件反推作者，而不是要求中枢另开作者清单接口。
 *
 * - 只收录 key 合法且有 ≥1 个已上架插件的作者（作者页对其余 key 返回 404）；
 * - 同一 slug 只计一次（分页期间可能重复），避免 count 灌水；
 * - lastModified 取该作者插件的最新更新时间。
 */
export function authorSitemapEntries(
  base: string,
  plugins: SitemapPluginRef[],
): PluginSitemapEntry[] {
  const root = normalizeBase(base)
  const authors = new Map<string, { slugs: Set<string>; updatedAt: number | null }>()

  for (const plugin of plugins) {
    const slug = typeof plugin.slug === 'string' ? plugin.slug.trim() : ''
    const key = typeof plugin.ownerKey === 'string' ? plugin.ownerKey.trim() : ''
    if (!slug || !AUTHOR_KEY_RE.test(key)) continue

    const entry = authors.get(key) ?? { slugs: new Set<string>(), updatedAt: null }
    if (entry.slugs.has(slug)) continue
    entry.slugs.add(slug)

    const ts = [plugin.updatedAt, plugin.publishedAt].find(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
    )
    if (ts && (entry.updatedAt === null || ts > entry.updatedAt)) entry.updatedAt = ts
    authors.set(key, entry)
  }

  return [...authors.entries()].map(([key, { updatedAt }]) => {
    const lastModified = toDate(updatedAt)
    return {
      url: `${root}/marketplace/author/${encodeURIComponent(key)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }
  })
}
