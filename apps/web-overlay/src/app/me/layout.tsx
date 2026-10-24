import type { Metadata } from 'next'
import { UserCenterNav } from '@/components/user-center/user-center-nav'

/**
 * 用户中心是私密页面：不进搜索索引，但保留 follow（页面内的公开链接仍可爬）。
 *
 * 布局（美化批次）：子导航 sticky 吸顶——历史/数据这类长页面滚动时入口常驻；
 * 吸顶层用「实底渐隐」背景 + 下缘留白，内容从导航下方滑过时不会从缝隙里透出。
 */
export const metadata: Metadata = {
  title: '用户中心',
  description: '账号、收藏、搜索历史、个性化偏好与数据管理',
  robots: { index: false, follow: true },
}

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* 子导航与页面同宽；放在 main 之外，读屏可当作独立导航地标。 */}
      <div className="sticky top-0 z-30 mx-auto w-full max-w-(--breakpoint-2xl) bg-gradient-to-b from-background via-background/95 to-transparent px-3 py-2 pt-3 sm:px-6 sm:pt-4 md:px-8 lg:px-10 xl:px-12">
        <UserCenterNav />
      </div>
      {children}
    </>
  )
}
