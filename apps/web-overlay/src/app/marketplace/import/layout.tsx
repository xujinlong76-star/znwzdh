import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '导入插件',
  description: '拖拽或粘贴声明式插件清单并直接上架到本机',
  robots: { index: false, follow: true },
}

export default function MarketplaceImportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
