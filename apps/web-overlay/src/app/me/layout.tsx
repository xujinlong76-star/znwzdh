import type { Metadata } from 'next'
import { UserCenterNav } from '@/components/user-center/user-center-nav'

/**
 * 用户中心是私密页面：不进搜索索引，但保留 follow（页面内的公开链接仍可爬）。
 */
export const metadata: Metadata = {
  title: '用户中心',
  description: '账号、收藏、搜索历史、个性化偏好与数据管理',
  robots: { index: false, follow: true },
}

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* 子导航与页面同宽；放在 main 之外，读屏可当作独立导航地标。
          顶部只留 12~20px：页面自身还有 pt-3/pt-4，两者相加才是导航与页头的间距。 */}
      <div className="mx-auto w-full max-w-(--breakpoint-2xl) px-3 pt-3 sm:px-6 sm:pt-5 md:px-8 lg:px-10 xl:px-12">
        <UserCenterNav />
      </div>
      {children}
    </>
  )
}
