import type { Metadata } from 'next'

/** 忘记密码页标题（客户端组件，标题由本 layout 提供）。 */
export const metadata: Metadata = {
  title: '找回密码',
  description: '输入注册邮箱，接收重置链接',
  robots: { index: false, follow: true },
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
