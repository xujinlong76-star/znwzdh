import type { Metadata } from 'next'

/** 通知是私密页面：不进索引，标题独立于父级用户中心 */
export const metadata: Metadata = {
  title: '通知',
  description: '同步失败、备份提醒等站内消息，只发给登录用户自己的身份。',
  robots: { index: false, follow: true },
}

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return children
}
