import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { siteOrigin } from '@/lib/seo/origin'
import { softwareApplicationLd } from '@/lib/seo/json-ld'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'

/**
 * 插件详情页 OG 元数据（分享短链落点预备，见设计文档 §八 P1-5）。
 *
 * 未来的分享短链服务（/s/xxx）会 302 到本路由，因此这里在服务端尽力
 * 取到插件名称 / 描述来生成分享卡片（title + description + openGraph），
 * 取不到（API 不可用 / hub 降级）时回退到通用文案，绝不阻塞渲染。
 */
async function loadPluginMeta(slug: string): Promise<{ name: string; description: string } | null> {
  try {
    const h = await headers()
    const host = h.get('host')
    if (!host) return null
    const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]!.trim()
    const res = await fetch(`${proto}://${host}/api/hub/plugins/${encodeURIComponent(slug)}`, {
      // 详情数据变化频繁，短缓存足够生成卡片且避免请求风暴
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { plugin?: { name?: unknown; description?: unknown } }
    const name = body.plugin?.name
    if (typeof name !== 'string' || !name) return null
    const description =
      typeof body.plugin?.description === 'string' && body.plugin.description
        ? body.plugin.description
        : 'NavHub 插件市场：声明式插件，一键安装即用。'
    return { name: name.slice(0, 60), description: description.slice(0, 160) }
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const meta = await loadPluginMeta(slug)
  if (!meta) {
    return {
      title: '插件详情与安装',
      description: '查看插件声明式清单明细、实时预览与一键安装',
    }
  }
  const title = `「${meta.name}」· 插件市场`
  const canonical = `/marketplace/${encodeURIComponent(slug)}`
  return {
    title,
    description: meta.description,
    alternates: { canonical },
    openGraph: {
      title,
      description: meta.description,
      type: 'website',
      url: canonical,
    },
    twitter: {
      card: 'summary',
      title,
      description: meta.description,
    },
  }
}

export default async function MarketplaceDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  // 复用 generateMetadata 的取数（同一请求内 fetch 去重，且带 60s 缓存）。
  // 取不到插件名时面包屑只到「插件市场」，不留空 label——
  // 空 label 会让 BreadcrumbList 的 position 断档，整条被 Google 丢弃。
  const meta = await loadPluginMeta(slug)
  const origin = await siteOrigin()
  return (
    <>
      <Breadcrumbs
        items={[
          { label: '首页', path: '/' },
          { label: '插件市场', path: '/marketplace' },
          ...(meta ? [{ label: meta.name, path: `/marketplace/${encodeURIComponent(slug)}` }] : []),
        ]}
      />
      {origin && meta ? (
        <JsonLd data={softwareApplicationLd(origin, { slug, name: meta.name, description: meta.description })} />
      ) : null}
      {children}
    </>
  )
}
