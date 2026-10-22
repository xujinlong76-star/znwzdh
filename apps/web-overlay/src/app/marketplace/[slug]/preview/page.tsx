import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { safeDecodeParam } from '@/lib/server/route-params'
import PluginDetailView from '../plugin-detail-view'

/**
 * 插件预览通道（作者/管理员）。
 *
 * 详情页 SSR 没有浏览器身份：anonId 存在 localStorage，服务端请求不带
 * `X-Navhub-Anon-Id`，中枢对 pending/rejected/delisted/quarantined 只能返回 404。
 * 因此这里跳过服务端存在性判定，直接交给客户端带身份取数，真正的可见性仍由
 * API 的 owner/admin 门禁决定。
 *
 * 为什么单独一条路由而不是 `?preview=1`：主路由要进按需 ISR，而 `searchParams`
 * 出现在 page/generateMetadata 签名里就会让整条路由退回逐请求渲染。
 *
 * `force-dynamic` 是刻意的：预览看的是自己刚提交的版本，不该命中 60 秒缓存；
 * 这条路由 noindex，不参与收录，缓存收益为零。
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  if (!safeDecodeParam(slug)) notFound()
  return {
    title: '插件预览',
    description: '仅作者与管理员可见的插件预览',
    robots: { index: false, follow: false },
  }
}

export default async function PluginPreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  return <PluginDetailView slug={safeSlug} />
}
