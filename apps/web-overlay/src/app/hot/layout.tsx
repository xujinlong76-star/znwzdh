import type { Metadata } from 'next'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 标题只写页面名 —— 站点名由根 layout 的 title.template 统一追加，
 * 这里再拼一次品牌名会渲染成「今日热榜 - NavHub - NavHub」。
 */
export const metadata: Metadata = {
  title: '今日热榜',
  description: '按热度排序的热门站点与资源',
}

export default function HotLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
