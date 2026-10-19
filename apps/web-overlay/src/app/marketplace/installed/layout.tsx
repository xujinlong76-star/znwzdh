import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '已安装插件管家',
  description: '管理已安装的声明式网址包、工作台预设、搜索引擎与配色主题',
}

export default function MarketplaceInstalledLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
