'use client'

/**
 * SearchPalette 的懒加载包装（全站统一入口）。
 *
 * SearchPalette 本体约 1,500 行，还拖着收藏 / 偏好 / 语义 / 对比 / 特征掩码
 * 一串依赖；它只是一个「点开才用」的搜索框，却被工具栏与各内容页静态引入，
 * 于是随 /、/hot、/collections/[slug]、/tags/[slug]、/category/[slug] 的
 * 首屏一起下发（2026-11-11 实测这 5 条路由全部超首屏预算，量级与本组件吻合）。
 * 此前只有 not-found.tsx 单独做了 dynamic，这里收成全站一份：
 * 客户端按需加载，加载期间用同高占位保持布局不跳（与 not-found 的占位同尺寸）。
 */
import dynamic from 'next/dynamic'
import type { SiteConfig } from '@/types/site'

const SearchPalette = dynamic(
  () => import('@/components/search-palette').then((m) => m.SearchPalette),
  {
    ssr: false,
    loading: () => (
      <div className="h-11 rounded-xl border border-border/60 bg-muted/30" aria-busy="true">
        <span className="sr-only">正在加载搜索面板…</span>
      </div>
    ),
  }
)

export function SearchPaletteLazy(props: {
  siteConfig?: SiteConfig
  categoryId?: string
  placeholder?: string
}) {
  return <SearchPalette {...props} />
}
