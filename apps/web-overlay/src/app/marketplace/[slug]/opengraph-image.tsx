import { ImageResponse } from 'next/og'
import { safeDecodeParam } from '@/lib/server/route-params'
import { loadPluginDetail } from '@/lib/server/plugin-detail'
import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE, ogAscii } from '@/lib/seo/og-text'
import { ogBrandLabel, ogShareCard } from '@/lib/seo/og-card'

/**
 * 插件详情页动态 OG 分享卡片（1200×630）。
 *
 * 设计取舍（见 docs/PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md · D3）：
 * - Satori 渲染中文需要显式字体子集，首版采用「ASCII 安全」构图：品牌词、
 *   类型英文标签、版本号与统计数字全部为拉丁字符，零字体依赖、零外网请求；
 * - 插件中文名过滤为非 ASCII 后可能为空，此时回退展示 slug（保证画面信息量）；
 * - 任一取数失败都回退通用卡片，绝不阻塞社交分享预览。
 *
 * 构图本体在 `lib/seo/og-card.tsx`（五类页面共用一套视觉语言）。
 * 本文件只负责取数与文案映射。
 */

export const size = OG_IMAGE_SIZE
export const contentType = OG_IMAGE_CONTENT_TYPE
export const alt = '山羊胡插件市场分享卡片'

const KIND_EN: Record<string, string> = {
  'site-pack': 'SITE PACK',
  'workspace-preset': 'WORKSPACE PRESET',
  theme: 'THEME',
  bundle: 'BUNDLE',
}

interface CardData {
  kind: string
  version: string
  asciiName: string
  installs: number
  statLine: string
}

async function loadCardData(slug: string): Promise<CardData | null> {
  const probe = await loadPluginDetail(slug)
  if (probe.status !== 'ok') return null
  const plugin = probe.data.plugin
  const summary = probe.data.summary
  const kind = typeof plugin.kind === 'string' ? plugin.kind : 'site-pack'
  const version = typeof plugin.version === 'string' ? plugin.version : '1.0.0'
  const rawName = typeof plugin.name === 'string' ? plugin.name : ''
  // Satori 默认字体不含 CJK：过滤出 ASCII 片段，为空则回退 slug
  const asciiName = ogAscii(rawName) || slug
  const installs = Number(plugin.installCount ?? 0) || 0
  const siteCount = Number(summary?.siteCount ?? 0) || 0
  const tokenCount = Number(summary?.themeTokenCount ?? 0) || 0
  const statLine =
    kind === 'theme'
      ? `${tokenCount} design tokens`
      : kind === 'site-pack'
        ? `${siteCount} curated sites`
        : 'workbench boards & widgets'
  return { kind, version, asciiName: asciiName.slice(0, 42), installs, statLine }
}

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug) ?? slug
  const data = await loadCardData(safeSlug)
  const brand = await ogBrandLabel()

  return new ImageResponse(
    ogShareCard({
      brand,
      sectionLabel: 'PLUGIN MARKETPLACE',
      kindPill: data ? (KIND_EN[data.kind] ?? 'PLUGIN') : 'PLUGIN',
      hero: data?.asciiName ?? safeSlug.slice(0, 42),
      metaLine: data
        ? `v${data.version} · ${data.statLine} · ${data.installs} installs`
        : 'declarative plugins for Shanyanghu',
      footnote: 'Declarative & auditable — no arbitrary code execution',
      cta: 'One-click install',
    }),
    { ...OG_IMAGE_SIZE },
  )
}
