import { ImageResponse } from 'next/og'
import { safeDecodeParam } from '@/lib/server/route-params'
import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE, ogBestLabel, ogSlugLabel } from '@/lib/seo/og-text'
import { ogBrandLabel, ogShareCard } from '@/lib/seo/og-card'
import { loadSceneDetail } from '@/lib/server/scenes'

/**
 * 场景落地页动态 OG 分享卡片（1200×630）。
 *
 * 与页面同一取数（loadSceneDetail）：站点数是接口按真实召回算的，
 * 取不到就只写通用文案，不在分享卡上留确定性的假数字。
 * 场景 id 本身是 ASCII slug（make-ppt 等），Satori 可直接渲染；
 * 中文标题走 ogBrandLabel 的品牌回退，不硬塞中文给 Satori。
 */

export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE
export const alt = '山羊胡场景包分享卡片'

export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const safeId = safeDecodeParam(id) ?? id
  const probe = await loadSceneDetail(safeId, 3600)
  const scene = probe.status === 'ok' ? probe.data.scene : null
  const brand = await ogBrandLabel()
  const hero = ogBestLabel([ogSlugLabel(safeId)]) || 'SCENES'

  return new ImageResponse(
    ogShareCard({
      brand,
      sectionLabel: 'SCENE PACKS',
      kindPill: 'SCENE',
      hero,
      metaLine:
        scene && scene.siteCount > 0
          ? `${scene.steps.length} steps, ${scene.siteCount} sites that open right away`
          : 'step-by-step sites for getting one thing done',
      footnote: 'Real sites for every step, in order',
      cta: 'Open scene',
    }),
    { ...OG_IMAGE_SIZE },
  )
}
