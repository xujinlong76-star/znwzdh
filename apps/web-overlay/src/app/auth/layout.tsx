import type { Metadata } from 'next'

/**
 * /auth/* 的共享布局。
 *
 * 注册 / 验证 / 忘记密码 / 重置密码都是客户端组件（需要交互与 fetch），
 * 无法导出 metadata，因此由这一层 server layout 统一提供标题与 noindex。
 * /auth/signin 有自己的 layout，会覆盖这里的标题。
 */
export const metadata: Metadata = {
  title: '账户',
  description: '账号',
  robots: { index: false, follow: true },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
