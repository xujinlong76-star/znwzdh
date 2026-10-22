import { ImageResponse } from 'next/og'
import { safeDecodeParam } from '@/lib/server/route-params'
import { hubGet } from '@/lib/server/hub'
import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE, ogBestLabel, ogSlugLabel } from '@/lib/seo/og-text'
import { ogBrandLabel, ogShareCard } from '@/lib/seo/og-card'
import type { HubSite } from '@/lib/navhub-api'

/**
 * 标签结果页动态 OG 分享卡片（1200×630）。
 *
 * 与页面同源取数（同一批 hubGet 路径 + 60s），保证「分享卡上的站点数」和
 * 页面里能看到的站点数口径一致：都按 **存活站点** 算，且上限 100（页面同样
 * limit=100，无「加载更多」）。
 *
 * 标签 slug 常是纯中文（`大模型`），Satori 无 CJK 字体会渲染成空白，因此
 * 主标题按「标签规范名 → 请求 slug → 站点数」回退，最后一档保证画面有信息。
 */

export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE
export const alt = 'NavHub 标签分享卡片'

type TagMeta = { ok?: boolean; tag?: { name?: string; slug?: string } | null }

async function loadCardData(slug: string) {
  const [res, tagRes] = await Promise.all([
    hubGet<{ hits: Array<{ site: HubSite }> }>(
      '/api/search?q=&tag=' + encodeURIComponent(slug) + '&limit=100',
      60,
    ),
    hubGet<TagMeta>('/api/tags/resolve?q=' + encodeURIComponent(slug), 60),
  ])
  // res === null 是「中枢没答上来」，不是「0 个站点」：出通用卡，
  // 否则分享卡会写上 "0 curated sites" 这种确定性的假信息。
  if (res === null) return null
  const sites = (res.hits ?? [])
    .map((h) => h.site)
    .filter((s): s is HubSite => Boolean(s))
    .filter((s) => s.status === 'active')
  return { name: tagRes?.tag?.name ?? slug, count: sites.length }
}

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug) ?? slug
  const data = await loadCardData(safeSlug)
  const brand = await ogBrandLabel()
  const asciiName = data ? ogBestLabel([data.name, ogSlugLabel(safeSlug)]) : ogSlugLabel(safeSlug)

  return new ImageResponse(
    ogShareCard({
      brand,
      sectionLabel: 'TAG BROWSING',
      kindPill: 'TAG',
      // 纯中文标签（`大模型`）过滤后无可渲染字符：主标题改放站点数，
      // 统计行同时换成不带数字的一句，避免「3 SITES / 3 curated sites」重复。
      hero: asciiName || (data ? `${data.count} SITES` : 'NavHub'),
      metaLine: data
        ? asciiName
          ? `${data.count} curated sites under this tag`
          : 'curated sites sharing this tag'
        : 'curated sites, grouped by topic',
      footnote: 'Every tag page lists reviewed entries only',
      cta: 'Browse tag',
    }),
    { ...OG_IMAGE_SIZE },
  )
}
