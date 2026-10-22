import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { hubGet } from '@/lib/server/hub'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { PluginMarketBoard } from '@/components/plugin-market-board'
import {
  buildMarketplaceQuery,
  DEFAULT_MARKETPLACE_SORT,
  parseMarketplaceFilters,
} from '@/lib/plugins/marketplace-filters'
import type { HubPluginItem } from '@/lib/navhub-api'
import { pageShareMetadata } from '@/lib/seo/metadata'

/**
 * 插件市场首页（服务端取数 + 客户端岛渲染）。
 *
 * 为什么服务端化（Batch E，2026-10-21）：插件卡片的 `/marketplace/{slug}`
 * 内链必须进 **SSR HTML**。改版前整页是客户端组件、useEffect 取数，
 * link-graph 实测 64 个插件详情页 100% 孤岛。现在服务端取数经 props
 * 下发给 PluginMarketBoard 岛，首帧渲染即 SSR。
 *
 * 筛选口径与客户端同源：`parseMarketplaceFilters` 是纯函数，深链
 * （/marketplace?q=xxx&kind=yyy）服务端解析同一套参数取数——筛选视图
 * 同样 SSR 直出，不是只有默认视图有内容。
 *
 * revalidate=60：插件市场是低频变更内容，爬虫面走 Data Cache（Phase 6a
 * 口径）。hubGet 失败返回 null → 岛挂载后自动客户端重取 + 降级提示。
 *
 * 无筛选时才取精选与三榜（与岛内 effect 同款条件）：避免筛选视图带无关推荐。
 */

type HubPluginsResponse = { items: HubPluginItem[]; total: number }

type RankGroups = {
  popular: HubPluginItem[]
  rating: HubPluginItem[]
  fresh: HubPluginItem[]
}

/** `/api/plugins` 单页上限 100（服务端硬限制），SSR 种子必须按 offset 取全。 */
const MARKET_LIST_PAGE_SIZE = 100
/** 首屏 SSR 最多种 300 个详情链接，避免插件规模失控时无限串行取数；其余仍有 sitemap。 */
const MARKET_SSR_LIMIT = 300

/**
 * 取全市场列表（受 MARKET_SSR_LIMIT 约束）。
 *
 * 之前直接写 `limit=1000` 会被 API 静默截到 100：市场超过 100 个插件后，
 * 第 101 个之后的详情页又变成没有首页内链的孤岛（正是服务端化要修的问题）。
 */
async function loadMarketPluginList(query: URLSearchParams): Promise<HubPluginsResponse | null> {
  const first = await hubGet<HubPluginsResponse>('/api/plugins?' + query.toString(), 60)
  if (!first) return null
  const items = [...first.items]
  const total = first.total
  while (items.length < total && items.length < MARKET_SSR_LIMIT) {
    const nextQuery = new URLSearchParams(query)
    nextQuery.set('offset', String(items.length))
    const next = await hubGet<HubPluginsResponse>('/api/plugins?' + nextQuery.toString(), 60)
    if (!next || next.items.length === 0) break
    items.push(...next.items)
  }
  return { items, total }
}

function searchToString(sp: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) for (const x of v) params.append(k, x)
    else if (v !== undefined) params.append(k, v)
  }
  const s = params.toString()
  return s ? '?' + s : ''
}

/**
 * 筛选视图不制造可索引的薄 URL：默认市场页可索引，带 q/kind/非默认 sort
 * 的视图一律 noindex,follow + 自指 canonical。canonical 走同一套归一化
 * （默认 sort 不写回），避免 ?sort=trending 与 /marketplace 各自成页。
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  const sp = await searchParams
  const state = parseMarketplaceFilters(searchToString(sp))
  const filtered =
    Boolean(state.kind || state.q) || state.sort !== DEFAULT_MARKETPLACE_SORT
  const canonical = `/marketplace${buildMarketplaceQuery(state)}`
  const title = state.q
    ? `插件市场 · 搜索「${state.q}」`
    : state.kind
      ? `插件市场 · ${state.kind}`
      : '插件市场'
  const description = state.q
    ? `在插件市场搜索「${state.q}」的结果，包含网址包、工作台预设与主题扩展。`
    : '声明式网址包、工作台预设与个性化配色主题扩展中心'
  return {
    title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({ url: canonical, title, description })),
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const { kind, q, sort } = parseMarketplaceFilters(searchToString(sp))
  const hasFilter = Boolean(q || kind) || sort !== DEFAULT_MARKETPLACE_SORT

  const listQuery = new URLSearchParams()
  if (kind) listQuery.set('kind', kind)
  if (q) listQuery.set('q', q)
  listQuery.set('sort', sort)
  // 全量种子（当前市场 64 个插件）：分页式「加载更多」是客户端追加，
  // 第二页起的插件卡片没有 SSR 入链（link-graph 实测 40/64 孤岛）。
  // API 单页上限 100，必须按 offset 取到 total；「加载更多」按钮在
  // items.length === total 时自然隐藏。筛选交互后仍走 24/页的分页 UX。
  listQuery.set('limit', String(MARKET_LIST_PAGE_SIZE))

  const [list, featuredRes, popularRes, ratingRes, freshRes] = await Promise.all([
    loadMarketPluginList(listQuery),
    ...(hasFilter
      ? [null, null, null, null]
      : [
          hubGet<HubPluginsResponse>('/api/plugins?featured=true&sort=featured&limit=6', 60),
          hubGet<HubPluginsResponse>('/api/plugins?sort=popular&limit=5', 60),
          hubGet<HubPluginsResponse>('/api/plugins?sort=rating&limit=5', 60),
          hubGet<HubPluginsResponse>('/api/plugins?sort=new&limit=5', 60),
        ]),
  ])

  const rankings: RankGroups | null = popularRes && ratingRes && freshRes
    ? {
        popular: popularRes.items,
        rating: ratingRes.items,
        fresh: freshRes.items,
      }
    : null

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '插件市场', path: '/marketplace' },
          ]}
        />
        <PluginMarketBoard
          initialItems={list ? list.items : null}
          initialTotal={list?.total ?? 0}
          initialFeatured={featuredRes ? featuredRes.items : null}
          initialRankings={rankings}
        />
      </div>
      <Footer />
    </Container>
  )
}
