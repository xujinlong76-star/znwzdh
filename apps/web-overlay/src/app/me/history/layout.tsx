import type { Metadata } from 'next'

/** 搜索历史是私密页面：不进索引，标题独立于父级用户中心 */
export const metadata: Metadata = {
  title: '搜索历史',
  description: '管理与清理本机或账号下的搜索历史记录',
  robots: { index: false, follow: true },
}

export default function SearchHistoryLayout({ children }: { children: React.ReactNode }) {
  return children
}
