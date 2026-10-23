import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hubGetProbe } from '@/lib/server/hub'
import { safeDecodeParam } from '@/lib/server/route-params'
import { SiteDetailView } from '@/components/site-detail-view'
import { Breadcrumbs } from '@/components/breadcrumbs'
import type { Crumb } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { ogImageUrl } from '@/lib/seo/og-text'
import { siteMetaDescription } from '@/lib/seo/site-description'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '@/lib/seo/thresholds'
import { descendantSiteCounts } from '@/lib/seo/category-totals'
import { categoryUrlKey, isHiddenCategory } from '@/lib/seo/category-url'
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

/**
 * ISR（2026-10-22）：详情页此前每个请求都要重新渲染，并重复向中枢取
 * 「详情 + 同分类 + 分类表 + 计数」四路数据。页面与 fetch 同为 60s，
 * 让 HTML 也进增量缓存：首请求生成，后续 60s 内直接命中，重复抓取
 * 不再打穿中枢。notFound() 的 404 同样随缓存过期，站点删除后最多
 * 多存活一个窗口，与下方软 404 判定口径一致。
 *
 * 本路由不能加 loading.tsx（见头部说明）——ISR 也不例外：骨架屏边界
 * 会让 404 变成流式 200。
 */
export const revalidate = 60

/**
 * Next 16 的硬性前提：动态段只有在存在 `generateStaticParams`（哪怕返回
 * 空数组）或 `dynamic = 'force-static'` 时，运行时生成的结果才会进 ISR。
 * 只写 `revalidate` 实测仍是逐请求渲染（Cache-Control: no-store）。
 *
 * 空数组 = 构建期不预生成任何详情页，首个请求按需生成并缓存；站点数量
 * 千级且持续增删，全量列举既拖慢构建又会把新站漏成动态页。
 */
export async function generateStaticParams() {
  return []
}

const RELATED_LIMIT = 6

async function loadSite(id: string) {
  const safeId = safeDecodeParam(id)
  if (!safeId) return { safeId, probe: { status: 'failed' as const } }
  const probe = await hubGetProbe<HubSite>('/api/sites/' + encodeURIComponent(safeId), 60)
  // 这里**不要**试图用 `connection()` 把降级渲染标成不可缓存。
  // 实测（2026-10-23，无 origin 产物 + 中枢不可达）：本路由按需生成时
  // `await connection()` 直接抛 DYNAMIC_SERVER_USAGE → HTTP 500，
  // 和「缺 NAVHUB_SITE_URL 时读 headers()」是同一个失败形态，比坏快照更糟
  // （降级壳至少是 200，且带 noindex，见 generateMetadata 的 failed 分支）。
  return { safeId, probe }
}

/**
 * 同分类站点与分类入口（服务端取数，进 SSR HTML）。
 *
 * 为什么只信 `counts`：分类页对 < 门槛的分类直接 404，详情页若按 API 返回的
 * 站点数链接，薄分类会变成一条站内死链。counts 取数失败（null）时宁可不链，也不赌。
 * 计数走 `descendantSiteCounts`：站点归属的类目在新树里是叶子（自身计数就够），
 * 但存量数据里还有一批直接挂在一级根上的站点，原始计数读它们是 0，
 * 分类页（按子树展开取站点）却明显可达——口径不一致会让详情页少一条内链。
 */
async function loadSiteContext(site: HubSite) {
  const categoryId = (site.categoryId ?? '').trim()
  const empty = { related: [] as HubSite[], category: null, canLinkCategory: false, categoryCount: 0 }
  if (!categoryId) return empty

  const [res, categories, rawCounts] = await Promise.all([
    loadCategorySites(categoryId, RELATED_LIMIT + 1, 0, 300),
    loadCategories(3600),
    loadActiveCategoryCounts(60),
  ])
  const counts = descendantSiteCounts(categories ?? [], rawCounts)
  // 隐藏类目（未分类）没有公开详情页：站点详情不能链过去，否则就是一条 404 内链
  const category =
    categories?.find(
      (c) => c.id === categoryId && c.enabled !== false && !isHiddenCategory(c),
    ) ?? null
  // search 结果保持中枢相关度排序；只做自站/非活跃过滤与截断
  const related = (res?.hits ?? [])
    .map((h) => h.site)
    .filter((s): s is HubSite => s !== null && s.id !== site.id && s.status === 'active')
    .slice(0, RELATED_LIMIT)
  const categoryCount = counts?.get(categoryId) ?? 0
  return {
    related,
    category:
      category && categories
        ? { id: category.id, slug: categoryUrlKey(category), title: categoryDisplayName(category, categories) }
        : null,
    canLinkCategory: Boolean(category) && counts !== null && categoryCount >= MIN_SITES_FOR_CATEGORY_INDEX,
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
    // 降级：不编造站点名，保留通用标题与 canonical。
    //
    // `noindex, follow` 是这一份快照唯一的自我标记：中枢抖动时，降级壳会被
    // 当作正常 ISR 快照落盘（实测一轮全量审计里 997 个详情页有 551 个是这样，
    // `x-nextjs-cache: HIT` 续 60s），而它带的是全站共用的「站点详情」标题、
    // 正文靠客户端补——爬虫在这 60s 里拿到的是一个可索引的空页。
    // 缓存本身没法按需绕过（见 loadSite 里 connection() 的实测结论），
    // 所以改为给坏快照盖章：不收录、但仍顺着内链走，一个 revalidate 周期后
    // 正常快照覆盖回来，`noindex` 一起消失。
    const title = '站点详情'
    const description = '官网入口、一句话简介与所属分类'
    return {
      title,
      description,
      robots: 'noindex, follow',
      alternates: { canonical },
      ...(await pageShareMetadata({ url: canonical, title, description })),
    }
  }

  const site = probe.data
  /**
   * 标题后缀用**分类名**而不是「站点详情」。
   *
   * 两个理由：
   * 1. 关键词：`Cursor · AI 编程助手` 比 `Cursor · 站点详情` 多一个可排名词，
   *    而「站点详情」是全站 4000+ 页共用的零信息后缀；
   * 2. 消歧：生产种子去重后仍有 71 组「同标题、不同 URL」的站点
   *    （ChatGPT / Cursor 这类官网迁移到新域名的历史条目），
   *    后缀若固定不变，两条详情页的 <title> 会完全一样，互相蚕食。
   *
   * 取不到分类时退回原后缀，绝不编造分类名。
   */
  const categoryName = await loadSiteCategoryName(site.categoryId)
  const title = `${site.title} · ${categoryName ?? '站点详情'}`
  const description = siteMetaDescription(site, categoryName)
  return {
    title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({
      url: canonical,
      title,
      description,
      imageUrl: ogImageUrl(canonical),
      imageAlt: `${site.title} · NavHub 站点详情`,
    })),
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
      ? [{ label: context.category.title, path: `/category/${encodeURIComponent(context.category.slug)}` }]
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
