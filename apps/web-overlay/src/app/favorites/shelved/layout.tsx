import type { Metadata } from 'next'

/**
 * 「已移出」是本机收藏的分拣视图：标题只写页面名，站点名由根 layout
 * 的 title.template 统一追加；page.tsx 是客户端组件（'use client'），
 * 无法导出 metadata，因此由这一层 server layout 提供（与
 * /favorites/stale/layout.tsx 同一范式）。
 */
export const metadata: Metadata = {
  title: '已移出',
  description: '移出待读箱的收藏：恢复到收藏夹，或放回待读箱',
  robots: { index: false, follow: true },
}

export default function ShelvedFavoritesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
