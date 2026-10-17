import type { Metadata } from 'next'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 标题只写页面名 —— 站点名由根 layout 的 title.template 统一追加。
 */
export const metadata: Metadata = {
  title: '标签总览',
  description: '按标签浏览全部站点，找到同一主题下的其它资源',
}

export default function TagsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
