import type { Metadata } from 'next'
import { pageShareMetadata } from '@/lib/seo/metadata'

/**
 * og:url 可安全写在这里：[slug] 与 author/[key] 都在自己的 generateMetadata
 * 里定义了 openGraph.url（会覆盖本层），其余子路由（mine/publish/installed/
 * import）都是 noindex 私密页。
 *
 * 走工厂而不是裸 openGraph：Next 对 openGraph 是整体替换，裸写 `{ url }`
 * 会让本层与未覆盖的子路由丢掉 type/siteName/locale/images。
 */
export async function generateMetadata(): Promise<Metadata> {
  const title = '插件市场'
  const description = '声明式网址包、工作台预设与个性化配色主题扩展中心'
  return {
    title,
    description,
    ...(await pageShareMetadata({ url: '/marketplace', title, description })),
  }
}

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
