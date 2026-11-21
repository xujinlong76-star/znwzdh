'use client'

/**
 * 榜单页客户端岛：热度榜 / 新品榜。
 * 热度分来自中枢 recompute_rank 任务（Phase 3 落地；
 * 未重算时按 visit_count 兜底，不会空白）。
 *
 * 首屏数据由服务端 page 下发（站点卡片的 `/site/{id}` 内链必须进 SSR
 * HTML）；本岛只负责降级提示与重试。首帧已有数据时跳过挂载期请求，
 * 避免把 SSR 内容闪成骨架屏。
 *
 * 名次标记已移除（2026-11-15）：此前每张卡片左上角有名次徽章
 * （🥇🥈🥉 + 数字序号），但访问量统计尚未积累、榜单不反映真实热度，
 * 奖牌暗示的排名没有数据支撑；真实热度数字达到展示标准之前，
 * 不展示任何排名或热度标记。条目顺序与链接保持不变。
 */

import { useEffect, useState, useMemo } from 'react'
import { safeHref } from '@/lib/safe-url'
import Link from 'next/link'
import { FavoriteButton } from '@/components/favorite-button'
import { fetchNewSites, fetchTrendingMeta, fetchPlugins, reportClick, type HubSite, type HubPluginItem } from '@/lib/navhub-api'
import { rankingMetric, type PluginRankGroups } from '@/lib/plugins/marketplace-rankings'
import {
  RANK_DOMAINS,
  curatedBadge,
  filterByDomain,
  parseDomain,
  resolveHeatMode,
  sortCurated,
  type RankDomain,
} from '@/lib/rank-mode'
import { filterAllRankGroups, shouldMergeInstallRanks } from '@/lib/plugins/rank-eligibility'
import { freshnessClass, freshnessLabel, freshnessLevel } from '@/lib/rank-freshness'
import {
  PLUGIN_KIND_CLASS,
  PLUGIN_KIND_LABEL,
  inferPluginKind,
  pluginHighlight,
} from '@/lib/plugins/plugin-kind'
import { formatAbsoluteTime } from '@/lib/format-relative-time'
import { useLocalSearchRecorder } from '@/lib/local-search-record'
import { getIdentity } from '@/lib/identity'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Flame, Sparkles, Trophy, ExternalLink, Search, X, Video, ArrowRight, Clock, TrendingUp, Star, Puzzle } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { DensityToggle } from '@/components/density-toggle'
import { SiteFavicon } from '@/components/site-favicon'
import { EmptyState } from '@/components/ui/empty-state'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'
import { normalizeSearchQuery } from '@/lib/search-page'

