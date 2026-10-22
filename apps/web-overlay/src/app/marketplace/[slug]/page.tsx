import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { safeDecodeParam } from '@/lib/server/route-params'
import { loadPluginDetail } from '@/lib/server/plugin-detail'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { ogImageUrl } from '@/lib/seo/og-text'
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
 *
 * 预览通道在 `./preview/page.tsx`，不在这里读 `searchParams`：一旦
 * page/generateMetadata 签名里出现 searchParams，Next 就把整条路由当成逐请求
 * 渲染，`revalidate` 形同虚设（`/category/{slug}` 的分页也因同一约束拆成了 `/p/{n}`）。
 * 旧的 `?preview=1` 链接由 next.config 的 redirects 兜到 `/preview`。
 */

export const revalidate = 60

/** 动态段要进入按需 ISR，必须有 generateStaticParams；空数组 = 全部首次请求时生成 */
export async function generateStaticParams() {
  return []
}

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
      ...(await pageShareMetadata({
        url: canonical,
        title: '插件详情与安装',
        description: '查看插件声明式清单明细、实时预览与一键安装',
      })),
    }
  }

  const plugin = probe.data.plugin
  const title = `「${plugin.name}」· 插件市场`
  const description = (plugin.description || '查看插件声明式清单明细、实时预览与一键安装').slice(0, 160)
  return {
    title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({
      url: canonical,
      title,
      description,
      // 本路由有 opengraph-image.tsx，但 Next 的优先级是 Metadata API 覆盖文件
      // 约定——不显式写 imageUrl，og:image 会退回工厂默认的 /og-default.png，
      // 动态卡变成永远没人请求的死路由（2026-10-22 实测）。
      imageUrl: ogImageUrl(canonical),
      imageAlt: `${plugin.name} · NavHub 插件市场`,
    })),
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
