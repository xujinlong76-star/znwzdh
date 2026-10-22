import { hubGet } from './hub'
import type { HubSite } from '@/lib/navhub-api'

/**
 * 分类 hub 的服务端取数。
 *
 * URL 用 `/category/{id}` 而不是 anchor：`categories.anchor` 是物化路径
 * （`uuid/uuid`，含斜杠），单个动态段接不住；slug 列还没迁移（方案 §0.3
 * 允许先上 id，slug 就绪后再 301）。id 稳定且全站唯一。
 */

export interface HubCategory {
  id: string
  anchor?: string | null
  parentId?: string | null
  title: string
  titleEn?: string | null
  description?: string | null
  icon?: string | null
  enabled?: boolean
  sort?: number
}

/** `/api/sites` 的裸数组行：分类计数要同时看一级与子级指针 */
export interface CategorySiteRef {
  id: string
  categoryId?: string | null
  subCategoryId?: string | null
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
  id: string,
  limit = 60,
  offset = 0,
  revalidate = 60,
): Promise<CategorySearchResult | null> {
  // search 的 categoryId 过滤在 store 层已展开到后代（categoryWithDescendants），
  // 与「category_id ∪ sub_category_id」的建站口径一致。
  return hubGet<CategorySearchResult>(
    `/api/search?q=&categoryId=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}`,
    revalidate,
  )
}

/**
 * 全站存活站点的分类计数（一级 + 子级去重并集）。
 *
 * 与 sitemap 的站点集同源：`status=active`，回收站与 broken 不参与。
 * 返回 null 表示中枢取数失败——调用方应降级，而不是把全部分类当 0 站。
 */
export async function loadActiveCategoryCounts(revalidate = 3600): Promise<Map<string, number> | null> {
  const PAGE = 1000
  const rows: CategorySiteRef[] = []
  for (let page = 0; page < 5; page += 1) {
    const chunk = await hubGet<CategorySiteRef[]>(
      `/api/sites?status=active&limit=${PAGE}&offset=${page * PAGE}`,
      revalidate,
    )
    if (!chunk) return null
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }

  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const id of new Set([row.categoryId, row.subCategoryId])) {
      if (typeof id === 'string' && id.trim()) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * 同名分类标题消歧：4 组同名（「语言」「操作系统」等）若直接用 title，
 * 132 个分类页会出现重复 <title>。有父级时用「父 · 子」前缀。
 */
export function categoryDisplayName(category: HubCategory, categories: HubCategory[]): string {
  const duplicated = categories.some((c) => c.id !== category.id && c.title === category.title)
  if (!duplicated) return category.title
  const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : null
  return parent ? `${parent.title} · ${category.title}` : category.title
}
