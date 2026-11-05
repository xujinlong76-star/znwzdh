import type { Metadata } from 'next'

/** 邮箱验证页标题（客户端组件，标题由本 layout 提供）。 */
export const metadata: Metadata = {
  title: '邮箱验证',
  description: '验证你的邮箱以激活账号',
  robots: { index: false, follow: true },
}

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
