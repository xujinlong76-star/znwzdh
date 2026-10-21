import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '插件市场',
  description: '声明式网址包、工作台预设与个性化配色主题扩展中心',
  // og:url 可安全写在这里：唯一有 og:url 需求的子路由 [slug] 在自己的
  // generateMetadata 里定义了 openGraph.url（会覆盖本层），
  // 其余子路由（mine/publish/installed/import）都是 noindex 私密页。
  openGraph: { url: '/marketplace' },
}

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
