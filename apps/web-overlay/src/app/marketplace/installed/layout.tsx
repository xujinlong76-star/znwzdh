import type { Metadata } from 'next'

// 自愈周期（ISR 3600s）：缺 NAVHUB_SITE_URL 的构建会把 http://localhost:3000 兜底地址
// 烤进 revalidate=false 的永久快照（check-isr-routes.mjs 判红）；按门禁提示「给它
// revalidate」补一份自愈周期。生产配了 NAVHUB_SITE_URL 时地址本就正确，行为不变。
export const revalidate = 3600

export const metadata: Metadata = {
  title: '已安装插件管家',
  description: '管理已安装的声明式网址包、工作台预设、搜索引擎与配色主题',
  robots: { index: false, follow: true },
}

export default function MarketplaceInstalledLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
