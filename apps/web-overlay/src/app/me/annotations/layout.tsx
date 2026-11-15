import type { Metadata } from 'next'

/**
 * 我的批注是私密页面：不进索引，标题独立于父级用户中心。
 * 页面本身是客户端组件（读本机 localStorage 批注），不能导出 metadata，
 * 用同目录 layout 提供。
 */
export const metadata: Metadata = {
  title: '我的批注',
  description: '在收藏标题与简介上划过的线、写下的批注，按收藏聚合，可搜索、可导出',
  robots: { index: false, follow: true },
}

export default function MyAnnotationsLayout({ children }: { children: React.ReactNode }) {
  return children
}
