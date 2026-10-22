/**
 * 类目 URL（`/category/{slug}`）的口径统一。
 *
 * slug 是类目的**对外**标识，uuid 只是内部主键：改名会换 uuid，slug 一旦发布
 * 就当资产看待（仓储层改名时也不重写 slug）。历史行可能还没有 slug，
 * 所以这里保留「slug 为空退回 id」——宁可短链一段，也不要制造 404。
 *
 * apps/web 不依赖 @navhub/core，故「未分类」的固定 id 在这里重复一份：
 * 改 `packages/core/src/taxonomy-governance.ts` 时必须同步。
 */

export const UNCATEGORIZED_CATEGORY_ID = 'cat-uncategorized'

/** UUID 形态：老链接 `/category/{uuid}` 要 301 到 slug 形态 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CategoryUrlRef {
  id: string
  slug?: string | null
}

export function isCategoryUuidRef(ref: string): boolean {
  return UUID_SHAPE.test((ref ?? '').trim())
}

/** 类目在 URL 里的那一段 */
export function categoryUrlKey(category: CategoryUrlRef): string {
  const slug = typeof category?.slug === 'string' ? category.slug.trim() : ''
  return slug || category.id
}

/**
 * 类目页 href：第 2 页起走 `/category/{slug}/p/{n}`。
 *
 * 用路径段而不是 `?page=N` 不是审美问题：`/category/[slug]` 带 `revalidate` +
 * `generateStaticParams`，页面签名一读 `searchParams`，未预渲染的 slug 在按需
 * 生成阶段就抛 `DYNAMIC_SERVER_USAGE`（生产构建实测 500）。旧的 `?page=N`
 * 由 `next.config.js` 的 redirect 兜到这一形态。
 */
export function categoryHref(category: CategoryUrlRef | string, page = 1): string {
  const key = typeof category === 'string' ? category : categoryUrlKey(category)
  const base = `/category/${encodeURIComponent(key)}`
  return page > 1 ? `${base}/p/${page}` : base
}

/** 不进导航、不进 sitemap 的类目：「未分类」是归类失败的兜底桶，不是可浏览入口 */
export function isHiddenCategory(category: CategoryUrlRef & { slug?: string | null; title?: string | null }): boolean {
  return category.id === UNCATEGORIZED_CATEGORY_ID || category.slug === 'uncategorized'
}
