import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { Breadcrumbs } from '@/components/breadcrumbs'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 标签名在客户端才知道，所以这里只给通用标题（不编造具体标签名）。
 *
 * 面包屑为什么挂 layout 而不是 page：page 是客户端组件，挂不上服务端
 * Breadcrumbs；且 layout 的渲染结果**在 SSR HTML 里**（客户端页面
 * useEffect 取数不影响 layout 直出），爬虫首轮即可见。
 *
 * 别往这个中间层 layout 加 `alternates.canonical`：会被子路由继承，
 * 全部标签页 canonical 到同一个地址（继承陷阱，与 /tags、/collections
 * 中间层不加 canonical 同一理由）。
 */
export const metadata: Metadata = {
  title: '标签详情',
  description: '该标签下的站点列表',
}

export default async function TagDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const safeSlug = decodeURIComponent(slug)
  return (
    <>
      {/* 面包屑与 JSON-LD 同源；Container 默认渲染 div，与页面主体左右对齐 */}
      <Container className="pt-4">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '标签云', path: '/tags' },
            { label: safeSlug, path: `/tags/${encodeURIComponent(safeSlug)}` },
          ]}
        />
      </Container>
      {children}
    </>
  )
}
