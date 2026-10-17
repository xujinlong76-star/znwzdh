import type { Metadata } from 'next'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 合集名在客户端才知道，所以这里只给通用标题（不编造具体合集名）。
 */
export const metadata: Metadata = {
  title: '合集详情',
  description: '该合集收录的站点',
}

export default function CollectionDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