export default function HotView({
  initialTrending = [],
  initialFresh = [],
  recomputedAt: initialRecomputedAt = null,
  degraded = false,
  initialPluginRankings = { trending: [], popular: [], rating: [], fresh: [] },
  pluginDegraded = false,
  initialTab = 'trending',
  initialFilterQuery = '',
  initialDomain = 'all',
}: {
  initialTrending?: HubSite[]
  initialFresh?: HubSite[]
  /** 上次热度重算时刻（epoch 毫秒）；null = 尚无重算记录，不显示、不编造 */
  recomputedAt?: number | null
  degraded?: boolean
  /** 插件排行四组（P2-10）：与市场首页同口径（trending/popular/rating/fresh） */
  initialPluginRankings?: PluginRankGroups
  /** 任一组插件排行取数失败时为 true：插件 tab 空态据此区分「没取回」与「市场没数据」 */
  pluginDegraded?: boolean
  /** U-240：服务端从 ?tab= 读回的首帧页签，消掉深链先 trending 再闪切 */
  initialTab?: 'trending' | 'new' | 'plugins'
  /** U-239：服务端从 ?fq= 读回的首帧筛选词，消掉深链先全量再过滤 */
  initialFilterQuery?: string
  /** 2026-11-21：服务端从 ?domain= 读回的首帧领域，消掉深链先全部再切换 */
  initialDomain?: string
}) {
  const externalRel = externalLinkRelAttr(useSiteViewModel()?.externalLinkRel)
  const [trending, setTrending] = useState<HubSite[]>(initialTrending)
  const [fresh, setFresh] = useState<HubSite[]>(initialFresh)
  const [pluginRankings, setPluginRankings] = useState<PluginRankGroups>(initialPluginRankings)
  const [recomputedAt, setRecomputedAt] = useState<number | null>(initialRecomputedAt ?? null)
  const [loading, setLoading] = useState(false)
  /**
   * 中枢不可用时，「暂无热度数据」和「中枢挂了」看起来一模一样。
   * 榜单页的全部内容就是数据，静默降级等于告诉用户「本站没数据」，
   * 所以这里记下降级原因并给重试入口。
   */
  const [notice, setNotice] = useState<DegradeNotice | null>(
    degraded ? { message: '榜单数据暂时不可用：服务未启动或网络不可达。', retryable: true } : null,
  )
  const [reloadToken, setReloadToken] = useState(0)
  /**
   * 榜单页签写进 URL（?tab=new / ?tab=plugins）：点开站点再返回、刷新、分享链接都能停在同一榜。
   * 原来 defaultValue 只存在 Radix 内部，返回即回到「访问量榜」。
   * U-240：首帧页签由服务端 page.tsx 从 ?tab= 读回作初值（initialTab），
   * 挂载 effect 只负责 popstate 同步，不再晚一拍改 tab。
   */
  const [tab, setTab] = useState<'trending' | 'new' | 'plugins'>(initialTab)
  const [filterQuery, setFilterQuery] = useState(initialFilterQuery)
  /**
   * 领域分榜（2026-11-21）。
   *
   * 解决的问题是"文不对题"：标题写"技术风向标"，列表里却混着 KPL、
   * 蓝领招聘、政务通报这种泛生活站——因为冷启动时排序退化成数据库
   * 插入顺序，什么站先入库就排前面。领域胶囊让想看技术内容的开发者
   * 一键隔离掉不相关类目。
   *
   * 状态同步到 URL ?domain=，刷新/分享能停在同一个视图（与 ?tab= 同口径）。
   */
  const [domain, setDomain] = useState<RankDomain>(() => parseDomain(initialDomain))
  /** U-239：fq 读回完成前不写回 URL，免得把进页的 ?fq= 冲掉（照抄 /drama 的 filterReady 守门）。 */
  const [fqReady, setFqReady] = useState(false)

  /**
   * 冷启动态判定（2026-11-21）。
   *
   * 实测全站 active 站点总 visit 只有 16（10 个站点有记录），远低于
   * Top10 总热度 ≥50 的门槛，因此当前必然是 'cold'。冷启动态下：
   *  - 不展示 "1 次热度" 这种极小值（改为开源/编辑推荐等领域元数据）；
   *  - 用精选权重排序，取代退化成数据库顺序的 `sort ASC`。
   * 数据积累达标后自动切 'live'，无需改代码。
   */
  const heatMode = useMemo(() => resolveHeatMode(trending), [trending])

  /** 先按领域过滤，冷启动态再套精选排序 */
  const domainTrending = useMemo(() => {
    const scoped = filterByDomain(trending, domain)
    return heatMode === 'cold' ? sortCurated(scoped) : scoped
  }, [trending, domain, heatMode])

  const filteredTrending = useMemo(() => {
    if (!filterQuery.trim()) return domainTrending
    const q = filterQuery.trim().toLowerCase()
    return domainTrending.filter((s) => {
      const titleMatch = s.title.toLowerCase().includes(q)
      const descMatch = (s.description ?? '').toLowerCase().includes(q)
      const urlMatch = (s.url ?? '').toLowerCase().includes(q)
      const tagMatch = (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
      return titleMatch || descMatch || urlMatch || tagMatch
    })
  }, [trending, filterQuery])

  const filteredFresh = useMemo(() => {
    if (!filterQuery.trim()) return fresh
    const q = filterQuery.trim().toLowerCase()
    return fresh.filter((s) => {
      const titleMatch = s.title.toLowerCase().includes(q)
      const descMatch = (s.description ?? '').toLowerCase().includes(q)
      const urlMatch = (s.url ?? '').toLowerCase().includes(q)
      const tagMatch = (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
      return titleMatch || descMatch || urlMatch || tagMatch
    })
  }, [fresh, filterQuery])
  /**
   * 入榜资格过滤 + 关键词筛选（2026-11-21）。
   *
   * 资格必须在筛选之前：0 安装的插件本来就不该出现在安装榜里，
   * 与用户是否在搜索无关。所以先 filterAllRankGroups 再套关键词。
   *
   * 修的就是「飙升榜第 1 名是 0 安装」与「口碑榜 5 条全是暂无评价」
   * 这两个 Bug——它们的根因是接口结果被原样透传，没有入榜门槛。
   */
  const eligiblePluginRankings = useMemo(
    () => filterAllRankGroups(pluginRankings),
    [pluginRankings],
  )
  const filteredPluginRankings = useMemo(() => {
    if (!filterQuery.trim()) return eligiblePluginRankings
    const q = filterQuery.trim().toLowerCase()
    const match = (p: HubPluginItem) =>
      p.name.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      (p.tags ?? []).some((t) => t.toLowerCase().includes(q))
    return {
      trending: eligiblePluginRankings.trending.filter(match),
      popular: eligiblePluginRankings.popular.filter(match),
      rating: eligiblePluginRankings.rating.filter(match),
      fresh: eligiblePluginRankings.fresh.filter(match),
    } satisfies PluginRankGroups
  }, [eligiblePluginRankings, filterQuery])
  const pluginTotal = useMemo(
    () =>
      pluginRankings.trending.length +
      pluginRankings.popular.length +
      pluginRankings.rating.length +
      pluginRankings.fresh.length,
    [pluginRankings],
  )
  const filteredPluginTotal = useMemo(
    () =>
      filteredPluginRankings.trending.length +
      filteredPluginRankings.popular.length +
      filteredPluginRankings.rating.length +
      filteredPluginRankings.fresh.length,
    [filteredPluginRankings],
  )
  // 本机榜单筛选的查询也要进搜索历史（计数取当前 tab 的匹配数）
  useLocalSearchRecorder(
    filterQuery,
    tab === 'trending' ? filteredTrending.length : tab === 'new' ? filteredFresh.length : filteredPluginTotal,
  )
  useEffect(() => {
    // U-239：挂载读回 ?tab= 与 ?fq=；同一个 popstate 同步两者，后退时
    // tab 变了、筛选词不能留旧值。fq 走 normalizeSearchQuery 口径
    // （去控制字符、折叠空白、截断 256，与 /search 同口径）。
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const t = params.get('tab')
      setTab(t === 'new' ? 'new' : t === 'plugins' ? 'plugins' : 'trending')
      setFilterQuery(normalizeSearchQuery(params.get('fq') ?? undefined))
      setFqReady(true)
    }
    syncFromUrl()
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])
  // U-239：筛选词变化时写回 URL（?fq=，replaceState，不产生历史记录）。
  // fqReady 守门（读回前不写）+ 写前比较（与当前地址逐字相同就不写），
  // 空值 delete('fq')，不留 ?fq= 残留。changeTab 全量保留参数，fq 自动保留。
  useEffect(() => {
    if (!fqReady) return
    const params = new URLSearchParams(window.location.search)
    const q = normalizeSearchQuery(filterQuery)
    if (q) params.set('fq', q)
    else params.delete('fq')
    const qs = params.toString()
    const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    const current = window.location.pathname + window.location.search + window.location.hash
    if (next !== current) window.history.replaceState(window.history.state, '', next)
  }, [filterQuery, fqReady])
  const changeTab = (value: string) => {
    const nextTab = value === 'new' ? 'new' : value === 'plugins' ? 'plugins' : 'trending'
    setTab(nextTab)
    const params = new URLSearchParams(window.location.search)
    if (nextTab === 'new') params.set('tab', 'new')
    else if (nextTab === 'plugins') params.set('tab', 'plugins')
    else params.delete('tab')
    const qs = params.toString()
    const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    window.history.replaceState(window.history.state, '', next)
  }

  /**
   * 切换领域并写回 URL ?domain=（2026-11-21）。
   *
   * 与 changeTab 同口径：replaceState 不产生历史记录、保留其它参数、
   * 'all' 时 delete 掉参数不留残留。
   */
  const changeDomain = (next: RankDomain) => {
    setDomain(next)
    const params = new URLSearchParams(window.location.search)
    if (next === 'all') params.delete('domain')
    else params.set('domain', next)
    const qs = params.toString()
    const target = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    window.history.replaceState(window.history.state, '', target)
  }

  const reload = () => setReloadToken((n) => n + 1)

  useEffect(() => {
    // 首帧用 SSR 数据；只有用户点重试（reloadToken>0）才客户端重取
    if (reloadToken === 0) return
    let cancelled = false
    setLoading(true)
    setNotice(null)
    const onDegraded = (error: unknown) => {
      if (!cancelled) setNotice(describeDegrade(error, '榜单数据'))
    }
    // 失败标记：degrade() 把失败吞成空兜底，.then 收到空数组时分不清
    // 「真取回 0 条」还是「失败兜底」；每路独立回调记一笔才分得清。
    const failed = { trending: false, fresh: false, pt: false, pp: false, pr: false, pf: false }
    const markFailed =
      (key: keyof typeof failed) =>
      (error: unknown): void => {
        failed[key] = true
        onDegraded(error)
      }
    void Promise.all([
      fetchTrendingMeta(30, markFailed('trending')),
      fetchNewSites(30, markFailed('fresh')),
      // 插件排行四组：与服务端 loadHot 同口径（sort + limit=5），失败降级为空数组
      fetchPlugins({ sort: 'trending', limit: 5 }, markFailed('pt')),
      fetchPlugins({ sort: 'popular', limit: 5 }, markFailed('pp')),
      fetchPlugins({ sort: 'rating', limit: 5 }, markFailed('pr')),
      fetchPlugins({ sort: 'new', limit: 5 }, markFailed('pf')),
    ]).then(([t, f, pt, pp, pr, pf]) => {
      if (cancelled) return
      // 失败一路不覆盖旧榜（只亮 notice）；成功一路正常覆盖，哪怕取回 0 条
      // ——真空与故障空靠失败标记区分，不靠「空不空」猜。
      if (!failed.trending) {
        setTrending(t.sites)
        if (t.recomputedAt != null) setRecomputedAt(t.recomputedAt)
      }
      if (!failed.fresh) setFresh(f)
      setPluginRankings((prev) => ({
        trending: failed.pt ? prev.trending : pt.items,
        popular: failed.pp ? prev.popular : pp.items,
        rating: failed.pr ? prev.rating : pr.items,
        fresh: failed.pf ? prev.fresh : pf.items,
      }))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  /**
   * 榜单页点击上报：卡片标题内链、直达按钮两处共用同一口径，
   * 与 navigation-card.tsx 的 handleLinkClick 一致——reportClick 是
   * fire-and-forget，失败静默落端侧出箱，永不阻塞跳转。
   * position 取卡片在当前榜单里的位置（1 起），仅用于点击上报，
   * 不在页面上展示名次（名次徽章已移除）。
   * 详情页挂载时不另外上报（site-detail-view.tsx 无 reportClick），
   * 这里是 /hot → 详情的唯一一次上报，不会重复计数。
   */
  const handleSiteClick = (site: HubSite, position: number) => {
    reportClick(site.id, getIdentity(), { position })
  }

  /**
   * 插件排行四组（P2-10）：标题/图标/指标与市场首页三榜 + 默认排序「7 天飙升榜」
   * 同口径；行内指标走市场共用的 rankingMetric，不编造飙升分。
   * 行点击进市场详情页 /marketplace/{slug}（站内链，与站点榜标题链同模型）。
   */
  const pluginRankingGroups = [
    {
      key: 'trending' as const,
      title: '飙升榜',
      icon: Flame,
      metric: (p: HubPluginItem) => rankingMetric('trending', p),
    },
    {
      key: 'popular' as const,
      title: '安装榜',
      icon: TrendingUp,
      metric: (p: HubPluginItem) => rankingMetric('popular', p),
    },
    {
      key: 'rating' as const,
      title: '口碑榜',
      icon: Star,
      metric: (p: HubPluginItem) => rankingMetric('rating', p),
    },
    {
      key: 'fresh' as const,
      title: '新作榜',
      icon: Sparkles,
      metric: (p: HubPluginItem) => rankingMetric('fresh', p),
    },
  ]

  /**
   * 是否合并"热门装机 / 最新上架"（2026-11-21）。
   *
   * 冷启动期有安装记录的插件总共就十来个，飙升榜与安装榜几乎必然同一批，
   * 分成两个一模一样的小榜单只会让人觉得"怎么都是这几个"。
   * 重合率 >80% 时在界面上明确标注两者同源，并把"新作榜"提上来补位；
   * 真实数据丰富后自动展开完整四榜。
   */
  const renderPluginRankings = (groups: PluginRankGroups) => {
    const mergeInstall = shouldMergeInstallRanks(groups.trending, groups.popular)
    return (
    <div className="space-y-4">
      {mergeInstall ? (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          当前有安装记录的插件较少，<strong className="font-medium text-foreground">飙升榜与安装榜高度重合</strong>
          ，两者暂时同源展示；新作品另见下方「新作榜」。安装数据丰富后会自动展开完整四榜。
        </p>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {pluginRankingGroups.map((group) => {
          const rows = groups[group.key]
          const Icon = group.icon
          return (
            <div
              key={group.key}
              className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-2.5 transition-colors hover:border-border hover:bg-card"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Icon className="w-3.5 h-3.5 text-primary" />
                {group.title}
              </div>
              {rows.length === 0 ? (
                /* 2026-11-21：空态不再只说"暂无数据"——
                   口碑榜空是因为还没有用户评价（reviewCount 全为 0），
                   这是产品冷启动而非故障，应该给出可行动的引导而不是干巴巴的占位。
                   其余榜（安装/飙升）空则说明确实没有符合条件的插件。 */
                group.key === 'rating' ? (
                  <div className="space-y-2 py-2">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      口碑榜待你开启 · 使用插件后写下第一条评价即可点亮榜单
                    </p>
                    <Link
                      href="/marketplace"
                      className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      去逛插件市场 →
                    </Link>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground py-2">
                    {group.key === 'fresh'
                      ? '暂无新上架插件'
                      : '暂无达到入榜门槛的插件（需至少 1 次安装）'}
                  </p>
                )
              ) : (
                <ol className="space-y-1.5">
                  {rows.map((p, index) => (
                    <li key={`${group.key}-${p.id}`}>
                      <Link
                        href={`/marketplace/${encodeURIComponent(p.slug)}`}
                        title={p.name}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 hover:bg-muted/60 transition-colors"
                      >
                        <span
                          className={`w-4 text-[11px] tabular-nums font-bold ${index === 0 ? 'text-amber-500' : index === 1 ? 'text-slate-400' : index === 2 ? 'text-orange-600/80' : 'text-muted-foreground'}`}
                        >
                          {index + 1}
                        </span>
                        {/* 2026-11-21：名称旁补类型微标签 + 副行一句卖点，
                            让用户在点击前就知道这是个主题皮肤还是 AI 工作台。 */}
                        {(() => {
                          const kind = inferPluginKind(p as never)
                          const highlight = pluginHighlight(p)
                          return (
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-medium">{p.name}</span>
                                {kind ? (
                                  <span
                                    className={`shrink-0 rounded border px-1 py-px text-[9px] font-medium leading-tight ${PLUGIN_KIND_CLASS[kind]}`}
                                  >
                                    {PLUGIN_KIND_LABEL[kind]}
                                  </span>
                                ) : null}
                              </span>
                              {highlight ? (
                                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                  {highlight}
                                </span>
                              ) : null}
                            </span>
                          )
                        })()}
                        <span className="shrink-0 self-start text-[10px] tabular-nums text-muted-foreground">{group.metric(p)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex justify-center pt-1">
        <Button asChild size="sm" variant="outline" className="text-xs min-h-11">
          <Link href="/marketplace">
            <span>查看全部插件</span>
            <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Link>
        </Button>
      </div>
    </div>
    )
  }

  const renderList = (sites: HubSite[]) => (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! transition-all duration-200"
      style={{ gap: 'var(--density-grid-gap, 1rem)' }}
    >
      {sites.map((site, i) => (
        <div
          key={site.id}
          className="relative group @container rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs depth-card nav-card-glow transition-all duration-200 transform hover:-translate-y-0.5 p-[var(--density-card-padding,0.875rem)] flex flex-col justify-between shadow-2xs"
        >
          <div className="flex items-start gap-3">
            {/* 标题内链进详情页：与 SSG 的 /site/{id} 一起进首屏 HTML；站外直达只剩右上角图标按钮 */}
            <Link href={`/site/${encodeURIComponent(site.id)}`} onClick={() => handleSiteClick(site, i + 1)} className="block min-w-0 flex-1">
              <div className="flex items-start gap-2.5">
                <div className="shrink-0 w-10 h-10 rounded-lg p-1.5 bg-muted/50 dark:bg-muted/20 border border-border/50 flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-xs">
                  <SiteFavicon
                    title={site.title}
                    url={site.url}
                    icon={site.iconKey ?? undefined}
                    className="w-full h-full object-contain rounded-xs"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold tracking-tight text-foreground group-hover:text-link transition-colors truncate pr-8">
                    {site.title}
                  </div>
                  {site.description && (
                    <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1">
                      {site.description}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground font-mono flex-wrap">
                    {/* 2026-11-21 双态：冷启动不展示 "1 次热度" 这种极小值，
                        改为有信息量的真实元数据（开源 / 编辑推荐 / 领域 / 新收录） */}
                    {heatMode === 'live' ? (
                      typeof site.visitCount === 'number' && site.visitCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                          {site.visitCount} 次热度
                        </span>
                      )
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                        {curatedBadge(site)}
                      </span>
                    )}
                    {site.tags?.slice(0, 2).map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-full bg-muted border border-border/40">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          </div>
          <div className="absolute top-2 right-2 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1">
            <a
              href={safeHref(site.url)}
              target="_blank"
              rel={externalRel}
              onClick={() => handleSiteClick(site, i + 1)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="新窗口直达"
              aria-label={`访问 ${site.title}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <FavoriteButton
              site={{
                siteId: site.id,
                title: site.title,
                href: site.url,
                icon: site.iconKey ?? undefined,
                description: site.description ?? undefined,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <div className="space-y-5 sm:space-y-6">
        {/* 沉浸式 Hero 展板（对齐插件市场轮的展板语言：market-hero + 光斑 + 水印图标） */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-4 sm:p-8 shadow-xs">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
          <Trophy
            aria-hidden
            strokeWidth={1}
            className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
          />

          <div className="relative z-10 space-y-3">
            {/* 2026-11-21：原此处是「← 返回主页 / 站点榜单」，
                与页面顶部 Breadcrumbs（首页 > 趋势榜单）重复。按 IA 收敛原则
                只保留一处返回入口——面包屑已完整表达层级，这里是冗余。 */}

            <div className="max-w-2xl">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-xs">
                  <Trophy className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <span>{heatMode === 'live' ? '全站技术风向标与热度榜' : '全站精选风向标与趋势榜'}</span>
              </h1>
              {/* 2026-11-21 双态标题：冷启动时诚实改写定位，不假装有热度 */}
              <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                {heatMode === 'live'
                  ? '按站点真实访问量与趋势分排序，附趋势变化与热度值。'
                  : '编辑部按开源属性、收录质量与近期新增精选排序；真实热度仍在积累，达到门槛后自动切换为实时热榜。'}
                另附插件市场四组排行（飙升 / 安装 / 口碑 / 新作），点开即进插件市场。
              </p>
            </div>

            <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
              {/* 2026-11-21 领域分榜胶囊：让想看技术风向标的开发者一键隔离泛生活类目 */}
              <div
                role="group"
                aria-label="领域筛选"
                className="flex w-full flex-wrap items-center gap-1.5 pb-1"
              >
                {RANK_DOMAINS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => changeDomain(d.id)}
                    aria-pressed={domain === d.id}
                    className={
                      domain === d.id
                        ? 'inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        : 'inline-flex items-center rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {/* 2026-11-21 冷启动/实时 双态徽标：诚实告知当前榜单性质 */}
              <span
                className={
                  heatMode === 'live'
                    ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/[0.06] text-xs font-medium text-emerald-700 dark:text-emerald-400'
                    : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs font-medium text-muted-foreground'
                }
              >
                <Flame className="w-3 h-3" />
                {heatMode === 'live' ? '实时热度排序' : '编辑部精选排序 · 真实热度积累中'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/25 bg-amber-500/5 text-xs text-amber-700 dark:text-amber-400">
                <Flame className="w-3 h-3" />
                热度榜 {loading ? '—' : trending.length} 条
              </span>
              {/* 2026-11-21 时效分级：旧实现无差别中性灰，导致"今日热榜"配"4 天前重算"
                  毫无警示。现按 <6h / 6-24h / >24h 三档分级，超 24h 用琥珀色明示已过期。 */}
              {tab === 'trending' && recomputedAt != null && (
                <span
                  title={`热度重算于 ${formatAbsoluteTime(recomputedAt)}`}
                  className={freshnessClass(freshnessLevel(recomputedAt))}
                  role={freshnessLevel(recomputedAt) === 'stale' ? 'status' : undefined}
                >
                  <Clock className="w-3 h-3" />
                  {freshnessLabel(freshnessLevel(recomputedAt), recomputedAt)}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/5 text-xs text-emerald-700 dark:text-emerald-400">
                <Sparkles className="w-3 h-3" />
                新品 {loading ? '—' : fresh.length} 条
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-violet-500/25 bg-violet-500/5 text-xs text-violet-700 dark:text-violet-400">
                <Puzzle className="w-3 h-3" />
                插件排行 {loading ? '—' : pluginTotal} 条
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                <TrendingUp className="w-3 h-3" />
                {/* 2026-11-21：原为"访问量统计中，排序暂为默认顺序"——
                    与新加的"编辑部精选排序"徽标重复，且"默认顺序"已不准确
                    （冷启动态现在走精选权重排序）。改为按态说明。 */}
                {heatMode === 'live' ? '按真实访问量与趋势分排序' : '按精选权重排序'}
              </span>
            </div>
          </div>
        </div>

        {/* 2026-11-21 首屏瘦身：原此处有一个"全站搜索大框"，与下方"榜单内筛选框"
            在 200px 内上下堆叠，形成双搜索框冲突。全站检索已由顶部全局导航与
            / 快捷键完整覆盖，这里移除；榜内筛选条右侧保留「搜不到？按 / 全站检索」
            文字链作为出口。 */}

        {notice && <HubDegradedNotice notice={notice} onRetry={reload} />}

        {/* 榜单内即时筛选器 */}
        {!loading && (trending.length > 0 || fresh.length > 0 || pluginTotal > 0) && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-muted/30 border border-border/60 rounded-xl p-2.5">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder={
                  tab === 'plugins'
                    ? '在插件排行中极速筛选插件（名称、简介、标签）...'
                    : '筛选当前榜单（名称、标签、域名）...'
                }
                aria-label={tab === 'plugins' ? '在插件排行中筛选插件' : '在当前榜单中筛选站点'}
                className="w-full min-h-11 text-xs bg-background/80 border border-border/60 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-lg pl-8 pr-8 py-1.5 outline-none transition-colors"
              />
              {/* 清空筛选 ×：18px 的 × 视觉不变，::after 把点击区无形扩到 46px
                  （筛选框 44px 高，上下各出 1px 可忽略） */}
              {filterQuery && (
                <button
                  type="button"
                  onClick={() => setFilterQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer after:absolute after:-inset-3.5 after:content-['']"
                  title="清空筛选"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* 2026-11-21：筛选条只服务"当前榜单"；全站检索的出口放在这里——
                一个轻量文字链，替代原先占掉整行高度的全站搜索大框。 */}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                // 复用全站快捷键：按下 / 会聚焦全站搜索（GlobalSearchHotkey 监听）
                window.dispatchEvent(
                  new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
                )
              }}
              className="ml-2 shrink-0 whitespace-nowrap text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              搜不到？按 / 全站检索
            </a>
            <span aria-hidden className="shrink-0 text-border">·</span>
            <div className="shrink-0 pl-3 text-[11px] text-muted-foreground">
              {tab === 'trending' ? (
                <>显示 <span className="font-mono font-semibold text-foreground">{filteredTrending.length}</span> / {trending.length} 个站点</>
              ) : tab === 'new' ? (
                <>显示 <span className="font-mono font-semibold text-foreground">{filteredFresh.length}</span> / {fresh.length} 个站点</>
              ) : (
                <>显示 <span className="font-mono font-semibold text-foreground">{filteredPluginTotal}</span> / {pluginTotal} 个插件</>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div aria-busy="true" aria-live="polite" aria-label="正在加载榜单" className="space-y-4">
            <span className="sr-only">正在计算最新榜单排行…</span>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="h-9 w-56 rounded-xl bg-muted/60 animate-pulse" />
              <div className="h-8 w-8 rounded-lg bg-muted/60 animate-pulse" />
            </div>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5!"
              style={{ gap: 'var(--density-grid-gap, 1rem)' }}
            >
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/70 bg-card/50 p-[var(--density-card-padding,0.875rem)] space-y-3 animate-pulse"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-full rounded bg-muted" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-5 w-16 rounded-full bg-muted" />
                    <div className="h-5 w-12 rounded-full bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={changeTab} className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <TabsList className="h-[3.25rem] p-1 rounded-xl bg-muted/40 border border-border/50">
                <TabsTrigger value="trending" className="min-h-11 text-xs sm:text-sm gap-1.5 rounded-lg">
                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                  <span>访问量榜</span>
                </TabsTrigger>
                <TabsTrigger value="new" className="min-h-11 text-xs sm:text-sm gap-1.5 rounded-lg">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  <span>最新入库榜</span>
                </TabsTrigger>
                <TabsTrigger value="plugins" className="min-h-11 text-xs sm:text-sm gap-1.5 rounded-lg">
                  <Puzzle className="w-3.5 h-3.5 text-violet-500" />
                  <span>插件排行</span>
                </TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-1.5">
                <DensityToggle className="border border-border/40" />
              </div>
            </div>
            <TabsContent value="trending" className="pt-2">
              {trending.length === 0 ? (
                <EmptyState
                  icon={Flame}
                  iconTone="warning"
                  title={notice ? '本次未能取回榜单数据' : '暂无访问量数据'}
                  description="访问量统计尚未积累，当前不生成排名；可先浏览全部站点，或稍后再来看看。"
                  action={
                    <Button asChild size="sm" variant="outline" className="text-xs min-h-11">
                      <Link href="/">去主页浏览全部站点</Link>
                    </Button>
                  }
                />
              ) : filteredTrending.length === 0 ? (
                <EmptyState
                  icon={Search}
                  iconTone="muted"
                  title="未找到匹配的榜单站点"
                  description={`未搜索到包含 “${filterQuery}” 的热门站点`}
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs min-h-11"
                      onClick={() => setFilterQuery('')}
                    >
                      清空筛选条件
                    </Button>
                  }
                />
              ) : (
                renderList(filteredTrending)
              )}
            </TabsContent>
            <TabsContent value="new" className="pt-2">
              {fresh.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  iconTone="muted"
                  title={notice ? '本次未能取回新入库数据' : '暂无新入库数据'}
                  description="新入库站点会在收录完成后出现在这里；也可以先回主页或标签云逛逛。"
                  action={
                    <Button asChild size="sm" variant="outline" className="text-xs min-h-11">
                      <Link href="/tags">浏览标签云</Link>
                    </Button>
                  }
                />
              ) : filteredFresh.length === 0 ? (
                <EmptyState
                  icon={Search}
                  iconTone="muted"
                  title="未找到匹配的新入库站点"
                  description={`未搜索到包含 “${filterQuery}” 的新入库站点`}
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs min-h-11"
                      onClick={() => setFilterQuery('')}
                    >
                      清空筛选条件
                    </Button>
                  }
                />
              ) : (
                renderList(filteredFresh)
              )}
            </TabsContent>
            {/*
              插件排行 tab（P2-10）：复用市场四组排行（飙升 / 安装 / 口碑 / 新作）。

              2026-11-21 去掉 forceMount：它原本的动机是「排行内链要进首屏 HTML」，
              但副作用是**未切到插件 tab 时页面底部仍完整铺出四榜**——三个 Tab
              语义重叠、首屏被拉长。现在改为互斥视图：站点榜底部只放一张轻量
              横向导流条，切到本 tab 才完整呈现。
              SEO 影响可忽略：/hot 的核心收录面是站点榜的 /site/{id} 内链，
              插件排行本身在 /marketplace 已有独立收录页。
            */}
            <TabsContent value="plugins" className="pt-2">
              {pluginTotal === 0 ? (
                <EmptyState
                  icon={Puzzle}
                  iconTone="muted"
                  title={pluginDegraded ? '本次未能取回插件排行' : '暂无插件排行数据'}
                  description="插件市场还没有可排行的插件；也可以先去市场看看全部插件。"
                  action={
                    <Button asChild size="sm" variant="outline" className="text-xs min-h-11">
                      <Link href="/marketplace">去插件市场</Link>
                    </Button>
                  }
                />
              ) : filteredPluginTotal === 0 ? (
                <EmptyState
                  icon={Search}
                  iconTone="muted"
                  title="未找到匹配的插件"
                  description={`未搜索到包含 “${filterQuery}” 的插件`}
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs min-h-11"
                      onClick={() => setFilterQuery('')}
                    >
                      清空筛选条件
                    </Button>
                  }
                />
              ) : (
                renderPluginRankings(filteredPluginRankings)
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* 2026-11-21：站点榜底部轻量导流条（替代原先 forceMount 铺满的插件四榜）。
            只在站点榜（trending/new）显示；已在插件 tab 时不再重复导流。 */}
        {tab !== 'plugins' && pluginTotal > 0 && (
          <Link
            href="/hot?tab=plugins"
            onClick={(e) => {
              e.preventDefault()
              changeTab('plugins')
            }}
            className="group flex items-center justify-between gap-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.04] px-3.5 py-2.5 transition-colors hover:border-violet-500/40 hover:bg-violet-500/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Puzzle className="w-3.5 h-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
              <span className="truncate">
                插件市场已有{' '}
                <strong className="font-semibold text-foreground">{pluginTotal}</strong>{' '}
                条排行记录（飙升 / 安装 / 口碑 / 新作）
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-400">
              探索插件市场热门排行
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        )}

        {/* 2026-11-21：视频推广条从首屏核心操作区下沉到这里——
            首屏空间应该留给榜单本身（要求：1280×800 不滚动即可看到筛选栏与前排卡片）。
            放在榜单之后既不打断浏览，也保留了导流。 */}
        {/* 热门技术视频推荐横幅 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-blue-500/25 bg-blue-500/5 text-xs text-foreground">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Video className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-foreground truncate">
                热门技术精选视频教程
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                探索热门前端、后端、AI、云原生等前沿技术实战课程
              </div>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="text-xs min-h-11 shrink-0 self-start sm:self-auto border-blue-500/30 text-blue-700 dark:text-blue-400 hover:bg-blue-500/10">
            <Link href="/videos">
              <span>前往技术视频库</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </div>
    </>
  )
}
