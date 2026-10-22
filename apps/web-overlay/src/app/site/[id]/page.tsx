import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hubGetProbe } from '@/lib/server/hub'
import { safeDecodeParam } from '@/lib/server/route-params'
import { SiteDetailView } from '@/components/site-detail-view'
import { Breadcrumbs } from '@/components/breadcrumbs'
import type { Crumb } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { SITE_DESCRIPTION_MIN, siteMetaDescription } from '@/lib/seo/site-description'
import { MIN_SITES_FOR_INDEX } from '@/lib/seo/thresholds'
import type { HubSite } from '@/lib/navhub-api'
import {
  categoryDisplayName,
  loadActiveCategoryCounts,
  loadCategories,
  loadCategorySites,
} from '@/lib/server/categories'

/**
 * 站点详情页服务端壳：存在性判定 + 首屏数据 + 页面级元信息。
 *
 * 软 404（2026-10-21）：只有 hubGetProbe 返回 'miss'（中枢 API 确认 404）
 * 才 notFound()；'failed'（网络/中枢抖动）必须降级正常渲染，绝不把上游
 * 故障误判成 404。判定留在 page 渲染体——layout 级 notFound 实测会被回退
 * 成 200（见 docs/seo 7.7 的生产实测）。
 *
 * 实测铁律：**本路由不能有 loading.tsx**。有骨架屏边界时 Next 会先流式
 * 刷出 HTTP 200 壳，之后 notFound() 再抛也改不了状态码。岛内自带骨架屏
 * （SiteDetailView 的 loading 态），加载体验不受影响。
 *
 * SEO（2026-10-21 补）：此前标题/描述由 layout 静态给出，1013 个详情页
 * 共享「站点详情」；正文也因为客户端取数不进 SSR HTML，`<h1>` 为 0。
 * 现在 page 产出每站独立 title/description/canonical，并把首屏站点数据
 * 下发给岛——h1 与正文直出，同时首屏少一次客户端往返。
 */

const RELATED_LIMIT = 6

async function loadSite(id: string) {
  const safeId = safeDecodeParam(id)
  if (!safeId) return { safeId, probe: { status: 'failed' as const } }
  const probe = await hubGetProbe<HubSite>('/api/sites/' + encodeURIComponent(safeId), 60)
  return { safeId, probe }
}

/**
 * 同分类站点与分类入口（服务端取数，进 SSR HTML）。
 *
 * 为什么只信 `counts`：分类页对 < MIN_SITES_FOR_INDEX 的分类直接 404，
 * 详情页若按 API 返回的站点数链接，薄分类会变成一条站内死链。counts
 * 取数失败（null）时宁可不链，也不赌。
 */
async function loadSiteContext(site: HubSite) {
  const categoryId = (site.categoryId ?? '').trim()
  const empty = { related: [] as HubSite[], category: null, canLinkCategory: false, categoryCount: 0 }
  if (!categoryId) return empty

  const [res, categories, counts] = await Promise.all([
    loadCategorySites(categoryId, RELATED_LIMIT + 1, 0, 300),
    loadCategories(3600),
    loadActiveCategoryCounts(3600),
  ])
  const category = categories?.find((c) => c.id === categoryId && c.enabled !== false) ?? null
  // search 结果保持中枢相关度排序；只做自站/非活跃过滤与截断
  const related = (res?.hits ?? [])
    .map((h) => h.site)
    .filter((s): s is HubSite => s !== null && s.id !== site.id && s.status === 'active')
    .slice(0, RELATED_LIMIT)
  const categoryCount = counts?.get(categoryId) ?? 0
  return {
    related,
    category:
      category && categories ? { id: category.id, title: categoryDisplayName(category, categories) } : null,
    canLinkCategory: Boolean(category) && counts !== null && categoryCount >= MIN_SITES_FOR_INDEX,
    categoryCount,
  }
}

async function loadSiteCategoryName(categoryId: string | null | undefined): Promise<string | null> {
  const id = (categoryId ?? '').trim()
  if (!id) return null
  const categories = await loadCategories(3600)
  if (!categories) return null
  const category = categories.find((c) => c.id === id && c.enabled !== false)
  return category ? categoryDisplayName(category, categories) : null
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { safeId, probe } = await loadSite(id)
  if (!safeId) notFound()
  if (probe.status === 'miss') notFound()

  const canonical = `/site/${encodeURIComponent(safeId)}`
  if (probe.status === 'failed') {
    // 降级：不编造站点名，保留通用标题与 canonical
    const title = '站点详情'
    const description = '官网入口、一句话简介与所属分类'
    return {
      title,
      description,
      alternates: { canonical },
      ...(await pageShareMetadata({ url: canonical, title, description })),
    }
  }

  const site = probe.data
  const title = `${site.title} · 站点详情`
  const needFallback = (site.description ?? '').trim().length < SITE_DESCRIPTION_MIN
  const categoryName = needFallback ? await loadSiteCategoryName(site.categoryId) : null
  const description = siteMetaDescription(site, categoryName)
  return {
    title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({ url: canonical, title, description })),
  }
}

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { safeId, probe } = await loadSite(id)
  if (!safeId) notFound()
  if (probe.status === 'miss') notFound()

  const site = probe.status === 'ok' ? probe.data : null
  const context = site
    ? await loadSiteContext(site)
    : { related: [], category: null, canLinkCategory: false, categoryCount: 0 }

  const sitePath = `/site/${encodeURIComponent(safeId)}`
  const crumbs: Crumb[] = [
    { label: '首页', path: '/' },
    { label: '全部站点', path: '/sites' },
    // 薄分类不链（分类页会 404）；分类取数失败时同样不链
    ...(context.category && context.canLinkCategory
      ? [{ label: context.category.title, path: `/category/${encodeURIComponent(context.category.id)}` }]
      : []),
    { label: site?.title ?? '站点详情', path: sitePath },
  ]

  return (
    <SiteDetailView
      id={safeId}
      initialSite={site}
      initialRelated={context.related}
      category={context.category}
      canLinkCategory={context.canLinkCategory}
      categoryCount={context.categoryCount}
      breadcrumb={<Breadcrumbs items={crumbs} jsonLd={Boolean(site)} />}
    />
  )
}
