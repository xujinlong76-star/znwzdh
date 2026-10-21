import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { hubGetProbe } from '@/lib/server/hub'

/**
 * 合集详情的 server layout：metadata + 真 404 + 面包屑。
 * `page.tsx` 是客户端组件（'use client'），无法导出 metadata，
 * 因此由这一层提供。
 *
 * 为什么从静态 `title: '合集详情'` 改成 generateMetadata（2026-10-21）：
 * 静态标题让全部合集详情页共享同一个 <title>（重复 title 问题的成员），
 * 而且「合集名在客户端才知道」自中枢提供 `/api/collections/:slug` 起
 * 已不成立——服务端拿 slug 现取现用。
 *
 * 真 404（软 404 消灭战）：`hubGetProbe` 把「API 确认不存在（404）」与
 * 「取数失败」分开——只有确认不存在才 notFound()；中枢挂了返回降级
 * 元数据、页面照常渲染（客户端岛负责降级提示）。用 hubGet 做存在性
 * 判定会把网络抖动误伤成 404。
 *
 * 面包屑挂 layout 而不是 page：page 要挂客户端岛，挂不上服务端
 * Breadcrumbs；layout 的渲染结果进 SSR HTML，爬虫首轮即可见。
 *
 * 别往这里加 `alternates.canonical`：合集详情 canonical 归一属于
 * Phase 2 家族，不在这轮改动里。
 */
type CollectionMeta = {
  collection: { slug: string; title: string; description: string | null }
}

async function loadCollection(slug: string) {
  return hubGetProbe<CollectionMeta>('/api/collections/' + encodeURIComponent(slug), 60)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const safeSlug = decodeURIComponent(slug)
  const probe = await loadCollection(safeSlug)
  // 404 判定放在 generateMetadata 里（不在 layout 渲染体）：布局主体运行在
  // 自身 NotFoundBoundary **之外**，渲染体里抛 notFound() 会向上穿透成
  // error 边界捕获（实测 200 + NEXT_HTTP_ERROR_FALLBACK 客户端回退）；
  // metadata 管线的 notFound() 走的是正规 not-found 路径。
  if (probe.status === 'miss') notFound()
  if (probe.status === 'failed') {
    // 降级：不编造合集名，用通用标题（与改版前一致）
    return { title: '合集详情', description: '该合集收录的站点' }
  }
  const col = probe.data.collection
  return {
    title: col.title,
    description: col.description || `「${col.title}」合集收录的站点，按策划顺序排列，可进入详情查看简介、分类与标签。`,
  }
}

export default async function CollectionDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const safeSlug = decodeURIComponent(slug)
  const probe = await loadCollection(safeSlug)
  // 渲染体不再判 404（见 generateMetadata 注释）；miss 时 metadata 已把
  // 整个路由翻成 404，到不了这里的正常渲染。
  const name = probe.status === 'ok' ? probe.data.collection.title : safeSlug
  return (
    <>
      {/* 面包屑与 JSON-LD 同源；Container 默认渲染 div，与页面主体左右对齐 */}
      <Container className="pt-4">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '合集', path: '/collections' },
            { label: name, path: `/collections/${encodeURIComponent(safeSlug)}` },
          ]}
        />
      </Container>
      {children}
    </>
  )
}
