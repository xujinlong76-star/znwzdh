import type { Metadata } from 'next'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 标签名在客户端才知道，所以这里只给通用标题（不编造具体标签名）。
 */
export const metadata: Metadata = {
  title: '标签详情',
  description: '该标签下的站点列表',
}

export default function TagDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
