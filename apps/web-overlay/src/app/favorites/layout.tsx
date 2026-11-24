import type { Metadata } from 'next'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 标题只写页面名 —— 站点名由根 layout 的 title.template 统一追加。
 */
// 自愈周期（ISR 3600s）：本页是静态外壳（数据都在客户端）。缺 NAVHUB_SITE_URL 的
// 构建会把 http://localhost:3000 兜底地址（canonical/og:url/og:image/JSON-LD）烤进
// revalidate=false 的永久快照，被 check-isr-routes.mjs 判红；按门禁提示「给它 revalidate」
// 补一份自愈周期即可。生产配置了 NAVHUB_SITE_URL 时地址本就正确，行为不变。
export const revalidate = 3600

export const metadata: Metadata = {
  title: '我的收藏',
  description: '你收藏的站点',
  robots: { index: false, follow: true },
}

export default function FavoritesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
