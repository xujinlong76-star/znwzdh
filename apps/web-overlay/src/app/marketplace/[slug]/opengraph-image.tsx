import { ImageResponse } from 'next/og'
import { safeDecodeParam } from '@/lib/server/route-params'
import { loadPluginDetail } from '@/lib/server/plugin-detail'

/**
 * 插件详情页动态 OG 分享卡片（1200×630）。
 *
 * 设计取舍（见 docs/PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md · D3）：
 * - Satori 渲染中文需要显式字体子集，首版采用「ASCII 安全」构图：品牌词、
 *   类型英文标签、版本号与统计数字全部为拉丁字符，零字体依赖、零外网请求；
 * - 插件中文名过滤为非 ASCII 后可能为空，此时回退展示 slug（保证画面信息量）；
 * - 任一取数失败都回退通用卡片，绝不阻塞社交分享预览。
 */

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'NavHub 插件市场分享卡片'

const KIND_EN: Record<string, string> = {
  'site-pack': 'SITE PACK',
  'workspace-preset': 'WORKSPACE PRESET',
  theme: 'THEME',
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
  const asciiName =
    rawName.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim() || slug
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
  const kind = data?.kind ?? 'site-pack'
  const version = data?.version ?? '1.0.0'
  const asciiName = data?.asciiName ?? safeSlug.slice(0, 42)
  const installs = data?.installs ?? 0
  const statLine = data?.statLine ?? 'declarative plugins for NavHub'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: 'linear-gradient(135deg, #160f34 0%, #4c1d95 45%, #7c3aed 78%, #6d28d9 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* 装饰光斑（Satori 兼容：仅定位 + 渐变 + 圆角） */}
        <div style={{ position: 'absolute', left: -150, top: -170, width: 380, height: 380, borderRadius: 999, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ position: 'absolute', right: -140, bottom: -180, width: 460, height: 460, borderRadius: 999, background: 'rgba(129,140,248,0.25)' }} />
        {/* 顶部品牌行 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: 'rgba(255,255,255,0.16)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 30,
                fontWeight: 700,
              }}
            >
              N
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 0.5 }}>NavHub</div>
              <div style={{ fontSize: 18, opacity: 0.75, letterSpacing: 3 }}>PLUGIN MARKETPLACE</div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              padding: '10px 22px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.14)',
              fontSize: 22,
              letterSpacing: 2,
            }}
          >
            {KIND_EN[kind] ?? 'PLUGIN'}
          </div>
        </div>

        {/* 中部主信息 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 74, fontWeight: 700, lineHeight: 1.1 }}>{asciiName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 28, opacity: 0.9 }}>
            <span>v{version}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{statLine}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{installs} installs</span>
          </div>
        </div>

        {/* 底部行动行 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 24, opacity: 0.8 }}>
            Declarative &amp; auditable — no arbitrary code execution
          </div>
          <div
            style={{
              display: 'flex',
              padding: '12px 26px',
              borderRadius: 14,
              background: '#ffffff',
              color: '#4c1d95',
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            One-click install
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
