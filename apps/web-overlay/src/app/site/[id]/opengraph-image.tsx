import { ImageResponse } from 'next/og'
import { safeDecodeParam } from '@/lib/server/route-params'
import { hubGetProbe } from '@/lib/server/hub'
import { categoryUrlKey } from '@/lib/seo/category-url'
import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE, ogAscii, ogBestLabel, ogHost, ogSlugLabel } from '@/lib/seo/og-text'
import { ogBrandLabel, ogShareCard } from '@/lib/seo/og-card'
import { loadCategories } from '@/lib/server/categories'
import type { HubSite } from '@/lib/navhub-api'

/**
 * 站点详情页动态 OG 分享卡片（1200×630）。
 *
 * 中文站名过不了 Satori（无 CJK 字体），因此主标题按「站名 ASCII 片段 →
 * titleEn → 域名」回退：域名永远是 ASCII，且正是导航站最该被分享出去的信息。
 * 分类胶囊取 `categories.slug`（`cat-design` → `DESIGN`），同样可渲染且有语义。
 *
 * 取数失败（中枢抖动）不编造站点信息，出通用卡；与页面的降级渲染口径一致。
 */

export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE
export const alt = 'NavHub 站点分享卡片'

async function loadCardData(id: string) {
  const probe = await hubGetProbe<HubSite>('/api/sites/' + encodeURIComponent(id), 60)
  if (probe.status !== 'ok') return null
  const site = probe.data
  const categoryId = (site.categoryId ?? '').trim()
  const categories = categoryId ? await loadCategories(3600) : null
  const category = categories?.find((c) => c.id === categoryId && c.enabled !== false) ?? null
  return {
    site,
    categoryPill: category ? ogSlugLabel(categoryUrlKey(category).replace(/^cat-/i, '')) : null,
  }
}

export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const safeId = safeDecodeParam(id) ?? id
  const data = await loadCardData(safeId)
  const brand = await ogBrandLabel()
  const site = data?.site ?? null
  const host = ogHost(site?.url)
  // 站名过滤后为空（纯中文）→ 用域名当主标题，此时不再重复一遍 subline
  const hero = site ? ogBestLabel([site.title, site.titleEn]) || host : safeId.slice(0, 42)
  const tagCount = (site?.tags ?? []).filter((t) => ogAscii(t)).length

  return new ImageResponse(
    ogShareCard({
      brand,
      sectionLabel: 'SITE DIRECTORY',
      kindPill: data?.categoryPill ?? 'SITE',
      hero: hero || 'NavHub',
      subline: site && hero !== host && host ? host : null,
      metaLine: site
        ? tagCount > 0
          ? `${tagCount} tags curated on NavHub`
          : 'Curated entry on NavHub'
        : 'curated links & categories',
      footnote: 'Reviewed, categorized and cross-linked',
      cta: 'Visit site',
    }),
    { ...OG_IMAGE_SIZE },
  )
}
