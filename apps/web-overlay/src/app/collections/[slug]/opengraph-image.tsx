import { ImageResponse } from 'next/og'
import { safeDecodeParam } from '@/lib/server/route-params'
import { hubGetProbe } from '@/lib/server/hub'
import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE, ogAscii, ogBestLabel, ogSlugLabel } from '@/lib/seo/og-text'
import { ogBrandLabel, ogShareCard } from '@/lib/seo/og-card'
import type { HubCollection, HubSite } from '@/lib/navhub-api'

/**
 * 精选专题详情页动态 OG 分享卡片（1200×630）。
 *
 * 与页面共用 `hubGetProbe`（60s）：`miss`（中枢确认 404）与 `failed`（抖动）
 * 分开处理——前者页面会 404，卡片没必要编内容；后者出通用卡，分享预览不挂。
 *
 * 专题标题多为中英混排（`2026 前沿 Agentic AI 生产力矩阵`），过滤后剩下的
 * ASCII 片段仍可辨识；完全为空时回退 slug（`ai-coding` 这类是纯 ASCII）。
 */

export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE
export const alt = '山羊胡专题分享卡片'

const KIND_EN: Record<string, string> = {
  topic: 'TOPIC',
  geo: 'BY REGION',
  roadmap: 'ROADMAP',
}

type CollectionDetail = { collection: HubCollection; sites: HubSite[] }

async function loadCardData(slug: string) {
  const probe = await hubGetProbe<CollectionDetail>('/api/collections/' + encodeURIComponent(slug), 60)
  if (probe.status !== 'ok') return null
  return { collection: probe.data.collection, count: (probe.data.sites ?? []).length }
}

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug) ?? slug
  const data = await loadCardData(safeSlug)
  const brand = await ogBrandLabel()
  const kind = data ? (KIND_EN[data.collection.kind] ?? 'COLLECTION') : 'COLLECTION'
  // 中英混排标题（`AI 编程工具链`）过滤后可能只剩 `AI`，此时 slug 更有信息量；
  // 两者都不可渲染时主标题放站点数，统计行换成不带数字的一句以免重复。
  const asciiHero = data
    ? ogBestLabel([data.collection.title, ogSlugLabel(data.collection.slug || safeSlug)])
    : ogAscii(safeSlug)

  return new ImageResponse(
    ogShareCard({
      brand,
      sectionLabel: 'CURATED COLLECTION',
      kindPill: kind,
      hero: asciiHero || (data ? `${data.count} SITES` : 'Shanyanghu'),
      metaLine: data
        ? asciiHero
          ? `${data.count} hand-picked sites in this collection`
          : 'a curated collection on Shanyanghu'
        : 'hand-picked site collections',
      footnote: 'Editorially curated, ordered by hand',
      cta: 'View collection',
    }),
    { ...OG_IMAGE_SIZE },
  )
}
