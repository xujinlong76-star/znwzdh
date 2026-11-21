import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { hubGet } from '@/lib/server/hub'
import type { HubSite, HubPluginItem } from '@/lib/navhub-api'
import type { PluginRankGroups } from '@/lib/plugins/marketplace-rankings'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { normalizeSearchQuery } from '@/lib/search-page'
import { parseDomain } from '@/lib/rank-mode'
import HotView from './hot-view'

/**
 * 榜单页（服务端取数 + 客户端岛）。
 *
 * 为什么服务端化：站点卡片的 `/site/{id}` 内链要进 SSR HTML；改版前整页
 * useEffect 取数，爬虫首轮只看到骨架屏。取数顺带把 metadata 从 layout
 * 收回 page（layout 只剩骨架，已删除）。
 *
 * revalidate=60：与中枢 /api/rank/* 的 maxAge 对齐；/hot 是爬虫面，
 * 缓存让重复抓取不再每次打穿中枢排序查询。
 */

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: '今日热榜',
    description: '按热度排序的热门站点与插件排行',
    alternates: { canonical: '/hot' },
    ...(await pageShareMetadata({
      url: '/hot',
      title: '今日热榜',
      description: '按热度排序的热门站点与插件排行',
    })),
  }
}

export const revalidate = 60

type RankHit = { site: HubSite }

type HubPluginsResponse = { items: HubPluginItem[]; total: number }

/**
 * 插件排行取数口径与市场首页三榜 + 默认排序完全一致（P2-10）：
 * trending = 市场默认排序「7 天飙升榜」，popular / rating / fresh
 * 与市场页同 endpoint、同 limit=5；失败各自降级为空数组，不拖垮站点榜。
 */
const PLUGIN_RANK_LIMIT = 5

/** 两个榜单共用一次服务端取数；失败各自降级为空数组 */
async function loadHot() {
  const [trendingRes, freshRes, pluginTrendingRes, pluginPopularRes, pluginRatingRes, pluginFreshRes] =
    await Promise.all([
      hubGet<{ hits: RankHit[]; recomputedAt?: number | null }>('/api/rank/trending?limit=30', 60),
      hubGet<{ hits: RankHit[] }>('/api/rank/new?limit=30', 60),
      hubGet<HubPluginsResponse>(`/api/plugins?sort=trending&limit=${PLUGIN_RANK_LIMIT}`, 60),
      hubGet<HubPluginsResponse>(`/api/plugins?sort=popular&limit=${PLUGIN_RANK_LIMIT}`, 60),
      hubGet<HubPluginsResponse>(`/api/plugins?sort=rating&limit=${PLUGIN_RANK_LIMIT}`, 60),
      hubGet<HubPluginsResponse>(`/api/plugins?sort=new&limit=${PLUGIN_RANK_LIMIT}`, 60),
    ])
  const pick = (res: { hits: RankHit[] } | null): HubSite[] =>
    (res?.hits ?? []).map((h) => h.site).filter((s): s is HubSite => Boolean(s))
  const pickPlugins = (res: HubPluginsResponse | null): HubPluginItem[] => res?.items ?? []
  return {
    trending: pick(trendingRes),
    fresh: pick(freshRes),
    // 上次热度重算时刻：无事件行时 null，前端不显示、不编造
    recomputedAt: trendingRes?.recomputedAt ?? null,
    degraded: trendingRes === null || freshRes === null,
    pluginRankings: {
      trending: pickPlugins(pluginTrendingRes),
      popular: pickPlugins(pluginPopularRes),
      rating: pickPlugins(pluginRatingRes),
      fresh: pickPlugins(pluginFreshRes),
    } satisfies PluginRankGroups,
    pluginDegraded:
      pluginTrendingRes === null ||
      pluginPopularRes === null ||
      pluginRatingRes === null ||
      pluginFreshRes === null,
  }
}

export default async function HotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  // U-239 + U-240：深链首帧初值——?tab= 决定首帧页签、?fq= 决定首帧筛选词，
  // 服务端直出，不再等挂载 effect 才恢复（消掉深链先 trending/全量再闪切）。
  // 非法 tab 回落 trending；fq 走 normalizeSearchQuery 口径（截断 256）。
  // canonical 仍固定 /hot，?fq=/?tab= 变体由 canonical 收敛，无需新增 robots 规则。
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab
  const initialTab = tabParam === 'new' ? 'new' : tabParam === 'plugins' ? 'plugins' : 'trending'
  const initialFilterQuery = normalizeSearchQuery(sp.fq)
  // 2026-11-21：?domain= 领域分榜的首帧值（非法值由 parseDomain 归一到 all）
  const domainParam = Array.isArray(sp.domain) ? sp.domain[0] : sp.domain
  const initialDomain = parseDomain(domainParam)
  const { trending, fresh, recomputedAt, degraded, pluginRankings, pluginDegraded } = await loadHot()
  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '趋势榜单', path: '/hot' },
          ]}
        />
        <HotView
          initialTrending={trending}
          initialFresh={fresh}
          recomputedAt={recomputedAt}
          degraded={degraded}
          initialPluginRankings={pluginRankings}
          pluginDegraded={pluginDegraded}
          initialTab={initialTab}
          initialFilterQuery={initialFilterQuery}
          initialDomain={initialDomain}
        />
      </div>
      <Footer />
    </Container>
  )
}
