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
  // K8：市场全域挂点按区作用域，小屏可点元素最小边 ≥44px
  // P2-16：市场页底部安全区——滚到底时页脚内容不再贴着文档底边：
  //   <640px 时页脚自带 pb 5.5rem 只够让出版权行躲开 56px 底栏，猫（bottom 68px +
  //   88px 高，顶部在视口底上 156px 处）仍会盖住版权行右半；这里在页脚之下再垫 5rem
  //   （含安全区），合计 168px > 156px，版权行与备案链接滚到底也完整可见可点。
  //   ≥640px 页脚三段底垫已够（底栏 56px / 半屏下沉栏 4.5rem），猫侧另有 P2-16
  //   避让，不再加垫。
  return <div className="market-touch pb-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:pb-0">{children}</div>
}
