import { hubGet } from './hub'
import type { HubSite } from '@/lib/navhub-api'

/**
 * 分类 hub 的服务端取数。
 *
 * URL 用 `/category/{slug}`（`categories.slug`，全局唯一）；`anchor` 是物化路径
 * （`uuid/uuid`，含斜杠），单个动态段接不住。老外链的 `/category/{uuid}` 由详情页
 * 301 到 slug 形态，所以这里两种标识都可能进来，统一用 `id ∪ slug` 匹配。
 */

export interface HubCategory {
  id: string
  anchor?: string | null
  parentId?: string | null
  title: string
  titleEn?: string | null
  /** URL 标识；历史行可能为空，展示层退回 id */
  slug?: string | null
  description?: string | null
  icon?: string | null
  enabled?: boolean
  sort?: number
}

/** `/api/categories/counts` 的响应：中枢一次 GROUP BY 的结果 */
interface CategoryCountPayload {
  counts: Array<{ categoryId: string; sites: number }>
}

export interface CategorySearchResult {
  hits: Array<{ site: HubSite | null }>
  hasMore?: boolean
  total?: number
}

export function loadCategories(revalidate = 300): Promise<HubCategory[] | null> {
  return hubGet<HubCategory[]>('/api/categories', revalidate)
}

export function loadCategorySites(
  idOrSlug: string,
  limit = 60,
  offset = 0,
  revalidate = 60,
): Promise<CategorySearchResult | null> {
  // search 的 categoryId 过滤在 store 层已展开到后代（categoryWithDescendants），
  // 且按「id → slug → 唯一标题」顺序解析，所以类目页可以直接传 slug。
  // 必须显式限定 status=active：
  // 否则 broken/pending 也占分页名额，页面再过滤会让「存活 ≥N」误判、翻页漏站。
  return hubGet<CategorySearchResult>(
    `/api/search?q=&status=active&categoryId=${encodeURIComponent(idOrSlug)}&limit=${limit}&offset=${offset}`,
    revalidate,
  )
}

/**
 * 全站存活站点的分类计数（一级 + 子级去重并集）。
 *
 * 由中枢一次 GROUP BY 算好（`/api/categories/counts`）。
 * 此前这里翻 `/api/sites`（最多 5 页 × 1000 条）在前端累加：
 * 站点数一过 5000 就**静默少算**，而「达标类目」判定用的正是这个数。
 * 返回 null 表示中枢取数失败——调用方应降级，而不是把全部分类当 0 站。
 *
 * 口径是**单个类目自身**：一级根恒为 0（站点只挂叶子），展示层级要的是
 * 子树合计，用 `descendantSiteCounts`（`@/lib/seo/category-totals`）聚合后再比门槛。
 */
export async function loadActiveCategoryCounts(revalidate = 3600): Promise<Map<string, number> | null> {
  const res = await hubGet<CategoryCountPayload>('/api/categories/counts', revalidate)
  if (!res || !Array.isArray(res.counts)) return null
  const counts = new Map<string, number>()
  for (const row of res.counts) {
    const id = typeof row?.categoryId === 'string' ? row.categoryId.trim() : ''
    if (!id) continue
    counts.set(id, Number(row.sites) || 0)
  }
  return counts
}

/**
 * 同名分类标题消歧：4 组同名（「语言」「操作系统」等）若直接用 title，
 * 分类页会出现重复 <title>。有父级时用「父 · 子」前缀。
 */
export function categoryDisplayName(category: HubCategory, categories: HubCategory[]): string {
  const duplicated = categories.some((c) => c.id !== category.id && c.title === category.title)
  if (!duplicated) return category.title
  const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : null
  return parent ? `${parent.title} · ${category.title}` : category.title
}
