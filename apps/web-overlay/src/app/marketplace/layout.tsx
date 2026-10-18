import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '插件市场',
  description: '声明式网址包、工作台预设与个性化配色主题扩展中心',
}

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
