import type { MetadataRoute } from 'next'
import { categoryUrlKey, isHiddenCategory } from './category-url'
import { MIN_SITES_FOR_CATEGORY_INDEX, MIN_SITES_FOR_TAG_INDEX } from './thresholds'

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
  /** 分类计数的双指针（建站时父级与子级都挂；计数只取主指针） */
  categoryId?: string | null
  subCategoryId?: string | null
  /** 停用站点与 search 一样不对外可见，不能进 sitemap，也不能凑分类达标数 */
  enabled?: boolean | null
}

export interface TagRef {
  slug: string
  count?: number | null
}

export interface CollectionRef {
  slug: string
  enabled?: boolean | null
  updatedAt?: number | null
}

export interface CategoryRef {
  id: string
  /** URL 标识；历史行可能为空，此时退回 id 保证不产死链 */
  slug?: string | null
  enabled?: boolean | null
  /** `/api/categories` 实际返回 updatedAt；有值就写 lastModified */
  updatedAt?: number | null
  /**
   * 父级 id。`categoryEntries` 自己不读它——但一级根的计数必须是后代聚合，
   * 调用方要用 `descendantSiteCounts(categories, counts)` 才能拿到非 0 的根计数。
   */
  parentId?: string | null
}

/**
 * 进 sitemap 的静态页（/category 随分类 hub 上线）。
 *
 * `/videos` 暂不收录：视频库仍是占位内容，页面已声明 noindex，
 * 提交进 sitemap 只会制造「sitemap 与 robots 打架」。
 */
export const STATIC_PATHS = [
  '/',
  '/marketplace',
  '/hot',
  '/tags',
  '/collections',
  '/category',
  '/graph',
  '/algorithms',
  '/sites',
] as const

/** origin 归一：去掉末尾斜杠，避免拼出 `//` 这类重复斜杠 URL */
function normOrigin(origin: string): string {
  return origin.replace(/\/+$/, '')
}

/** 时间戳非法（NaN / 负数 / 未来）时不写 lastModified，宁缺勿错。 */
export function toDate(value: number | null | undefined): Date | undefined {
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
    if (!id || s?.enabled === false || seen.has(id)) continue
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
  minSites: number = MIN_SITES_FOR_TAG_INDEX,
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

/** 分类计数：只按主指针（category_id），与类目页 search、/api/categories/counts 同口径 */
export function countCategorySites(sites: SiteRef[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const site of sites ?? []) {
    // 停用站点在 search 里不可见，不能凑分类达标数；否则 sitemap 会提交
    // 一个实际 404 的分类页。
    if (site?.enabled === false) continue
    // 单主指针：副指针（subCategoryId）在浏览侧不可见，计入会让一级根的
    // 子树合计重复计算同根副指针站点（如 jobs-and-career 11 → 13），
    // 产出指向 404 的 sitemap 条目。
    const id = site.categoryId
    if (typeof id === 'string' && id.trim()) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * 分类 hub 条目：只收录 enabled 且存活站点数达标的分类。
 *
 * URL 用 slug 形态（`/category/{slug}`）：sitemap 是「告诉爬虫哪批 URL 值得
 * 长期抓」的清单，提交 uuid 等于把 301 前的旧地址再喂一遍。
 * 计数由调用方提供：叶子用主指针 `category_id` 的自身计数，
 * **一级根必须传后代聚合值**（`descendantSiteCounts`）——新树站点只挂叶子，
 * 原始计数里每个根都是 0，不聚合就是「18 个根全站缺席」。
 * 详情页对未达标分类直接 404，这里若照单全收就是主动提交死链。
 * 「未分类」不提交：它是归类失败的兜底桶，不是可浏览入口。
 */
export function categoryEntries(
  origin: string,
  categories: CategoryRef[],
  counts: Map<string, number> | null,
  minSites: number = MIN_SITES_FOR_CATEGORY_INDEX,
): MetadataRoute.Sitemap {
  const seen = new Set<string>()
  const out: MetadataRoute.Sitemap = []
  for (const c of categories ?? []) {
    const id = typeof c?.id === 'string' ? c.id.trim() : ''
    if (!id || c?.enabled === false || isHiddenCategory(c)) continue
    const key = categoryUrlKey(c)
    if (seen.has(key)) continue
    if ((counts?.get(id) ?? 0) < minSites) continue
    seen.add(key)
    const lastModified = toDate(c.updatedAt)
    out.push({
      url: `${normOrigin(origin)}/category/${encodeURIComponent(key)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'weekly',
      priority: 0.6,
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
    const lastModified = toDate(c.updatedAt)
    out.push({
      url: `${normOrigin(origin)}/collections/${encodeURIComponent(slug)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'weekly',
      priority: 0.5,
    })
  }
  return out
}
