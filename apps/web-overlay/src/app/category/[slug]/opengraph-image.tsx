import { ImageResponse } from 'next/og'
import { safeDecodeParam } from '@/lib/server/route-params'
import { categoryUrlKey } from '@/lib/seo/category-url'
import { descendantSiteCounts } from '@/lib/seo/category-totals'
import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE, ogBestLabel, ogSlugLabel } from '@/lib/seo/og-text'
import { ogBrandLabel, ogShareCard } from '@/lib/seo/og-card'
import { loadActiveCategoryCounts, loadCategories } from '@/lib/server/categories'

/**
 * 分类 hub 动态 OG 分享卡片（1200×630）。
 *
 * 与页面同一批服务端取数函数（`loadCategories` / `loadActiveCategoryCounts`），
 * 站点数因此与分类页的索引门槛（MIN_SITES_FOR_CATEGORY_INDEX）同源：都读中枢
 * `/api/categories/counts` 的存活计数（一级根按子树聚合），而不是页面分页后的条数。
 *
 * 分类标题是中文，Satori 渲染不了；好在 `categories.slug` 本身就是人类可读
 * ASCII（`cat-design`），去掉 `cat-` 前缀即 `DESIGN`——比中文标题的英文字段
 * （`titleEn`，当前全库为空）更容易拿到可渲染文本。两者都拿不到（历史行没有
 * slug，URL 段是 uuid）时退回 `CATEGORY` 通用构图。
 */

export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE
export const alt = 'NavHub 分类分享卡片'

async function loadCardData(ref: string) {
  const [categories, rawCounts] = await Promise.all([
    loadCategories(3600),
    loadActiveCategoryCounts(3600),
  ])
  if (!categories) return null
  const counts = descendantSiteCounts(categories, rawCounts)
  const category =
    categories.find((c) => c.slug === ref && c.enabled !== false) ??
    categories.find((c) => c.id === ref && c.enabled !== false) ??
    null
  if (!category) return null
  const key = categoryUrlKey(category)
  return {
    titleEn: category.titleEn ?? null,
    // uuid 形态的 key 上画面没有意义，只保留人类可读的 slug
    asciiKey: /^[0-9a-f-]{36}$/i.test(key) ? '' : ogSlugLabel(key.replace(/^cat-/i, '')),
    // null = 计数没取到（中枢降级）；写成 0 会在分享卡上留下确定性的假信息
    count: counts?.get(category.id) ?? null,
  }
}

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug) ?? slug
  const data = await loadCardData(safeSlug)
  const brand = await ogBrandLabel()
  const hero = data ? ogBestLabel([data.titleEn, data.asciiKey]) || 'CATEGORY' : 'CATEGORY'

  return new ImageResponse(
    ogShareCard({
      brand,
      sectionLabel: 'CATEGORY HUB',
      kindPill: 'CATEGORY',
      hero,
      metaLine:
        data && data.count !== null
          ? `${data.count} curated sites in this category`
          : 'curated sites, organized by category',
      footnote: 'Reviewed entries, grouped and cross-linked',
      cta: 'Open category',
    }),
    { ...OG_IMAGE_SIZE },
  )
}
