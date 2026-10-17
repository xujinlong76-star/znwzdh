import type { Metadata } from 'next'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 标题只写页面名 —— 站点名由根 layout 的 title.template 统一追加。
 */
export const metadata: Metadata = {
  title: '合集',
  description: '按主题整理的站点合集',
}

export default function CollectionsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
