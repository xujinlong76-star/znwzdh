import type { Metadata } from 'next'

/**
 * 收藏回收站是用户侧视图：标题只写页面名，站点名由根 layout 的
 * title.template 统一追加；page.tsx 是客户端组件（'use client'），
 * 无法导出 metadata，因此由这一层 server layout 提供（与
 * /favorites/stale/layout.tsx 同一范式）。
 */
export const metadata: Metadata = {
  title: '收藏回收站',
  description: '删除的收藏保留 30 天：恢复，或彻底删除',
  robots: { index: false, follow: true },
}

export default function TrashFavoritesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
