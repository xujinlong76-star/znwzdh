import type { Metadata } from 'next'

/**
 * 用户中心是私密页面：不进搜索索引，但保留 follow（页面内的公开链接仍可爬）。
 */
export const metadata: Metadata = {
  title: '用户中心',
  description: '账号、收藏、搜索历史、个性化偏好与数据管理',
  robots: { index: false, follow: true },
}

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return children
}
