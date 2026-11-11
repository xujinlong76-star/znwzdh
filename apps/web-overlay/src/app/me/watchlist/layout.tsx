import type { Metadata } from 'next'

/** 追剧清单是私密页面：不进索引，标题独立于父级用户中心 */
export const metadata: Metadata = {
  title: '追剧清单',
  description: '在追的剧、观看进度与更新提醒：按你标注的节奏，到更新日在站内提醒。',
  robots: { index: false, follow: true },
}

export default function WatchlistLayout({ children }: { children: React.ReactNode }) {
  return children
}
