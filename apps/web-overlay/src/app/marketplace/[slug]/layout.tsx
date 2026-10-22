import { configuredSiteOrigin } from '@/lib/seo/origin'
import { softwareApplicationLd } from '@/lib/seo/json-ld'
import { safeDecodeParam } from '@/lib/server/route-params'
import { loadPluginDetail } from '@/lib/server/plugin-detail'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'

/**
 * 插件详情的服务端外壳：面包屑 + SoftwareApplication JSON-LD。
 *
 * metadata 由 page.tsx 的 generateMetadata 提供（page 级会覆盖 layout 级，
 * 两处都写只会让取数逻辑分叉）。这里复用同一个 loadPluginDetail，
 * 同一请求内 Next 会 memoize fetch，不产生额外上游请求。
 */
async function loadPluginMeta(slug: string): Promise<{ name: string; description: string } | null> {
  const probe = await loadPluginDetail(slug)
  if (probe.status !== 'ok') return null
  const plugin = probe.data.plugin
  return {
    name: plugin.name.slice(0, 60),
    description: (plugin.description || 'NavHub 插件市场：声明式插件，一键安装即用。').slice(0, 160),
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
  const safeSlug = safeDecodeParam(slug)
  const meta = safeSlug ? await loadPluginMeta(safeSlug) : null
  const origin = configuredSiteOrigin()
  return (
    <>
      <Breadcrumbs
        items={[
          { label: '首页', path: '/' },
          { label: '插件市场', path: '/marketplace' },
          ...(meta && safeSlug
            ? [{ label: meta.name, path: `/marketplace/${encodeURIComponent(safeSlug)}` }]
            : []),
        ]}
      />
      {origin && meta && safeSlug ? (
        <JsonLd data={softwareApplicationLd(origin, { slug: safeSlug, name: meta.name, description: meta.description })} />
      ) : null}
      {children}
    </>
  )
}
