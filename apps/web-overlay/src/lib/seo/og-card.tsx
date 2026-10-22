import type { ReactElement } from 'react'
import { loadBrandName } from '@/lib/seo/metadata'
import { ogAscii } from '@/lib/seo/og-text'

/**
 * 分享卡（OG 图）的统一构图。文本口径与尺寸常量在 `og-text.ts`。
 *
 * 五类页面（站点详情 / 分类 / 标签 / 专题 / 插件）共用这一份版式：
 * 渐变底 + 装饰光斑 + 品牌行 + 主标题 + 统计行 + 行动块。Satori 只认
 * flex 布局与内联样式，所以这里不能出现 className、也不能依赖 CSS 变量。
 *
 * 主标题超过 HERO_WRAP_LEN 会降字号：域名和长英文产品名不该折到第三行。
 */

const HERO_WRAP_LEN = 22

/** 卡片上的品牌词：site.json 的标题常含中文，过滤后为空则退回产品名 */
export async function ogBrandLabel(): Promise<string> {
  return ogAscii(await loadBrandName(), 24) || 'NavHub'
}

export interface OgCardProps {
  /** 品牌名：与根布局 og:site_name 同源（site.json 的 basic.title） */
  brand: string
  /** 品牌行第二行的小标签，如 SITE DIRECTORY / PLUGIN MARKETPLACE */
  sectionLabel: string
  /** 右上角胶囊：内容类型（CATEGORY / TAG / THEME…） */
  kindPill?: string | null
  /** 主标题（必须 ASCII） */
  hero: string
  /** 主标题下方一行（通常是域名） */
  subline?: string | null
  /** 统计行：站点数 / 安装数 / 标签数 */
  metaLine?: string | null
  /** 底部说明行 */
  footnote: string
  /** 右下行动块 */
  cta?: string | null
}

export function ogShareCard(props: OgCardProps): ReactElement {
  const { brand, sectionLabel, kindPill, hero, subline, metaLine, footnote, cta } = props
  const heroSize = hero.length > HERO_WRAP_LEN ? 54 : 74

  return (
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
            {ogAscii(brand, 1) || 'N'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 0.5 }}>{brand}</div>
            <div style={{ fontSize: 18, opacity: 0.75, letterSpacing: 3 }}>{sectionLabel}</div>
          </div>
        </div>
        {kindPill ? (
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
            {kindPill}
          </div>
        ) : null}
      </div>

      {/* 中部主信息 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ fontSize: heroSize, fontWeight: 700, lineHeight: 1.1 }}>{hero}</div>
        {subline ? <div style={{ fontSize: 34, opacity: 0.92, letterSpacing: 0.5 }}>{subline}</div> : null}
        {metaLine ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 28, opacity: 0.9 }}>
            <span>{metaLine}</span>
          </div>
        ) : null}
      </div>

      {/* 底部行动行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 24, opacity: 0.8 }}>{footnote}</div>
        {cta ? (
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
            {cta}
          </div>
        ) : null}
      </div>
    </div>
  )
}
