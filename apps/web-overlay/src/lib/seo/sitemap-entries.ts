import type { MetadataRoute } from 'next'
import { MIN_SITES_FOR_INDEX } from './thresholds'

/**
 * sitemap 条目纯函数。
 *
 * 抽成纯函数的目的：sitemap 生成涉及「去重 / 阈值过滤 / 时间戳降级」三类容易
 * 静默出错的逻辑，接在单测里比在生成时肉眼检查可靠得多（沿用 test/sitemap.test.ts
 * 对插件条目的做法）。
 *
 * 两条实测事实，改这里前先读：
 * - `/api/sites` 与 `/api/tags` 返回**裸数组**，不是 `{ items, total }`；
 * - 标签的计数字段是 `count`，不是 `siteCount`。
 */

export interface SiteRef {
  id: string
  updatedAt?: number | null
}

export interface TagRef {
  slug: string
  count?: number | null
}

export interface CollectionRef {
  slug: string
  enabled?: boolean | null
}

/** 进 sitemap 的静态页（不含 /category，分类 hub 上线后再加）。 */
export const STATIC_PATHS = [
  '/',
  '/marketplace',
  '/hot',
  '/tags',
  '/collections',
  '/graph',
  '/algorithms',
  '/videos',
  '/sites',
] as const

/** origin 归一：去掉末尾斜杠，避免拼出 `//` 这类重复斜杠 URL */
function normOrigin(origin: string): string {
  return origin.replace(/\/+$/, '')
}

/** 时间戳非法（NaN / 负数 / 未来）时不写 lastModified，宁缺勿错。 */
function toDate(value: number | null | undefined): Date | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  const ms = value > 1e12 ? value : value * 1000 // 兼容秒级与毫秒级
  if (ms > Date.now() + 24 * 3600 * 1000) return undefined
  return new Date(ms)
}

export function staticEntries(origin: string): MetadataRoute.Sitemap {
  const base = normOrigin(origin)
  return STATIC_PATHS.map((p) => ({
    url: `${base}${p}`,
    changeFrequency: p === '/' ? ('daily' as const) : ('weekly' as const),
    priority: p === '/' ? 1 : 0.6,
  }))
}

export function siteEntries(origin: string, sites: SiteRef[]): MetadataRoute.Sitemap {
  const seen = new Set<string>()
  const out: MetadataRoute.Sitemap = []
  for (const s of sites ?? []) {
    const id = typeof s?.id === 'string' ? s.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      url: `${normOrigin(origin)}/site/${encodeURIComponent(id)}`,
      ...(toDate(s.updatedAt) ? { lastModified: toDate(s.updatedAt) } : {}),
      changeFrequency: 'weekly',
      priority: 0.7,
    })
  }
  return out
}

export function tagEntries(
  origin: string,
  tags: TagRef[],
  minSites: number = MIN_SITES_FOR_INDEX,
): MetadataRoute.Sitemap {
  const seen = new Set<string>()
  const out: MetadataRoute.Sitemap = []
  for (const t of tags ?? []) {
    const slug = typeof t?.slug === 'string' ? t.slug.trim() : ''
    const count = typeof t?.count === 'number' ? t.count : 0
    if (!slug || count < minSites || seen.has(slug)) continue
    seen.add(slug)
    out.push({
      url: `${normOrigin(origin)}/tags/${encodeURIComponent(slug)}`,
      changeFrequency: 'weekly',
      priority: 0.5,
    })
  }
  return out
}

export function collectionEntries(origin: string, collections: CollectionRef[]): MetadataRoute.Sitemap {
  const seen = new Set<string>()
  const out: MetadataRoute.Sitemap = []
  for (const c of collections ?? []) {
    const slug = typeof c?.slug === 'string' ? c.slug.trim() : ''
    if (!slug || c?.enabled === false || seen.has(slug)) continue
    seen.add(slug)
    out.push({
      url: `${normOrigin(origin)}/collections/${encodeURIComponent(slug)}`,
      changeFrequency: 'weekly',
      priority: 0.5,
    })
  }
  return out
}
