import type { Metadata } from 'next'

/**
 * /verify 的共享布局。
 *
 * 比对页是客户端组件（要读 searchParams），无法导出 metadata，因此由
 * 这一层 server layout 统一提供标题与 noindex（同款先例：
 * `app/compare/layout.tsx`）。拦截页不进搜索、不进 sitemap、不进底栏导航。
 */
export const metadata: Metadata = {
  title: '核对官网域名',
  description: '对照已核实的官网域名与你点的域名：逐字对照、安全查询原样转述，不作自封的安全结论。',
  robots: { index: false, follow: false },
}

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
