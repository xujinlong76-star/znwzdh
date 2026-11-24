import type { Metadata } from 'next'

// 自愈周期（ISR 3600s）：本段页面是静态外壳（'use client'，数据都在客户端），
// 路由段配置由这层 server layout 承载。缺 NAVHUB_SITE_URL 的构建会把
// http://localhost:3000 兜底地址（canonical/og:url/og:image/JSON-LD）烤进
// revalidate=false 的永久快照，被 check-isr-routes.mjs 判红；按门禁提示
// 「给它 revalidate」补一份自愈周期即可。生产配了 NAVHUB_SITE_URL 时行为不变。
export const revalidate = 3600

export const metadata: Metadata = {
  title: '我的插件与发布作品',
  description: '查看与维护我创建、投稿和管理的插件与版本更新',
  robots: { index: false, follow: true },
}

export default function MarketplaceMineLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
