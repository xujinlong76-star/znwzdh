import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '作者主页与插件作品',
  description: '查看该作者在插件市场公开发布的全部插件与主页资料',
}

export default function MarketplaceAuthorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
