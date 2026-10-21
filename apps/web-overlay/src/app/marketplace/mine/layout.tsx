import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '我的插件与发布作品',
  description: '查看与维护我创建、投稿和管理的插件与版本更新',
  robots: { index: false, follow: true },
}

export default function MarketplaceMineLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
