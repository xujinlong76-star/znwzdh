'use client'

import dynamic from 'next/dynamic'
import type { DramaCategoryBannerProps } from './drama-category-banner'

const DramaCategoryBanner = dynamic(
  () => import('./drama-category-banner').then((m) => m.DramaCategoryBanner),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border border-amber-500/25 bg-zinc-950 text-zinc-100 p-4 sm:p-5 text-xs">
        正在加载短剧专区导览与追剧状态…
      </div>
    ),
  },
)

/**
 * 短剧专区顶部横幅的按需加载包装：保持通用 /category/[slug] 路由 JS 体积在预算内。
 */
export function DramaCategoryBannerLazy(props: DramaCategoryBannerProps) {
  return <DramaCategoryBanner {...props} />
}
