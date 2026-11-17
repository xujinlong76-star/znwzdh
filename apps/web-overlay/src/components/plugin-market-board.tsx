'use client'

/**
 * 插件市场首页的客户端岛（hero + 筛选 + 插件卡片网格 + 弹窗）。
 *
 * 为什么拆（Batch E，2026-10-21）：插件卡片的 `/marketplace/{slug}` 内链
 * 必须进 **SSR HTML**。改版前整页是客户端组件、useEffect 取数，link-graph
 * 实测当时 64 个插件详情页 100% 孤岛。现在服务端 page 取数经 props 下发，
 * 首帧渲染即 SSR（与 tags / collections 家族同构）。
 *
 * 三种插件形态（全部为声明式 JSON，经 @navhub/core 契约校验，零任意代码执行）：
 *   - site-pack        网站包：站点 + 分类 + 标签
 *   - workspace-preset 工作台预设：Bento 看板与模块组合
 *   - theme            主题：强调色 + 设计 token
 *
 * 数据统一走 /api/hub BFF（见 lib/navhub-api.ts），中枢不可用时降级提示 + 重试。
 * 卡片与安装确认弹窗复用 components/plugins/**（与详情页同一套交互）：
 * 列表页不挂载工作台状态机，workspace-preset 确认后暂存，由 /custom 画布消费。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { fetchPlugins, type HubPluginItem } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { PluginCard } from '@/components/plugins/plugin-card'
import { MarketplaceLoadError } from '@/components/marketplace-load-error'
import { applyMarketplaceListLoad, type MarketplaceListSnapshot } from '@/lib/plugins/marketplace-load-state'
import dynamic from 'next/dynamic'

const PluginInstallModal = dynamic(
  () => import('@/components/plugins/plugin-install-modal').then((m) => m.PluginInstallModal),
  { ssr: false }
)
const PluginTapsModal = dynamic(
  () => import('@/components/plugins/plugin-taps-modal').then((m) => m.PluginTapsModal),
  { ssr: false }
)
const AiPluginStudioModal = dynamic(
  () => import('@/components/plugins/ai-plugin-studio-modal').then((m) => m.AiPluginStudioModal),
  { ssr: false }
)
import { stageWorkspacePreset } from '@/lib/plugins/preset-staging'
import { rankingMetric } from '@/lib/plugins/marketplace-rankings'
import {
  DEFAULT_MARKETPLACE_SORT,
  buildMarketplaceQuery,
  isCountSortDegenerate,
  parseMarketplaceFilters,
  type MarketplaceSort,
} from '@/lib/plugins/marketplace-filters'
import {
  ArrowLeft,
  Crown,
  Flame,
  Loader2,
  PackageCheck,
  Radio,
  Search,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  Upload,
  UserRound,
  X,
} from 'lucide-react'

const PAGE_SIZE = 24

// 专题胶囊的 q 必须在种子数据上命中 > 0（listPlugins 按名称 / 简介 / slug / 清单
// 内容子串匹配；命中数为 0 的胶囊点开即空列表，是死入口）。守卫见 apps/api/test/seed-plugins.test.ts
// 「专题胶囊」describe；改 q 前先实测命中数。2026-11-17 B 批复核：q '武器库' 实测 0 命中
// （只剩 2026-11-15 已卸载网址包「前端武器库」的名字残留），改为 '极客'（实测 13 命中）。
const TOPIC_COLLECTIONS = [
  { id: 'all', title: '全部插件', icon: '🌐' },
  { id: 'trending', title: '🔥 飙升榜', sort: 'trending' },
  { id: 'geek', title: '🚀 极客全栈装备', q: '极客' },
  { id: 'search', title: '🔍 快捷直达引擎', kind: 'search-pack' },
  { id: 'devops', title: '📊 生产力工作台', kind: 'workspace-preset' },
  { id: 'theme', title: '🎨 赛博与暗黑美学', kind: 'theme' },
  { id: 'bundle', title: '🧩 精选组合包', kind: 'bundle' },
] as const

export function resolveActiveTopicId(kind: string, q: string, sort: MarketplaceSort): string {
  if (q) {
    const qTopic = TOPIC_COLLECTIONS.find((t) => 'q' in t && t.q === q)
    if (qTopic && (!('kind' in qTopic) || qTopic.kind === kind)) {
      return qTopic.id
    }
    return ''
  }

  if (kind) {
    const kindTopic = TOPIC_COLLECTIONS.find((t) => 'kind' in t && t.kind === kind && !('q' in t))
    if (kindTopic) {
      return kindTopic.id
    }
    return ''
  }

  if (sort === 'trending') {
    return 'trending'
  }

  return 'all'
}

const KIND_LABELS: Record<string, string> = {
  'site-pack': '网站包',
  'workspace-preset': '工作台预设',
  theme: '主题',
  'search-pack': '搜索引擎包',
  bundle: '组合包',
}

// 热门标签：种子目录真实存在的标签（R2A-2）。旧 7 枚是写死文案，在种子里
// 根本不存在，点开全部返回 0；现每枚都命中真实插件，点击走 q='#tag' 的真实标签查询（R2A-1）。
// 标签云与 0 结果空态共用同一份，避免两处各写一套 drift。
const HOT_TAGS = ['主题', '组合包', '深色', '工作台', '搜索', 'AI', '生活'] as const

export interface PluginMarketBoardProps {
  /** 服务端取的默认视图主列表；null = 服务端没取到，挂载后由既有 effect 客户端取数 */
  initialItems: HubPluginItem[] | null
  initialTotal: number
  /** 服务端从地址栏解析出的初始搜索词：SSR 首帧即写进搜索框，禁用 JS
   * 也能看到当前筛选；同时是非受控输入的 defaultValue，避免水合前后不一致 */
  initialQ?: string
  /** 无筛选时的精选与三榜（服务端预取；null = 未取） */
  initialFeatured: HubPluginItem[] | null
  initialRankings: {
    popular: HubPluginItem[]
    rating: HubPluginItem[]
    fresh: HubPluginItem[]
  } | null
}

