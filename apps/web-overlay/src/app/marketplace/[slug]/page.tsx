import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { safeDecodeParam } from '@/lib/server/route-params'
import { loadPluginDetail } from '@/lib/server/plugin-detail'
import { pageShareMetadata } from '@/lib/seo/metadata'
import PluginDetailView from './plugin-detail-view'

/**
 * 插件详情服务端入口。
 *
 * 两件事必须留在服务端：
 * 1. 存在性判定：API 确认 404 才 notFound()；中枢失败继续降级渲染，
 *    否则一次抖动会把整批插件页误伤成 404。
 * 2. 首屏与 metadata：名称/描述/canonical 进 SSR HTML，客户端视图只负责
 *    安装、星标、评论等交互；它仍会静默刷新一次以补齐 identity 相关状态。
 *
 * og/twitter 走 pageShareMetadata 工厂：Next 的 metadata 合并里子层
 * `openGraph` 对象**整体替换**根布局同名字段——裸 `openGraph: { url }`
 * 会让 165 个插件页丢失 og:image/type/site_name/locale（运行时审计实测）。
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()

  const probe = await loadPluginDetail(safeSlug)
  if (probe.status === 'miss') notFound()

  const canonical = `/marketplace/${encodeURIComponent(safeSlug)}`
  if (probe.status === 'failed') {
    return {
      title: '插件详情与安装',
      description: '查看插件声明式清单明细、实时预览与一键安装',
      alternates: { canonical },
      ...(await pageShareMetadata({ url: canonical, title: '插件详情与安装' })),
    }
  }

  const plugin = probe.data.plugin
  const title = `「${plugin.name}」· 插件市场`
  const description = (plugin.description || '查看插件声明式清单明细、实时预览与一键安装').slice(0, 160)
  return {
    title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({ url: canonical, title, description })),
  }
}

export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()

  const probe = await loadPluginDetail(safeSlug)
  if (probe.status === 'miss') notFound()

  return (
    <PluginDetailView
      slug={safeSlug}
      initialPlugin={probe.status === 'ok' ? probe.data.plugin : null}
      initialSummary={probe.status === 'ok' ? probe.data.summary : null}
    />
  )
}
