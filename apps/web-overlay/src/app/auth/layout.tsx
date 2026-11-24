import type { Metadata } from 'next'

/**
 * /auth/* 的共享布局。
 *
 * 注册 / 验证 / 忘记密码 / 重置密码都是客户端组件（需要交互与 fetch），
 * 无法导出 metadata，因此由这一层 server layout 统一提供标题与 noindex。
 * /auth/signin 有自己的 layout，会覆盖这里的标题。
 */
// 自愈周期（ISR 3600s）：本页是静态外壳（数据都在客户端）。缺 NAVHUB_SITE_URL 的
// 构建会把 http://localhost:3000 兜底地址（canonical/og:url/og:image/JSON-LD）烤进
// revalidate=false 的永久快照，被 check-isr-routes.mjs 判红；按门禁提示「给它 revalidate」
// 补一份自愈周期即可。生产配置了 NAVHUB_SITE_URL 时地址本就正确，行为不变。
export const revalidate = 3600

export const metadata: Metadata = {
  title: '账户',
  description: '账号',
  robots: { index: false, follow: true },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
