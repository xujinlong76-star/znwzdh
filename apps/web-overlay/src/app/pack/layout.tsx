import type { Metadata } from 'next'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供（与 /favorites 同款做法）。
 *
 * 标题只写页面名 —— 站点名由根 layout 的 title.template 统一追加。
 * robots 不索引：包内容全在链接 hash 里，页面本身没有静态内容可索引。
 */
export const metadata: Metadata = {
  title: '链接包',
  description: '别人分享给你的站点清单快照：标题、备注与每站一句话用途，发出后内容不再更新。',
  robots: { index: false, follow: true },
}

export default function LinkPackLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
