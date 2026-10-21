import type { Metadata } from 'next'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 站点名在客户端才知道，所以这里只给通用标题（不编造具体站点名）。
 */
export const metadata: Metadata = {
  title: '站点详情',
  description: '官网入口、一句话简介与所属分类',
}

export default function SiteDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
