import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '投稿发布插件',
  description: '向社区投稿发布声明式网址包、工作台预设与配色主题',
}

export default function MarketplacePublishLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
