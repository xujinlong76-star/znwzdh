import type { Metadata } from 'next'

/** 重置密码页标题（客户端组件，标题由本 layout 提供）。 */
export const metadata: Metadata = {
  title: '重置密码',
  description: '为你的账号设置新密码',
  robots: { index: false, follow: true },
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
