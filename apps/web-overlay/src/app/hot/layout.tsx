import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { Breadcrumbs } from '@/components/breadcrumbs'

/**
 * 标题层：`page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层 server layout 提供。
 *
 * 标题只写页面名 —— 站点名由根 layout 的 title.template 统一追加，
 * 这里再拼一次品牌名会渲染成「今日热榜 - NavHub - NavHub」。
 *
 * 面包屑挂 layout（不是 page）：page 是客户端组件，挂不上服务端
 * Breadcrumbs；layout 的渲染结果进 SSR HTML，爬虫首轮即可见。
 */
export const metadata: Metadata = {
  title: '今日热榜',
  description: '按热度排序的热门站点与资源',
  // /hot 是叶子路由（无子路由），og:url 不会被子页面错误继承
  openGraph: { url: '/hot' },
}

export default function HotLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Container 默认渲染 div，与页面主体左右对齐（同 tags/[slug]/layout 模式） */}
      <Container className="pt-4">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '今日热榜', path: '/hot' },
          ]}
        />
      </Container>
      {children}
    </>
  )
}
