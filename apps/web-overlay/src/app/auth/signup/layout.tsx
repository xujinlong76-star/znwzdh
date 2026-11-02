import type { Metadata } from 'next'

/**
 * 注册页标题。
 *
 * 页面本身是客户端组件（需要交互与 fetch），无法导出 metadata，
 * 因此由这一层 server layout 提供标题（见 test/route-titles.test.ts 的约定）。
 */
export const metadata: Metadata = {
  title: '注册账号',
  description: '创建账号，注册后即可云端同步收藏',
  robots: { index: false, follow: true },
}

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
