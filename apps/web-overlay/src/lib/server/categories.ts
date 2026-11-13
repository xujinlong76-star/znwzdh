import { hubGet } from './hub'
import type { HubSite } from '@/lib/navhub-api'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '@/lib/seo/thresholds'

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
  /**
   * 管理后台维护的 SKOS 同义别名与跨树相关分类（P16）。
   *
   * 中枢 `GET /api/categories` 原样返回这两列（store 的 dialect 解析
   * `alt_labels` / `related_categories`，见 packages/store/src/repository/
   * dialect.ts；契约生成物 rest-contracts.generated.ts 的 Category 也有
   * 它们），之前只是类型里没声明、页面也没消费——这里补上，分类页
   * （category-board.tsx 的「相关类目」区）据此渲染。
   * relatedCategories 存的是类目 id（不是 slug），与中枢
   * `GET /api/categories/:id/related` 的解析口径一致。
   */
  altLabels?: string[] | null
  relatedCategories?: string[] | null
}

/** `/api/categories/counts` 的响应：中枢一次 GROUP BY 的结果 */
interface CategoryCountPayload {
  counts: Array<{ categoryId: string; sites: number }>
}

export interface CategorySearchResult {
  hits: Array<{ site: HubSite | null }>
  hasMore?: boolean
  // 注意：不要在这里加 total?: number——/api/search 从不返回 total
  // （core 的 SearchResult 注释明言「叫 total 会误导，故用布尔」）。
  // 分类页的总数口径是 categoryPageTotal（子树聚合计数），见 category-board.tsx。
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

/** 展示用的「相关类目」条数上限：与叶子页的同父兄弟位（SIBLING_LINKS）同口径 */
export const RELATED_CATEGORY_LINKS = 8

/**
 * 管理后台 curated 的 `relatedCategories`（存 id）→ 分类页可链的分类。
 *
 * 过滤口径与页面里层级推导的「同类分类」一致，只是不按树结构、按后台
 *  curated 顺序（SKOS:related 跨树关联就是用来打破单一树形孤岛的，
 * 顺序是人工意图，不按 sort / 站点数重排）：
 * - 自身、重复 id、列表里找不到的 id、已停用的分类不要；
 * - 只链达标分类：薄分类页本身 404（< MIN_SITES_FOR_CATEGORY_INDEX），
 *   链过去是死链；
 * - counts 取不到（中枢抖动）时返回空——与层级相关位同口径，数据不全
 *   时不猜、不链，而不是把用户送去可能 404 的页面。
 */
export function resolveRelatedCategories(
  category: HubCategory | null | undefined,
  categories: HubCategory[] | null | undefined,
  counts: Map<string, number> | null | undefined,
): HubCategory[] {
  if (!category || !categories || !counts) return []
  const ids = Array.isArray(category.relatedCategories) ? category.relatedCategories : []
  const seen = new Set<string>([category.id])
  const out: HubCategory[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    const rel = categories.find((c) => c.id === id)
    if (!rel || rel.enabled === false) continue
    if ((counts.get(rel.id) ?? 0) < MIN_SITES_FOR_CATEGORY_INDEX) continue
    out.push(rel)
    if (out.length >= RELATED_CATEGORY_LINKS) break
  }
  return out
}

/** 展示用的同义别名：只留非空字符串，空串 / 非字符串（脏数据）不渲染 */
export function categoryAltLabels(category: HubCategory | null | undefined): string[] {
  if (!category || !Array.isArray(category.altLabels)) return []
  return category.altLabels.filter(
    (label): label is string => typeof label === 'string' && label.trim().length > 0,
  )
}
