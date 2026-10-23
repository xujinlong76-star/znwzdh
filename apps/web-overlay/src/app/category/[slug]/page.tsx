import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { safeDecodeParam } from '@/lib/server/route-params'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { ogImageUrl } from '@/lib/seo/og-text'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '@/lib/seo/thresholds'
import { categoryHref, categoryUrlKey, isCategoryUuidRef, isHiddenCategory } from '@/lib/seo/category-url'
import { descendantSiteCounts } from '@/lib/seo/category-totals'
import { loadActiveCategoryCounts, loadCategories } from '@/lib/server/categories'
import {
  CategoryBoard,
  categoryPageName,
  categoryPageTotal,
  categoryPageUrlKey,
  loadCategoryPage,
} from './category-board'

/**
 * 分类 hub 第 1 页（`/category/{slug}`，服务端页面）。
 *
 * 目标：达标分类各自接住一批 `/site/{id}` 内链，把首页 → 分类 → 站点
 * 的点击深度压到 3 层内；列表标题必须是 SSR HTML（不是客户端 useEffect）。
 *
 * URL 标识是 `categories.slug`（全局唯一，人类可读）：`/category/{slug}`。
 * 旧形态 `/category/{uuid}` 是已发出的外链与已收录 URL，因此**不返回 404**，
 * 而是 301 到 slug 形态，把权重一次性交出去。
 *
 * 第 2 页起在 `./p/[n]/page.tsx`：分页此前挂在 `?page=N`，而这条路由带
 * `revalidate` + `generateStaticParams`，签名里只要出现 `searchParams`，未预渲染
 * 的 slug 走按需生成时会直接抛 `DYNAMIC_SERVER_USAGE`（生产构建实测 500）。
 * 取数与视图都在 `./category-board.tsx`。
 *
 * 索引口径（方案 §3.1 / §4）：
 * - 聚合站点 < MIN_SITES_FOR_CATEGORY_INDEX 的分类直接 404，不生成 noindex 空页；
 * - 第 1 页默认可索引并进 sitemap；页 ≥2 保留但 `noindex,follow`，canonical 自指；
 * - 中枢失败时不 404、不 noindex：降级渲染，等上游恢复。
 */

export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string }>
}

/**
 * 构建期预渲染**达标**分类（slug 形态）。
 *
 * 只预渲染站点数达标的类目：薄类目页会 notFound()，预渲染它等于把一份
 * 静态 404 缓存 60 秒以上，白给爬虫一次死链。
 * 取数失败返回空数组：`dynamicParams` 默认 true，未预渲染的 slug 仍会按需
 * 渲染并缓存，所以构建时中枢没起来只是少了预渲染，不是丢页面。
 */
export async function generateStaticParams() {
  const [categories, rawCounts] = await Promise.all([loadCategories(3600), loadActiveCategoryCounts(3600)])
  const counts = descendantSiteCounts(categories ?? [], rawCounts)
  if (!categories || !counts) return []
  return categories
    .filter(
      (c) =>
        c.enabled !== false &&
        Boolean(c.slug) &&
        !isHiddenCategory(c) &&
        (counts.get(c.id) ?? 0) >= MIN_SITES_FOR_CATEGORY_INDEX,
    )
    .map((c) => ({ slug: categoryUrlKey(c) }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const safeRef = safeDecodeParam(slug)
  if (!safeRef) notFound()

  const data = await loadCategoryPage(safeRef, 1)
  // 分类不存在 / 已停用 / 站点数不达标：与页面的 404 口径一致
  if (data.categories !== null && (!data.category || !data.qualifies)) notFound()
  // 「未分类」是归类失败的兜底桶，不提供公开详情页；站点详情也不会链过来。
  if (data.category && isHiddenCategory(data.category)) notFound()

  const name = categoryPageName(data)
  // canonical 永远写解析后的形态：uuid 入参会被页面 301，元信息不能跟着留旧 URL
  const canonical = categoryHref(data.category ?? safeRef, 1)
  const title = `「${name}」工具与服务`
  const description =
    data.category?.description ??
    `「${name}」分类下收录了 ${categoryPageTotal(data)} 个站点，可进入详情查看简介、标签与同类推荐。`

  return {
    title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({
      url: canonical,
      title,
      description,
      // 降级时不指动态卡：分类表/计数没取到，卡片只能出通用构图
      ...(data.degraded ? {} : { imageUrl: ogImageUrl(canonical), imageAlt: `「${name}」分类 · NavHub` }),
    })),
  }
}

export default async function CategoryDetailPage({ params }: PageProps) {
  const { slug } = await params
  const safeRef = safeDecodeParam(slug)
  if (!safeRef) notFound()

  const data = await loadCategoryPage(safeRef, 1)
  if (data.categories !== null && (!data.category || !data.qualifies)) notFound()
  if (data.category && isHiddenCategory(data.category)) notFound()

  const urlKey = categoryPageUrlKey(data, safeRef)
  // `/category/{uuid}` 是已发出的外链：永久跳到 slug 形态，把权重一次性交出去
  if (isCategoryUuidRef(safeRef) && urlKey !== safeRef) permanentRedirect(categoryHref(urlKey, 1))

  return <CategoryBoard requested={1} urlKey={urlKey} name={categoryPageName(data)} data={data} />
}
