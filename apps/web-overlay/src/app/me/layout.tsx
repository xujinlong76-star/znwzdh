import type { Metadata } from 'next'
import { UserCenterNav } from '@/components/user-center/user-center-nav'

/**
 * 用户中心是私密页面：不进搜索索引，但保留 follow（页面内的公开链接仍可爬）。
 *
 * 布局（美化批次）：子导航 sticky 吸顶——历史/数据这类长页面滚动时入口常驻；
 * 吸顶层用「实底渐隐」背景 + 下缘留白，内容从导航下方滑过时不会从缝隙里透出。
 */
// 自愈周期（ISR 3600s）：本页是静态外壳（数据都在客户端）。缺 NAVHUB_SITE_URL 的
// 构建会把 http://localhost:3000 兜底地址（canonical/og:url/og:image/JSON-LD）烤进
// revalidate=false 的永久快照，被 check-isr-routes.mjs 判红；按门禁提示「给它 revalidate」
// 补一份自愈周期即可。生产配置了 NAVHUB_SITE_URL 时地址本就正确，行为不变。
export const revalidate = 3600

export const metadata: Metadata = {
  title: '用户中心',
  description: '账号、收藏、搜索历史、个性化偏好与数据管理',
  robots: { index: false, follow: true },
}

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* 子导航与页面同宽；放在 main 之外，读屏可当作独立导航地标。
          高不透明实底 + 柔和毛玻璃 + 细底线，彻底防止滚屏时下方标题文字透字干扰。 */}
      <div className="sticky top-0 z-30 border-b border-border/50 bg-background/95 backdrop-blur-md">
        <div className="mx-auto w-full max-w-(--breakpoint-2xl) px-3 py-2 sm:px-6 sm:py-2.5 md:px-8 lg:px-10 xl:px-12">
          <UserCenterNav />
        </div>
      </div>
      {children}
    </>
  )
}
