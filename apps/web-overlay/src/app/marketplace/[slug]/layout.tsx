import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '插件详情与安装',
  description: '查看插件声明式清单明细、实时预览与一键安装',
}

export default function MarketplaceDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