export function PluginMarketBoard({
  initialItems,
  initialTotal,
  initialFeatured,
  initialRankings,
  initialQ = '',
}: PluginMarketBoardProps) {
  const identity = useMemo(() => getIdentity(), [])
  // 列表三态（loading / error / empty）共用一份快照：取数失败时不写空兜底
  // （见 applyMarketplaceListLoad），首屏失败改立 loadFailed，由失败态接管列表区。
  const [list, setList] = useState<MarketplaceListSnapshot<HubPluginItem>>({
    items: initialItems ?? [],
    total: initialTotal,
    loadFailed: false,
  })
  // 服务端给了数据就不进骨架屏（SSR 直出卡片）；没给才 loading
  const [loading, setLoading] = useState(initialItems === null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [kind, setKind] = useState('')
  const [sort, setSort] = useState<MarketplaceSort>(DEFAULT_MARKETPLACE_SORT)
  // 星标筛选（F-2）：只看调用方已星标的插件，走 /api/plugins?starred=true，
  // 与地址栏 ?starred=1 双向同步；无身份时服务端返回空页，不退回全量。
  const [starredOnly, setStarredOnly] = useState(false)
  const [qInput, setQInput] = useState(initialQ)
  // 搜索框是非受控输入（defaultValue + ref）：受控输入在水合时会把水合前
  // 用户已敲进框里的文字按 state（''）抹掉，回车也因处理器尚未挂载而丢失，
  // 导致「输入了、回车了，地址栏却没有 ?q=」。非受控输入的水合不碰 DOM 值，
  // 程序化改值（清空/标签/专题/地址栏同步）统一走 setSearchInput 写回 DOM。
  const searchInputRef = useRef<HTMLInputElement>(null)
  const setSearchInput = useCallback((value: string) => {
    setQInput(value)
    if (searchInputRef.current) searchInputRef.current.value = value
  }, [])
  // 两份查询串：qInput 跟着输入法即时走，q 是 150ms 防抖后的生效值。
  // 声明顺序很关键——activeTopicId 会立刻读 q，把 q 放到后面就是 TDZ
  // （ReferenceError: Cannot access 'q' before initialization，整页被 error boundary 接走）。
  const [q, setQ] = useState(initialQ)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim())
    }, 150)
    return () => clearTimeout(timer)
  }, [qInput])

  const activeTopicId = useMemo(
    () => (starredOnly ? '' : resolveActiveTopicId(kind, q, sort)),
    [kind, q, sort, starredOnly],
  )

  const [filtersReady, setFiltersReady] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [installTarget, setInstallTarget] = useState<HubPluginItem | null>(null)
  const [installMode, setInstallMode] = useState<'install' | 'uninstall' | 'upgrade'>('install')

  const handleOpenInstallModal = useCallback(
    (plugin: HubPluginItem, mode: 'install' | 'uninstall' | 'upgrade' = 'install') => {
      setInstallTarget(plugin)
      setInstallMode(mode)
    },
    [],
  )
  const [tapsModalOpen, setTapsModalOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [featured, setFeatured] = useState<HubPluginItem[]>(initialFeatured ?? [])
  const [rankings, setRankings] = useState<{
    popular: HubPluginItem[]
    rating: HubPluginItem[]
    fresh: HubPluginItem[]
  }>(initialRankings ?? { popular: [], rating: [], fresh: [] })

  // 0 结果空态的相关插件（K18）：有筛选且 0 命中时取 3 个热门插件作下一步；
  // 取数失败静默为空，不挡主空态。
  const [related, setRelated] = useState<HubPluginItem[]>([])

  // 统一搜索会深链到 /marketplace?q=...，首次进入必须先从地址栏恢复筛选；
  // 监听 popstate 让浏览器前进/后退也能回到同一组条件。
  useEffect(() => {
    const syncFromUrl = (adoptDomValue: boolean) => {
      const parsed = parseMarketplaceFilters(window.location.search)
      // 先读 DOM 再覆盖：水合前用户敲的字还留在框里，setSearchInput 会按
      // 地址栏把它覆盖掉，读晚了就再也拿不回来（实测：读在覆盖后恒为 ''）。
      const domValue = adoptDomValue ? (searchInputRef.current?.value.trim() ?? '') : ''
      setKind(parsed.kind)
      setQ(parsed.q)
      setSearchInput(parsed.q)
      setSort(parsed.sort)
      setStarredOnly(parsed.starred)
      // 水合前用户已敲进框里的文字不会进 state（处理器尚未挂载），但非受控
      // 输入的 DOM 值还留着：首次挂载认领它（用户最新意图优先于地址栏），
      // 否则水合一完成文字就被地址栏同步抹掉。popstate 不认领——后退/前进
      // 必须回到地址栏那组条件，框里残留的旧文字不能反客为主。
      if (domValue && domValue !== parsed.q) {
        setSearchInput(domValue)
        setQ(domValue)
      }
    }
    syncFromUrl(true)
    setFiltersReady(true)
    const onPopState = () => syncFromUrl(false)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [setSearchInput])

  // 筛选变化只改写地址栏（replaceState），避免每次输入都触发一次服务端导航；
  // 刷新/复制链接后仍能还原条件。默认排序不落参数，保持 /marketplace 干净。
  useEffect(() => {
    if (!filtersReady) return
    const next =
      window.location.pathname +
      buildMarketplaceQuery({ kind, q, sort, starred: starredOnly }) +
      window.location.hash
    const current = window.location.pathname + window.location.search + window.location.hash
    if (next !== current) {
      window.history.replaceState(window.history.state, '', next)
    }
  }, [filtersReady, kind, q, sort, starredOnly])

  const load = useCallback(
    async (offset: number, append: boolean, silent = false) => {
      if (!silent) {
        if (append) setLoadingMore(true)
        else setLoading(true)
        if (!append) setNotice(null)
      }
      let failed = false
      const onDegraded = (error: unknown) => {
        failed = true
        if (!silent) setNotice(describeDegrade(error, '插件市场'))
      }
      const res = await fetchPlugins(
        { kind: kind || undefined, q: q || undefined, sort, starred: starredOnly || undefined, limit: PAGE_SIZE, offset },
        onDegraded,
      )
      // 追加页失败时 res 是降级兜底（items 空、total 0），不能拿它覆盖现有状态：
      // 一次瞬间故障会把「共 N 个」改成 0、加载更多按钮随之消失，后面的页再也到不了，
      // 而列表里明明还留着前面那些插件。失败就保持原样，让用户重试。
      // 静默同步失败同理：不能用空兜底把 SSR 首帧抹掉。
      // 首屏失败同理：不写空兜底，改立 loadFailed，由失败态接管列表区（P1-2）。
      setList((prev) => applyMarketplaceListLoad(prev, res, { failed, append, silent }))
      if (!silent) {
        if (append) setLoadingMore(false)
        else setLoading(false)
      }
    },
    [kind, q, sort, starredOnly],
  )

  // 首帧用服务端数据，但 SSR 拿不到浏览器的匿名身份：挂载后静默重取一次
  // （带身份），只补已装/星标态，不动 loading、不闪骨架——否则刷新后装过
  // 的插件又显示「安装」。无服务端数据时走正常加载（骨架 + 失败提示）。
  // 筛选/排序/搜索变化会改 load 身份触发重取，reloadToken 同理。
  const skipFirstLoad = useRef(initialItems !== null)

  useEffect(() => {
    if (!filtersReady) return
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false
      void load(0, false, true)
      return
    }
    void load(0, false)
  }, [load, filtersReady, reloadToken])

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  const resetFilters = useCallback(() => {
    setKind('')
    setQ('')
    setSearchInput('')
    setSort(DEFAULT_MARKETPLACE_SORT)
    setStarredOnly(false)
  }, [setSearchInput])

  const clearSearch = useCallback(() => {
    setQ('')
    setSearchInput('')
  }, [setSearchInput])

  const patchItem = useCallback((updated: HubPluginItem) => {
    setList((prev) => ({
      ...prev,
      items: prev.items.map((p) => (p.slug === updated.slug ? { ...p, ...updated } : p)),
    }))
    setFeatured((prev) => prev.map((p) => (p.slug === updated.slug ? { ...p, ...updated } : p)))
  }, [])

  const hasFilter = Boolean(q || kind || starredOnly)

  // 计数型排序退化判定（种子 install/star/review 全 0 时与「最新发布」同序）：
  // 只在有结果时注明，0 命中走空态、不叠加两条提示。
  const sortDegenerate = useMemo(() => isCountSortDegenerate(sort, list.items), [sort, list.items])

  // 精选与三榜只在“无筛选”时加载：避免与主列表抢请求，也避免筛选后仍显示无关推荐
  // 首帧同样要静默同步一次（SSR 数据没有身份，精选卡片的已装态同理会丢）；
  // 等地址栏筛选解析完（filtersReady）再取，避免带错筛选条件白跑一趟。
  useEffect(() => {
    if (!filtersReady || hasFilter) return
    let cancelled = false
    void Promise.all([
      fetchPlugins({ featured: true, sort: 'featured', limit: 6 }),
      fetchPlugins({ sort: 'popular', limit: 5 }),
      fetchPlugins({ sort: 'rating', limit: 5 }),
      fetchPlugins({ sort: 'new', limit: 5 }),
    ]).then(([f, popular, rating, fresh]) => {
      if (cancelled) return
      setFeatured(f.items)
      setRankings({ popular: popular.items, rating: rating.items, fresh: fresh.items })
    })
    return () => {
      cancelled = true
    }
  }, [filtersReady, hasFilter, reloadToken])

  // K18：0 结果空态的相关插件。只在「有筛选、已取完、0 命中、非星标视图」时取，
  // 星标空态（「你还没有星标任何插件」）不需要「相关插件」这条路。
  useEffect(() => {
    if (!filtersReady || loading || list.loadFailed || list.items.length > 0 || !hasFilter || starredOnly) {
      setRelated([])
      return
    }
    let cancelled = false
    void fetchPlugins({ sort: 'popular', limit: 3 })
      .then((res) => {
        if (!cancelled) setRelated(res.items.slice(0, 3))
      })
      .catch(() => {
        // 建议位取数失败静默为空，不挡主空态
      })
    return () => {
      cancelled = true
    }
  }, [filtersReady, loading, list.items.length, list.loadFailed, hasFilter, starredOnly])

  function cleanLeaderboardTitle(name: string): string {
    const match = name.match(/^([^\(（]+)[\(（]/)
    if (match && match[1].trim().length >= 4) {
      return match[1].trim()
    }
    return name
  }

  const rankingGroups = [
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

  const handleTopicClick = (topic: typeof TOPIC_COLLECTIONS[number]) => {
    // 专题是通用视图：切专题即退出星标筛选
    setStarredOnly(false)
    if (topic.id === 'all') {
      setKind('')
      setQ('')
      setSearchInput('')
      setSort('popular')
    } else if (topic.id === 'trending') {
      setKind('')
      setQ('')
      setSearchInput('')
      setSort('trending')
    } else {
      if ('kind' in topic && topic.kind) setKind(topic.kind)
      else setKind('')
      if ('q' in topic && topic.q) {
        setQ(topic.q)
        setSearchInput(topic.q)
      } else {
        setQ('')
        setSearchInput('')
      }
      setSort('sort' in topic && typeof topic.sort === 'string' ? (topic.sort as MarketplaceSort) : DEFAULT_MARKETPLACE_SORT)
    }
  }

  return (
    <>
      {/* 外层 Container/div/Breadcrumbs/Footer 由服务端壳提供（page.tsx）；
          本岛只产出内容流（hero/筛选/网格/弹窗），保持 space-y 兄弟节奏 */}
        {/* 顶部展板 */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero p-4 sm:p-7 shadow-xs">
          {/* 装饰层：纯视觉，不拦截交互 */}
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -left-24 top-24 h-48 w-48 rounded-full bg-sky-400/10 blur-3xl" />
          <Store aria-hidden className="pointer-events-none absolute right-5 top-5 hidden h-16 w-16 text-border/70 sm:block" strokeWidth={1} />
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回首页</span>
            </Link>
            <span className="text-border">/</span>
            <span className="text-xs text-primary font-medium flex items-center gap-1">
              <Store className="w-3.5 h-3.5" />
              插件市场
            </span>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="min-w-0 flex-1 max-w-3xl">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                插件市场
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                与社区互换收藏的网址包、工作台布局、主题与搜索引擎包。全部插件都是可读可审计的声明式 JSON，
                不含任何可执行代码；安装前可先看清单预览。
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 shrink-0">
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs justify-center">
                <Link href="/marketplace/installed">
                  <PackageCheck className="w-3.5 h-3.5 text-primary" />
                  <span>已安装管家</span>
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTapsModalOpen(true)}
                className="h-8 gap-1.5 text-xs justify-center border-indigo-500/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-500/10"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Taps 订阅源</span>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs justify-center">
                <Link href="/marketplace/import">
                  <Upload className="w-3.5 h-3.5" />
                  <span>导入插件文件</span>
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs justify-center">
                <Link href="/marketplace/mine">
                  <UserRound className="w-3.5 h-3.5" />
                  <span>作者中心</span>
                </Link>
              </Button>
              <Button
                size="sm"
                onClick={() => setStudioOpen(true)}
                className="h-8 gap-1.5 text-xs justify-center bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-700 text-primary-foreground font-medium shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>✨ AI 生成插件</span>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs justify-center border-primary/40 hover:bg-primary/5 text-primary font-medium">
                <Link href="/marketplace/publish">
                  <span>发布插件</span>
                </Link>
              </Button>
            </div>
          </div>

          {/* 精选专题集胶囊 */}
          <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1">
              <Flame className="w-3 h-3 text-amber-500" />
              精选专题：
            </span>
            {TOPIC_COLLECTIONS.map((topic) => {
              const isTopicActive = activeTopicId === topic.id
              return (
                <button
                  key={topic.id}
                  type="button"
                  aria-pressed={isTopicActive}
                  onClick={() => handleTopicClick(topic)}
                  className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                    isTopicActive
                      ? 'bg-primary text-primary-foreground font-semibold shadow-xs ring-2 ring-primary/20'
                      : 'bg-background/70 hover:bg-background text-muted-foreground hover:text-foreground border border-border/60 hover:border-border hover:-translate-y-px'
                  }`}
                >
                  {topic.title}
                </button>
              )
            })}
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/40 p-2 backdrop-blur-xs">
          <select
            aria-label="按类型筛选"
            className="h-8 rounded-md border border-border-strong bg-background px-2 text-base sm:text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">全部类型</option>
            <option value="site-pack">网站包</option>
            <option value="workspace-preset">工作台预设</option>
            <option value="theme">主题</option>
            <option value="search-pack">搜索引擎包</option>
            <option value="bundle">组合包</option>
          </select>
          <select
            aria-label="排序方式"
            className="h-8 rounded-md border border-border-strong bg-background px-2 text-base sm:text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as MarketplaceSort)}
          >
            <option value="trending">🔥 7天飙升榜</option>
            <option value="new">最新发布</option>
            <option value="popular">安装最多</option>
            <option value="stars">星标最多</option>
            <option value="rating">评分最高</option>
            <option value="updated">最近更新</option>
          </select>
          <button
            type="button"
            aria-pressed={starredOnly}
            aria-label="只看已星标插件"
            title="只看已星标插件"
            onClick={() => setStarredOnly((v) => !v)}
            className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-all ${
              starredOnly
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'border-border-strong bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            已星标
          </button>
          {/* 搜索框包一层原生 form：水合前回车也能原生提交到 /marketplace?q=…
              （与 /search 的 form 同款渐进增强），水合后 React 接管走客户端
              筛选。display:contents 让 form 不产生盒子，布局与原来一致。
              隐藏域把当前 kind/sort/starred 一并带上，原生提交不丢筛选。 */}
          <form
            action="/marketplace"
            method="get"
            className="contents"
            onSubmit={(e) => {
              e.preventDefault()
              setQ((searchInputRef.current?.value ?? qInput).trim())
            }}
          >
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                name="q"
                aria-label="搜索插件"
                ref={searchInputRef}
                defaultValue={initialQ}
                onChange={(e) => setQInput(e.target.value)}
                // 去掉显式「搜索」按钮后，回车必须能立刻提交：直接跳过 150ms 防抖，
                // 与键盘/读屏用户按下「搜索」的语义等价（enterKeyHint 已声明 search）。
                // 读 DOM 实时值而不是 state：水合前敲的字还没进 state，读 state 会是空串。
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    setQ((searchInputRef.current?.value ?? qInput).trim())
                  }
                }}
                // 市场搜索框是插件搜索，不是首页搜索面板：!gh 这类 bang 在这里不执行，
                // 旧占位「!前缀」是虚假宣传。搜索范围是名称 / 描述 / 包内站点与引擎名 / #标签。
                placeholder="搜索名称、描述、包内站点、#标签…"
                enterKeyHint="search"
                className="h-8 w-full rounded-md border border-border-strong bg-background pl-8 pr-7 text-base sm:text-sm transition-colors focus:border-primary"
              />
              {qInput && (
                <button
                  type="button"
                  aria-label="清除输入"
                  onClick={() => {
                    setSearchInput('')
                    setQ('')
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* 隐藏字段只随原生表单提交带参，不可感知：按 search-results.tsx 同款做法标 aria-hidden，免 field-names 守卫误报 */}
            {kind ? <input type="hidden" name="kind" value={kind} readOnly aria-hidden="true" /> : null}
            {sort !== DEFAULT_MARKETPLACE_SORT ? (
              <input type="hidden" name="sort" value={sort} readOnly aria-hidden="true" />
            ) : null}
            {starredOnly ? <input type="hidden" name="starred" value="1" readOnly aria-hidden="true" /> : null}
          </form>
          {list.total > 0 && !loading && !list.loadFailed && (
            <span className="text-xs text-muted-foreground ml-auto" role="status" aria-live="polite">
              共 {list.total} 个插件
            </span>
          )}
        </div>

        {/* 排序退化注明：计数型排序（安装 / 星标 / 评分 / 飙升）在安装量、星标与评价
            全为 0 时与「最新发布」同序，如实注明口径，不编假数据让排序看起来分化。 */}
        {!loading && !list.loadFailed && list.items.length > 0 && sortDegenerate && (
          <p className="rounded-md border border-amber-500/50 bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="sort-degenerate-note" role="status">
            当前插件安装量、星标与评价均为 0，安装 / 星标 / 评分 / 飙升排序结果与最新发布一致
          </p>
        )}

        {/* 热门标签筛选云 (Tag Facets) */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs -mt-2">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1 mr-1">
            <Sparkles className="w-3 h-3 text-primary" />
            热门标签:
          </span>
          {/* 热门标签：与空态推荐词共用 HOT_TAGS（种子真实标签，见模块顶注释）。 */}
          {HOT_TAGS.map((tag) => {
            const isSelected = q === `#${tag}`
            return (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  if (isSelected) {
                    setQ('')
                    setSearchInput('')
                  } else {
                    setQ(`#${tag}`)
                    setSearchInput(`#${tag}`)
                  }
                }}
                className={`px-2 py-0.5 rounded-md text-[11px] transition-all ${
                  isSelected
                    ? 'bg-primary/20 text-primary font-semibold border border-primary/40'
                    : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40'
                }`}
              >
                #{tag}
              </button>
            )
          })}
        </div>

        {/* 当前筛选条件：与地址栏同步，便于一键清除和分享 */}
        {(q || kind || starredOnly) && (
          <div className="flex flex-wrap items-center gap-2 text-xs -mt-2">
            <span className="text-muted-foreground">当前筛选：</span>
            {starredOnly && (
              <button
                type="button"
                onClick={() => setStarredOnly(false)}
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
                aria-label="移除星标筛选"
              >
                只看已星标
                <X className="w-3 h-3" />
              </button>
            )}
            {q && (
              <button
                type="button"
                onClick={clearSearch}
                className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-primary hover:bg-primary/10 transition-colors"
                aria-label={`移除搜索条件 ${q}`}
              >
                搜索“{q}”
                <X className="w-3 h-3" />
              </button>
            )}
            {kind && (
              <button
                type="button"
                onClick={() => setKind('')}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                aria-label={`移除类型筛选 ${KIND_LABELS[kind] ?? kind}`}
              >
                类型：{KIND_LABELS[kind] ?? kind}
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={resetFilters}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              清空全部
            </button>
          </div>
        )}

        {notice && !list.loadFailed && <HubDegradedNotice notice={notice} onRetry={reload} subject="插件市场" />}

        {!hasFilter && featured.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-amber-500" />
                编辑精选
              </h2>
              <span className="text-[11px] text-muted-foreground">人工挑选的社区代表作</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {featured.slice(0, 6).map((p) => (
                <PluginCard
                  key={`featured-${p.id}`}
                  plugin={p}
                  identity={identity}
                  onStatusChange={patchItem}
                  onOpenInstallModal={handleOpenInstallModal}
                />
              ))}
            </div>
          </section>
        )}

        {!hasFilter && (rankings.popular.length > 0 || rankings.rating.length > 0 || rankings.fresh.length > 0) && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {rankingGroups.map((group) => {
              const rows = rankings[group.key]
              const Icon = group.icon
              return (
                <div key={group.key} className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-2.5 transition-colors hover:border-border hover:bg-card">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                    {group.title}
                  </div>
                  {rows.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground py-2">暂无数据</p>
                  ) : (
                    <ol className="space-y-1.5">
                      {rows.map((p, index) => (
                        <li key={`${group.key}-${p.id}`}>
                          <Link
                            href={`/marketplace/${encodeURIComponent(p.slug)}`}
                            title={p.name}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 hover:bg-muted/60 transition-colors"
                          >
                            <span className={`w-4 text-[11px] tabular-nums font-bold ${index === 0 ? 'text-amber-500' : index === 1 ? 'text-slate-400' : index === 2 ? 'text-orange-600/80' : 'text-muted-foreground'}`}>{index + 1}</span>
                            <span className="text-xs font-medium truncate flex-1">{cleanLeaderboardTitle(p.name)}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{group.metric(p)}</span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {/* 列表 */}
        {loading ? (
          <div aria-live="polite" aria-label="正在加载插件市场" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-[1536px]:grid-cols-4! gap-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="rounded-2xl border border-border/70 bg-card/50 p-5 animate-pulse space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-muted" />
                  <div className="h-3.5 w-16 rounded bg-muted" />
                  <div className="h-3.5 w-10 rounded bg-muted" />
                </div>
                <div className="h-4 w-2/3 rounded bg-muted" />
                <div className="space-y-1.5">
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-4/5 rounded bg-muted" />
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-border/50">
                  <div className="h-6 w-14 rounded bg-muted" />
                  <div className="h-6 w-16 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : list.loadFailed ? (
          <MarketplaceLoadError title="插件市场加载失败" notice={notice} onRetry={reload} />
        ) : list.items.length === 0 ? (
          <>
            <div className="py-14 text-center border border-dashed border-border/70 rounded-2xl space-y-3">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-muted/50 shadow-xs">
                <Store className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {starredOnly && list.items.length === 0
                  ? '你还没有星标任何插件'
                  : hasFilter
                    ? '没有匹配的插件，换个筛选条件试试'
                    : '市场还空着——发布第一个插件，分享你的网址收藏或工作台布局'}
              </p>
              {/* K18：0 结果时给下一步——范围说明 + 推荐词 + 一键清除（只在有筛选、
                  非星标视图时出现；星标空态与市场全空态不需要这组入口）。 */}
              {hasFilter && !starredOnly && (
                <>
                  <p className="text-xs text-muted-foreground">
                    搜索范围：插件名称、描述、包内站点与引擎名、标签（#开头）。
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
                    <span className="text-[11px] text-muted-foreground">换个词试试：</span>
                    {HOT_TAGS.map((tag) => {
                      const isSelected = q === `#${tag}`
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setQ('')
                              setSearchInput('')
                            } else {
                              setQ(`#${tag}`)
                              setSearchInput(`#${tag}`)
                            }
                          }}
                          className={`px-2 py-0.5 rounded-md text-[11px] transition-all ${
                            isSelected
                              ? 'bg-primary/20 text-primary font-semibold border border-primary/40'
                              : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40'
                          }`}
                        >
                          #{tag}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              <div className="flex items-center justify-center gap-2">
                {hasFilter && !starredOnly && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={resetFilters}
                    data-testid="empty-clear-filters"
                  >
                    清除搜索与筛选
                  </Button>
                )}
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <Link href="/marketplace/import">
                    <Upload className="w-3.5 h-3.5" />
                    导入文件
                  </Link>
                </Button>
                <Button asChild size="sm" className="gap-1.5">
                  <Link href="/marketplace/publish">发布插件</Link>
                </Button>
              </div>
            </div>
            {related.length > 0 && (
              <section className="space-y-3" data-testid="empty-related">
                <h2 className="text-sm font-semibold">相关插件</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {related.map((p) => (
                    <PluginCard
                      key={`related-${p.id}`}
                      plugin={p}
                      identity={identity}
                      onStatusChange={patchItem}
                      onOpenInstallModal={handleOpenInstallModal}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-[1536px]:grid-cols-4! gap-4">
            {list.items.map((p) => (
              <PluginCard
                key={p.id}
                plugin={p}
                identity={identity}
                onStatusChange={patchItem}
                onOpenInstallModal={handleOpenInstallModal}
              />
            ))}
          </div>
        )}

        {!list.loadFailed && list.items.length < list.total && (
          <div className="text-center">
            <Button
              variant="outline"
              disabled={loadingMore}
              onClick={() => void load(list.items.length, true)}
              className="gap-1.5"
            >
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
              加载更多（{list.items.length}/{list.total}）
            </Button>
          </div>
        )}

        {/* 安装确认弹窗：卡片快捷安装统一走这里（预演范围 + 客户端消费 payload） */}
        <PluginInstallModal
          plugin={installTarget}
          mode={installMode}
          identity={identity}
          open={Boolean(installTarget)}
          onOpenChange={(next) => {
            if (!next) {
              setInstallTarget(null)
              setInstallMode('install')
            }
          }}
          onSuccess={reload}
          onApplyPreset={(preset, mode) => {
            // 列表页不挂载工作台状态机：暂存并由 /custom 画布消费（携带用户选择的模式）
            if (installTarget) {
              stageWorkspacePreset(installTarget.slug, installTarget.name, preset, mode)
            }
          }}
        />

        {/* 远程插件市场 Taps 订阅中心 */}
        <PluginTapsModal
          open={tapsModalOpen}
          onOpenChange={setTapsModalOpen}
          onSynced={reload}
        />

        {/* AI 智能插件工坊 */}
        <AiPluginStudioModal
          open={studioOpen}
          onOpenChange={setStudioOpen}
          onPublished={reload}
        />
    </>
  )
}
