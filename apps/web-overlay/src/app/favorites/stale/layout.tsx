import type { Metadata } from 'next'

/**
 * 「好久没打开」是本机收藏的分拣视图：标题只写页面名，站点名由根 layout
 * 的 title.template 统一追加；用户数据不进索引。
 */
export const metadata: Metadata = {
  title: '好久没打开',
  description: '超过 90 天没有打开的收藏：重开、归档或删除',
  robots: { index: false, follow: true },
}

export default function StaleFavoritesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
