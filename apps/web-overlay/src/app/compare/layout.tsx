import type { Metadata } from 'next'

/**
 * /compare 的共享布局。
 *
 * 对照页是客户端组件（要读 searchParams + 懒加载对照表），无法导出 metadata，
 * 因此由这一层 server layout 统一提供标题与 noindex（同款先例：
 * `app/auth/layout.tsx`）。对照结果是私人数据：`noindex, nofollow`，
 * 不进 sitemap、不进底栏导航。
 */
// 自愈周期（ISR 3600s）：本段页面是静态外壳（'use client'，数据都在客户端），
// 路由段配置由这层 server layout 承载。缺 NAVHUB_SITE_URL 的构建会把
// http://localhost:3000 兜底地址（canonical/og:url/og:image/JSON-LD）烤进
// revalidate=false 的永久快照，被 check-isr-routes.mjs 判红；按门禁提示
// 「给它 revalidate」补一份自愈周期即可。生产配了 NAVHUB_SITE_URL 时行为不变。
export const revalidate = 3600

export const metadata: Metadata = {
  title: '横向对比',
  description: '并排对照我收藏的 2–4 个同类站点：计费、平台、形态、维护状态与我的备注。',
  robots: { index: false, follow: false },
}

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
