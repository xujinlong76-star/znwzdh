'use client'

/**
 * SearchPalette —— 接入中枢混合检索引擎的命令面板。
 *
 * 与上游 search-bar 的区别：上游只在客户端对 navigation.json 做 includes() 过滤，
 * 拼音 / 语义 / BM25 / 个性化全部闲置。本组件把同一个 ⌘K 面板接到
 * /api/search 上，四路召回 + RRF 融合的结果直接可用。
 *
 * 工程要点：
 *  - 防抖 200ms + AbortController 取消在途请求（快打字不抖动、不竞态）
 *  - 结果带通道徽标（exact/fts/pinyin/semantic/personal）与语义可用性提示
 *  - 中枢不可用时明示降级，而不是假装"没有结果"
 *  - 空查询展示最近搜索（服务端历史，匿名 anonId 也可用）
 */

import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Input } from '@/registry/new-york/ui/input'
import { Command, CommandList } from '@/registry/new-york/ui/command'
import { Search, X, Star, Clock, Loader2, Sparkles, Layers, GitCompare, Zap, ArrowRight, GitFork, Store, Download, ExternalLink } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  searchSites,
  searchPlugins,
  reportClick,
  fetchSearchHistory,
  fetchCollections,
  type HubSearchHit,
  type HubSiteRelation,
  type HubPluginSearchResponse,
  type HubCollection,
} from '@/lib/navhub-api'
import { searchChannelStatus } from '@/lib/search-degrade'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { recordOfflineVisit } from '@/lib/offline-recent'
import { highlightParts } from '@/lib/highlight'
import { planSearchPanel, type SearchPanelAction } from '@/lib/search-panel'
import { getIdentity } from '@/lib/identity'
import { searchHref } from '@/lib/search-page'
import { useFavorites } from '@/hooks/useFavorites'
import { useToast } from '@/components/ui/use-toast'
import type { SiteConfig } from '@/types/site'
import { parseSpeculativeIntent } from '@/lib/speculative'
import { spotlightHotkeyHint, useExternalLinkTarget, useUserPreferences } from '@/lib/user-preferences'
import { parseTechComparisonQuery } from '@/lib/comparison'
import { findMatchingArchitectureRecipe } from '@/lib/architecture-recipe'
import { SiteFavicon } from '@/components/site-favicon'
import { isSafeHttpUrl, safeHref, safeWindowOpen } from '@/lib/safe-url'
import { getModifierKey } from '@/lib/platform'



// 三张「命中才出现」的富卡片：只有查询触发对应意图时才需要它们的代码。
// 静态导入会把投机解析、对比矩阵、架构配方三条知识库一起打进首屏。
const SpeculativeIntentCard = dynamic(
  () => import('@/components/speculative-intent-card').then((m) => m.SpeculativeIntentCard),
  { ssr: false }
)
const TechComparisonCard = dynamic(
  () => import('@/components/tech-comparison-card').then((m) => m.TechComparisonCard),
  { ssr: false }
)
const ArchitectureRecipeCard = dynamic(
  () => import('@/components/architecture-recipe-card').then((m) => m.ArchitectureRecipeCard),
  { ssr: false }
)

const CHANNEL_LABELS: Record<string, string> = {
  exact: '精确',
  fts: '全文',
  pinyin: '拼音',
  semantic: '语义',
  personal: '个性化',
}

/** 结果行文本高亮：命中片段上色，未命中原样（仅字面命中的词有高亮，拼音/语义召回本就无字面） */
function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((seg, i) =>
        seg.hit ? (
          <span key={i} className="text-primary font-semibold bg-primary/10 rounded-xs px-0.5">
            {seg.text}
          </span>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  )
}

interface SearchPaletteProps {
  siteConfig?: SiteConfig
  /** 类目筛选（侧栏点击类目时带入） */
  categoryId?: string
  placeholder?: string
}

export function SearchPalette({ siteConfig, categoryId, placeholder = '搜索导航…（中文 / 拼音 / 语义）' }: SearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  /**
   * 键盘高亮项索引。
   *
   * 输入框在 <Command> 之外（搜索框在顶部，结果面板在其下方），cmdk 的
   * keydown 监听挂在 Command 根节点上，键盘事件从输入框冒泡不到那里——
   * 结果就是「能打字、不能选」：↑↓/Enter 完全无反应，Tab 只会跳到每行的
   * 收藏星标。这里自己维护一条扁平列表（插件在前、站点在后，与 DOM 顺序一致），
   * 并用 aria-activedescendant 把高亮项告知读屏。
   */
  const [activeIndex, setActiveIndex] = useState(-1)
  const [hits, setHits] = useState<HubSearchHit[]>([])
  /** 统一搜索：同一关键词同时召回插件市场条目 */
  const [pluginHits, setPluginHits] = useState<HubPluginSearchResponse | null>(null)
  const [pluginLoading, setPluginLoading] = useState(false)
  /** 插件子检索请求失败：与「插件市场真的没有匹配」区分，不能让失败静默变成空分区 */
  const [pluginFailed, setPluginFailed] = useState(false)
  /** 插件语义未就绪：服务端已关键词回退，必须如实标注 */
  const [pluginSemanticFallback, setPluginSemanticFallback] = useState(false)
  const [allCollections, setAllCollections] = useState<HubCollection[]>([])

  useEffect(() => {
    if (isFocused && allCollections.length === 0) {
      void fetchCollections().then((cols) => {
        if (cols) setAllCollections(cols)
      })
    }
  }, [isFocused, allCollections.length])

  const matchedCollections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return allCollections
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q)) ||
          c.slug.toLowerCase().includes(q),
      )
      .slice(0, 3)
  }, [allCollections, query])
  const [loading, setLoading] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [semanticAvailable, setSemanticAvailable] = useState(true)
  /** 分页：召回池是否还有余量 / 追加页加载中 / 追加页请求失败（失败≠到底） */
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  /** 零结果兜底：推荐词 / 热门词 / 放宽提示（仅零结果时有值） */
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [popular, setPopular] = useState<string[]>([])
  const [fallbackHint, setFallbackHint] = useState<'filter' | 'fuzzy' | undefined>(undefined)
  const [recent, setRecent] = useState<string[]>([])
  /** 中枢不可用（历史拉取降级）：与「真的没有历史」区分，避免把故障渲染成「暂无数据」 */
  const [recentDegraded, setRecentDegraded] = useState(false)
  /** 知识图谱对标与实体关联方案命中 */
  const [relationHits, setRelationHits] = useState<HubSiteRelation[]>([])
  /** 智能析取到的分面筛选意图 */
  const [inferredFacets, setInferredFacets] = useState<Record<string, string[]>>({})
  /** 识别到的标签算子 (#tag) */
  const [inferredTag, setInferredTag] = useState<string | undefined>(undefined)
  /** 识别到的类目算子 (@category) */
  const [inferredCategory, setInferredCategory] = useState<string | undefined>(undefined)
  /** 识别到的负向排除词 (-keyword) */
  const [excludedTerms, setExcludedTerms] = useState<string[]>([])
  const [modKey, setModKey] = useState<string>('⌘')
  useEffect(() => {
    setModKey(getModifierKey())
  }, [])
  /** 零结果编辑距离拼写建议 */
  const [didYouMean, setDidYouMean] = useState<string | undefined>(undefined)
  /** 同义词/标签别名扩展 */
  const [queryExpansion, setQueryExpansion] = useState<string[]>([])
  /** 重试计数：增长即重新发起同一查询（降级时的出口） */
  const [retryToken, setRetryToken] = useState(0)
  const searchRef = useRef<HTMLDivElement>(null)
  const resultsPanelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** 当前查询的权威值：用来丢弃「已经过期的追加页」响应 */
  const activeQueryRef = useRef('')
  /** 「加载更多」在途请求的取消句柄 */
  const moreAbortRef = useRef<AbortController | null>(null)
  /** 已加载到的偏移（不进 React state，避免其变化误触发第一页重查） */
  const offsetRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const identity = useMemo(() => getIdentity(), [])
  const favorites = useFavorites()
  const { toast } = useToast()
  const preferences = useUserPreferences()
  /**
   * 「0-RTT 推测意图即时计算」开关决定要不要原地算：关掉后不再产出算式 / CIDR /
   * UUIDv7 / 时间戳 / 色值 / cron / base64 这类即时结果卡。
   * 此前这条设置在全仓无人读取 —— 用户关掉它，卡片照出，界面在说假话。
   */
  const speculativeResult = useMemo(
    () => (preferences.speculativeZeroRttEnabled ? parseSpeculativeIntent(query) : null),
    [preferences.speculativeZeroRttEnabled, query],
  )
  const comparisonMatrix = useMemo(() => parseTechComparisonQuery(query), [query])
  const architectureRecipe = useMemo(() => findMatchingArchitectureRecipe(query), [query])



  /* 最近搜索：聚焦且空查询时加载 */
  useEffect(() => {
    if (isFocused && !query.trim() && identity) {
      // 中枢不可用时 fetchSearchHistory 返回兜底 []，与「真的没有历史」无法区分；
      // 用局部标记把「已降级」带出 then（onDegraded 在 resolve 之前同步触发）。
      let failed = false
      void fetchSearchHistory(identity, 8, () => {
        failed = true
      }).then((items) => {
        setRecentDegraded(failed)
        setRecent(items)
      })
    }
  }, [isFocused, query, identity])

  /* 点击外部关闭 */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setIsFocused(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  /* 呼出键归 SpotlightModal 一处处理（它是超级控制台唯一的入口，没有别的按钮能开它）。
     原来这里也挂一个 keydown 抢焦点：同一次 ⌘K 既开弹窗又聚焦内联框，
     第二个按键还会把刚开的弹窗 toggle 掉 —— 用户看到的是快捷键失灵。
     内联面板只保留「在自己有焦点时 Esc 收起」。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.activeElement !== inputRef.current) return
      setIsFocused(false)
      inputRef.current?.blur()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /* 防抖检索 + 取消在途请求 */
  useEffect(() => {
    const q = query.trim()
    activeQueryRef.current = q
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()
    // 查询变了，在途的「加载更多」也属于上一个查询，必须一起取消
    if (moreAbortRef.current) moreAbortRef.current.abort()
    // 新查询必须清空旧结果与旧提示：否则防抖 + 网络窗口里会拿上一个查询的结果
    // 冒充新查询的答案（还会带着上一个查询的「已放宽」横幅）
    setHits([])
    setPluginHits(null)
    setPluginLoading(false)
    setPluginFailed(false)
    setPluginSemanticFallback(false)
    setHasMore(false)
    setMoreFailed(false)
    setSuggestions([])
    setPopular([])
    setRelationHits([])
    setInferredFacets({})
    setInferredTag(undefined)
    setInferredCategory(undefined)
    setExcludedTerms([])
    setDidYouMean(undefined)
    setQueryExpansion([])
    setFallbackHint(undefined)
    setDegraded(false)
    setLoadingMore(false)
    if (!q) {
      setLoading(false)
      offsetRef.current = 0
      return
    }
    // 新查询 = 回到第一页（offsetRef 不进依赖，否则追加页会触发重查）
    offsetRef.current = 0
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller
      // 统一搜索：插件召回与站点召回并行，插件失败不影响站点结果
      setPluginLoading(true)
      setPluginFailed(false)
      setPluginSemanticFallback(false)
      // searchPlugins 网络失败时返回 degraded 兜底值而不抛错：只靠 catch 判失败
      // 会把「请求没到达」显示成「插件市场没有匹配」，onDegraded 才是可靠信号
      let pluginRequestFailed = false
      void searchPlugins({ q, limit: 5 }, () => {
        pluginRequestFailed = true
      })
        .then((res) => {
          if (controller.signal.aborted || activeQueryRef.current !== q) return
          const status = searchChannelStatus({
            sites: null,
            plugins: res,
            pluginsFailed: pluginRequestFailed,
          })
          setPluginHits(res)
          setPluginLoading(false)
          setPluginFailed(status.pluginUnavailable)
          setPluginSemanticFallback(status.pluginSemanticFallback)
        })
        .catch(() => {
          if (controller.signal.aborted || activeQueryRef.current !== q) return
          setPluginHits(null)
          setPluginLoading(false)
          setPluginFailed(true)
          setPluginSemanticFallback(false)
        })
      void searchSites({ q, limit: 12, categoryId, identity }, controller.signal)
        .then((res) => {
          if (controller.signal.aborted || activeQueryRef.current !== q) return
          setHits(res.hits)
          setDegraded(Boolean(res.degraded))
          setSemanticAvailable(res.semanticAvailable)
          setHasMore(Boolean(res.hasMore))
          setSuggestions(res.suggestions ?? [])
          setPopular(res.popular ?? [])
          setRelationHits(res.relationHits ?? [])
          setInferredFacets(res.inferredFacets ?? {})
          setInferredTag(res.inferredTag)
          setInferredCategory(res.inferredCategory)
          setExcludedTerms(res.excludedTerms ?? [])
          setDidYouMean(res.didYouMean)
          setQueryExpansion(res.queryExpansion ?? [])
          setFallbackHint(res.fallback)
          offsetRef.current = res.hits.length
          setLoading(false)
        })
        .catch(() => {
          if (controller.signal.aborted || activeQueryRef.current !== q) return
          setLoading(false)
          setDegraded(true)
        })
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, categoryId, identity, retryToken])

  /** 加载下一页并追加（同一查询的延续——服务端因此不重复记事件） */
  const loadMore = useCallback(() => {
    const q = query.trim()
    if (!q || loadingMore) return
    setLoadingMore(true)
    setMoreFailed(false)
    const controller = new AbortController()
    moreAbortRef.current = controller
    void searchSites({ q, limit: 12, offset: offsetRef.current, categoryId, identity }, controller.signal)
      .then((res) => {
        // 查询已经变了：这一页属于上一个查询。放进去会把旧结果混进新列表，
        // offsetRef 也会被污染，后续分页永远错位。
        if (controller.signal.aborted || activeQueryRef.current !== q) return
        setHits((prev) => [...prev, ...res.hits])
        offsetRef.current += res.hits.length
        setHasMore(Boolean(res.hasMore))
        // 追加页为空 = 池子到底（防御：服务端说有但实际没有）
        if (res.hits.length === 0) setHasMore(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        // 请求失败 ≠ 召回池到底：以前这里把 hasMore 置 false，按钮从此消失，
        // 一次瞬间故障就把后面的结果永久封住，而且没有任何说明。
        setMoreFailed(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false)
      })
  }, [query, categoryId, identity, loadingMore])

  /** 提示块里的出口动作 */
  const runPanelAction = useCallback((action: SearchPanelAction) => {
    if (action.kind === 'retry') {
      setRetryToken((n) => n + 1)
      return
    }
    if (action.kind === 'clear') {
      setQuery('')
      setIsFocused(false)
      return
    }
    // browse-* 由 <Link> 渲染，走客户端路由，不发生整页刷新
  }, [])

  // 打开方式听用户中心的开关，站点配置只当默认值
  const linkTarget = useExternalLinkTarget(siteConfig?.navigation?.linkTarget)

  const openSite = useCallback((hit: HubSearchHit) => {
    const site = hit.site
    if (!site) return
    // 把「这次命中来自哪一路」带回中枢：telemetry.ts 只有在带 query 时才更新
    // LinUCB 通道权重；只发 siteId 会让在线学习永远收不到真实反馈。
    const channel = Object.entries(hit.contributions ?? {})
      .sort((a, b) => b[1].value - a[1].value)[0]?.[0]
    reportClick(site.id, identity, { query, channel })
    // site.url 来自后端检索结果（源头是站点库），同样过安全闸：
    // 非 http(s) 一律不跳，避免 javascript: 之类的脏数据直达执行
    const url = safeHref(site.url, '')
    if (!url || !isSafeHttpUrl(url)) return
    // 离线可用性（P2-3）：把这次访问写进本地「最近访问」快照（IndexedDB，
    // 隐私模式降级 localStorage）。断网时用户仍能从本地列表回到常用站点。
    // 放在安全闸之后：只记录真的会打开的站点。
    recordOfflineVisit({
      id: site.id,
      title: site.title ?? site.url,
      href: url,
      icon: site.iconKey ?? null,
    })
    if (linkTarget === '_self') window.location.href = url
    else window.open(url, linkTarget, 'noopener,noreferrer')
    setQuery('')
    setIsFocused(false)
  }, [identity, linkTarget, query])

  const showResults = isFocused && query.trim().length > 0
  /**
   * 「什么都没有」时到底说什么：单一判定点。
   * 避免「检索服务暂时不可用」和「未找到…」同时出现（自相矛盾），
   * 也保证零结果一定给出出口，并且不因命中微组件就隐瞒「导航检索为空」。
   */
  const pluginItems = pluginHits?.items ?? []

  /**
   * 键盘可导航项：与渲染顺序严格一致（插件分区在站点命中之前）。
   * 站点命中里 site 为空的脏数据不渲染，也不进导航列表——否则索引会错位。
   */
  const navItems = useMemo(() => {
    if (!showResults) return [] as Array<{ id: string; kind: 'plugin' | 'site' }>
    const items: Array<{ id: string; kind: 'plugin' | 'site' }> = []
    for (const p of pluginItems) items.push({ id: `plugin-${p.id}`, kind: 'plugin' })
    for (const h of hits) {
      if (h.site) items.push({ id: `site-${h.siteId}`, kind: 'site' })
    }
    return items
  }, [showResults, pluginItems, hits])

  const navIndexById = useMemo(() => {
    const map = new Map<string, number>()
    navItems.forEach((item, index) => map.set(item.id, index))
    return map
  }, [navItems])

  // 查询词或结果集变化后，旧高亮可能指向另一条站点：归零比「跳到第 5 条」更可预期
  useEffect(() => {
    setActiveIndex(-1)
  }, [query])

  useEffect(() => {
    if (activeIndex >= navItems.length) setActiveIndex(-1)
  }, [activeIndex, navItems.length])

  /** 按扁平索引找真实行（插件是 Link、站点是 cmdk Item，二者 id 生成方式不同） */
  const findOptionElement = useCallback((index: number) => {
    return resultsPanelRef.current?.querySelector<HTMLElement>(`[data-nav-index="${index}"]`) ?? null
  }, [])

  /** 把高亮项滚进可视区（结果面板自身可滚动，浏览器默认只滚外层） */
  useEffect(() => {
    if (activeIndex < 0) return
    findOptionElement(activeIndex)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, navItems.length, findOptionElement])

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showResults) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (navItems.length === 0) return
        e.preventDefault()
        setActiveIndex((prev) => {
          if (e.key === 'ArrowDown') return prev < 0 ? 0 : (prev + 1) % navItems.length
          return prev <= 0 ? navItems.length - 1 : prev - 1
        })
        return
      }
      if (e.key === 'Enter') {
        if (navItems.length === 0) return
        // 没有高亮项时回车 = 打开第一条结果。原实现在 activeIndex === -1（默认态）
        // 直接忽略，「输完词直接回车」这个最常见的动作等于完全没反应。
        const target = activeIndex >= 0 ? activeIndex : 0
        // 交给真实元素处理：站点行是 role=option 的 div（onClick 打开），插件行是 Link（路由跳转）
        const el = findOptionElement(target)
        if (el) {
          e.preventDefault()
          el.click()
        }
        return
      }
      if (e.key === 'Escape') {
        setIsFocused(false)
        inputRef.current?.blur()
      }
    },
    [showResults, navItems.length, activeIndex, findOptionElement],
  )

  const panel = planSearchPanel({
    loading: loading || pluginLoading,
    degraded,
    hitCount: hits.length + pluginItems.length,
    query,
    hasWidgetResult: Boolean(
      speculativeResult ||
      comparisonMatrix ||
      architectureRecipe ||
      relationHits.length > 0 ||
      didYouMean ||
      inferredTag ||
      inferredCategory ||
      excludedTerms.length > 0 ||
      Object.keys(inferredFacets).length > 0
    ),
    searchEngine: preferences.defaultSearchEngine,
  })

  return (
    <div ref={searchRef} className="relative w-full max-w-lg mx-auto">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input aria-label={placeholder}
          data-search-input
          ref={inputRef}
          role="combobox"
          aria-expanded={isFocused}
          aria-autocomplete="list"
          aria-controls={showResults ? 'navhub-search-results-panel' : isFocused ? 'navhub-search-suggest-panel' : undefined}
          aria-activedescendant={
            activeIndex >= 0 && navItems.length > 0 ? `navhub-search-opt-${activeIndex}` : undefined
          }
          onKeyDown={onSearchKeyDown}
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsFocused(true) }}
          onFocus={() => setIsFocused(true)}
          className="pl-9 sm:pl-10 pr-9 sm:pr-20 h-9.5 sm:h-10 rounded-xl border border-border/70 hover:border-border bg-background/90 dark:bg-muted/20 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 shadow-xs text-base sm:text-sm transition-all"
        />
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1.5">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {query && (
            <Button variant="ghost" size="sm" onClick={() => { setQuery(''); inputRef.current?.focus() }} className="h-6 w-6 p-0 rounded-full hover:bg-muted" aria-label="清空搜索词" title="清空搜索词">
              <X className="h-3 w-3" />
            </Button>
          )}
          <kbd className="hidden h-5 select-none items-center gap-0.5 rounded-md border border-border/50 bg-muted/60 px-1.5 font-mono text-xs font-semibold text-muted-foreground opacity-100 sm:flex shadow-2xs" title={spotlightHotkeyHint(preferences.spotlightShortcut, modKey) + ' 呼出超级搜索'}>
            {/* 徽标必须与真正生效的呼出键一致：选了「仅 /」还显示 ⌘K 就是在骗用户 */}
            <span>{spotlightHotkeyHint(preferences.spotlightShortcut, modKey)}</span>
          </kbd>
        </div>
      </div>

      {/* 读屏播报：输入是防抖的，结果更新没有视觉焦点变化，
          没有 live region 时读屏用户完全不知道「搜到了几条 / 搜完了」。
          role=status 隐含 aria-live=polite，只播报增量，不打断当前朗读。 */}
      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? '正在检索'
          : query.trim()
            ? degraded && hits.length === 0
              ? // 读屏同样不能把「没问成功」说成「没有找到」
                '检索服务暂时不可用，本次没有取回站点结果'
              : hits.length > 0 || pluginItems.length > 0
                ? `找到 ${hits.length + pluginItems.length} 条结果`
                : '没有找到匹配结果'
            : ''}
      </p>

      {isFocused && !query.trim() && (
        <div id="navhub-search-suggest-panel" className="fixed inset-x-3 top-[calc(3.75rem+max(env(safe-area-inset-top,0px),0px))] sm:absolute sm:inset-x-auto sm:top-full sm:left-0 sm:right-0 mt-0 sm:mt-2.5 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl z-50 max-h-[min(75vh,calc(100dvh-120px))] overflow-y-auto divide-y divide-border/60 animate-in fade-in-50 zoom-in-95 duration-150">
          {recentDegraded && recent.length === 0 && (
            <div className="px-3.5 py-2 text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/40">
              <Clock className="h-3 w-3" /> 最近搜索暂时不可用（服务未响应）
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <div className="px-3.5 py-2 text-xs font-medium text-muted-foreground flex items-center gap-1.5 bg-muted/40">
                <Clock className="h-3 w-3" /> 最近搜索
              </div>
              <div className="p-1">
                {recent.map((r) => (
                  <button
                    key={r}
                    className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground flex items-center justify-between"
                    onClick={() => setQuery(r)}
                  >
                    <span>{r}</span>
                    <ArrowRight className="h-3 w-3 opacity-40" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-3 bg-card">
            <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3 w-3 text-amber-500" />
              下一代认知推测与架构探索（点击立即体验）
            </div>

            <div className="space-y-2">
              <div>
                <div className="text-xs text-muted-foreground/80 mb-1 flex items-center gap-1">
                  <GitCompare className="h-2.5 w-2.5 text-blue-500" /> 竞品选型多维判胜矩阵
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'React vs Vue', q: 'react vs vue' },
                    { label: 'Cursor vs VS Code', q: 'cursor vs vscode' },
                    { label: 'pnpm vs Bun', q: 'pnpm vs bun' },
                  ].map((chip) => (
                    <button
                      key={chip.q}
                      onClick={() => setQuery(chip.q)}
                      className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground/80 mb-1 flex items-center gap-1">
                  <Layers className="h-2.5 w-2.5 text-purple-500" /> Graph-RAG 技术栈蓝图配方
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '本地 RAG 知识库配方', q: '@recipe 本地rag' },
                    { label: '协同富文本配方', q: '@recipe 协同文档' },
                  ].map((chip) => (
                    <button
                      key={chip.q}
                      onClick={() => setQuery(chip.q)}
                      className="px-2 py-0.5 rounded text-xs bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 transition-colors"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground/80 mb-1 flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5 text-emerald-500" /> 0-RTT 端侧推测执行
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '2^10 * 8 (计算器)', q: '2^10 * 8' },
                    { label: '/^[a-z0-9]+$/i (正则)', q: '/^[a-z0-9_-]+$/i' },
                    { label: '^1.2.0 vs 1.4.0 (版本)', q: 'semver: ^1.2.0 vs 1.4.0' },
                    { label: '418 / 502 (状态码)', q: '418' },
                    { label: '#3b82f6 (色彩空间)', q: '#3b82f6' },
                    { label: 'now (时间戳)', q: 'now' },
                    { label: '@b64 Hello (编解码)', q: '@b64 Hello' },
                  ].map((chip) => (
                    <button
                      key={chip.q}
                      onClick={() => setQuery(chip.q)}
                      className="px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors font-mono"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showResults && (
        <div id="navhub-search-results-panel" ref={resultsPanelRef} className="fixed inset-x-3 top-[calc(3.75rem+max(env(safe-area-inset-top,0px),0px))] sm:absolute sm:inset-x-auto sm:top-full sm:left-0 sm:right-0 mt-0 sm:mt-2.5 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl z-50 max-h-[min(75vh,calc(100dvh-120px))] flex flex-col overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
          <Command className="border-0 shadow-none flex-1 overflow-hidden" shouldFilter={false}>
            <CommandList className="max-h-[min(75vh,calc(100dvh-120px))] overflow-y-auto">
              {degraded && panel.mode !== 'outage' && (
                <div className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400 border-b flex items-center justify-between gap-2">
                  <span>
                    {hits.length > 0
                      ? '检索服务暂时不可用，已降级；下面结果可能不完整。'
                      : '站点检索这次没能问成功，下面的结果不保证覆盖；插件结果不受影响。'}
                  </span>
                  <button
                    className="underline underline-offset-2 hover:no-underline shrink-0"
                    onClick={() => setRetryToken((n) => n + 1)}
                  >
                    重试
                  </button>
                </div>
              )}
              {!degraded && !semanticAvailable && (
                <div className="px-3 py-2 text-xs text-muted-foreground border-b">
                  语义检索不可用（未配置本地模型），当前为关键词 / 拼音 / 全文混合检索。
                </div>
              )}
              {fallbackHint && hits.length > 0 && (
                <div className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400 border-b">
                  {fallbackHint === 'filter'
                    ? '当前筛选下没有结果，已放宽到全库匹配（结果可能来自其他类目）。'
                    : '没有精确匹配，以下是放宽匹配后的结果。'}
                </div>
              )}
              {speculativeResult && (
                <div className="p-2 border-b">
                  <SpeculativeIntentCard result={speculativeResult} />
                </div>
              )}
              {comparisonMatrix && (
                <div className="p-2 border-b">
                  <TechComparisonCard matrix={comparisonMatrix} />
                </div>
              )}
              {architectureRecipe && (
                <div className="p-2 border-b">
                  <ArchitectureRecipeCard recipe={architectureRecipe} />
                </div>
              )}
              {/* 自动识别的分面筛选与检索算子胶囊 */}
              {(Object.keys(inferredFacets).length > 0 || inferredTag || inferredCategory || excludedTerms.length > 0 || queryExpansion.length > 0) && (
                <div className="px-3 py-1.5 bg-primary/5 border-b border-border/50 flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1 text-primary font-medium text-[11px]">
                    <Sparkles className="w-3 h-3" />
                    <span>意图解析：</span>
                  </span>
                  {inferredTag && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
                      <span>#{inferredTag}</span>
                    </span>
                  )}
                  {inferredCategory && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      <span>@{inferredCategory}</span>
                    </span>
                  )}
                  {excludedTerms.map((ex) => (
                    <span
                      key={ex}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                    >
                      <span>-{ex}</span>
                    </span>
                  ))}
                  {queryExpansion.map((exp) => (
                    <span
                      key={exp}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                    >
                      <span>~{exp}</span>
                    </span>
                  ))}
                  {Object.entries(inferredFacets).map(([fKey, vals]) => (
                    <span
                      key={fKey}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground border border-border/60"
                    >
                      <span className="text-muted-foreground">{fKey}:</span>
                      <span className="font-semibold text-foreground">{vals.join(', ')}</span>
                    </span>
                  ))}
                </div>
              )}
              {/* 知识图谱对标与实体方案推荐 (Phase 3 知识图谱联动) */}
              {relationHits.length > 0 && (
                <div className="p-3 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-b border-amber-500/20">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">
                    <GitFork className="w-3.5 h-3.5 text-amber-500" />
                    <span>知识图谱对标方案推荐：为您找到 “{query}” 的开源/平替选项</span>
                  </div>
                  <div className="space-y-2">
                    {relationHits.map((rel) => (
                      <div
                        key={rel.id}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-card/90 border border-border/70 hover:border-amber-500/40 transition-colors shadow-2xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs sm:text-sm text-foreground truncate">
                              {rel.sourceSite?.title || '推荐站点'}
                            </span>
                            {rel.isFreeOrOpenSource && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20 flex-shrink-0">
                                开源/免费
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground truncate">
                              对标 {rel.targetTitle}
                            </span>
                          </div>
                          {rel.note && (
                            <p className="text-xs text-muted-foreground/90 line-clamp-1 mt-0.5">
                              💡 {rel.note}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {rel.sourceSite && (
                            <Button asChild size="sm" variant="outline" className="h-7 text-xs px-2.5">
                              <Link href={`/site/${rel.sourceSite.id}`} onClick={() => setIsFocused(false)}>
                                详情
                              </Link>
                            </Button>
                          )}
                          {rel.sourceSite && (
                            <Button asChild size="sm" variant="default" className="h-7 text-xs px-2.5">
                              <a href={safeHref(rel.sourceSite.url)} target="_blank" rel="noopener noreferrer">
                                直达
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 统一搜索：插件市场命中（语义/关键词由 /api/plugins/search 返回） */}
              {/* 精选专题匹配推荐 */}
              {matchedCollections.length > 0 && (
                <div className="border-b border-border/70 bg-violet-500/5 p-2.5">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-xs font-semibold text-violet-600 dark:text-violet-400 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />
                      精选专题推荐
                    </span>
                    <Link
                      href="/collections"
                      onClick={() => setIsFocused(false)}
                      className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
                    >
                      查看全部专题 →
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {matchedCollections.map((col) => (
                      <Link
                        key={col.id}
                        href={`/collections/${encodeURIComponent(col.slug)}`}
                        onClick={() => setIsFocused(false)}
                        className="flex items-center gap-2 p-2 rounded-lg border border-violet-500/20 bg-card hover:bg-violet-500/10 transition-colors"
                      >
                        <Layers className="h-4 w-4 text-violet-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-foreground truncate">{col.title}</div>
                          {col.description && (
                            <div className="text-[10px] text-muted-foreground truncate">{col.description}</div>
                          )}
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 shrink-0 font-medium">
                          {col.kind === 'roadmap' ? '路线图' : '专题'}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {pluginItems.length > 0 && (
                <div className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center justify-between gap-2 bg-primary/5">
                    <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                      <Store className="h-3.5 w-3.5" />
                      插件市场
                      {pluginLoading && <Loader2 className="h-3 w-3 animate-spin opacity-60" />}
                      {pluginSemanticFallback && (
                        <span className="text-[10px] font-normal text-muted-foreground">语义未就绪 · 关键词匹配</span>
                      )}
                    </span>
                    <Link
                      href={`/marketplace?q=${encodeURIComponent(query.trim())}`}
                      onClick={() => setIsFocused(false)}
                      className="text-[11px] text-primary/80 hover:text-primary hover:underline"
                    >
                      查看全部插件结果
                    </Link>
                  </div>
                  <div className="p-1.5 space-y-1">
                    {pluginItems.map((p) => (
                      <Link
                        key={p.id}
                        id={`navhub-search-opt-${navIndexById.get('plugin-' + p.id) ?? -1}`}
                        data-nav-index={navIndexById.get('plugin-' + p.id) ?? -1}
                        data-nav-item="plugin"
                        aria-current={navIndexById.get('plugin-' + p.id) === activeIndex ? 'true' : undefined}
                        href={`/marketplace/${encodeURIComponent(p.slug)}`}
                        onClick={() => setIsFocused(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                          navIndexById.get('plugin-' + p.id) === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                        }`}
                      >
                        <span className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                          <Store className="h-4 w-4 text-primary" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">
                              <Highlighted text={p.name} query={query} />
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                              {pluginKindLabel(p.kind)}
                            </span>
                          </span>
                          {p.description && (
                            <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              <Highlighted text={p.description} query={query} />
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0 font-mono">
                          {(p.installCount ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                              <Download className="h-3 w-3" />
                              {p.installCount}
                            </span>
                          )}
                          {(p.reviewCount ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-amber-500">
                              <Star className="h-3 w-3 fill-amber-400" />
                              {(p.ratingAvg ?? 0).toFixed(1)}
                            </span>
                          )}
                          <ArrowRight className="h-3 w-3 opacity-40" />
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {pluginFailed && pluginItems.length === 0 && (
                <div className="px-3.5 py-2 text-[11px] text-amber-600 dark:text-amber-400 border-b flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>插件结果本次没有取回（不是插件市场没有匹配），站点结果不受影响。</span>
                  <button
                    className="underline underline-offset-2 hover:no-underline shrink-0"
                    onClick={() => setRetryToken((n) => n + 1)}
                  >
                    重试
                  </button>
                </div>
              )}
              {panel.mode !== 'hidden' ? (
                <div className="py-6 px-3 text-center">
                  <div className="text-muted-foreground text-sm">{panel.title}</div>
                  <div className="text-xs text-muted-foreground/70 mt-1">{panel.hint}</div>
                  {didYouMean && (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-foreground">
                      <span>💡 您是不是想搜：</span>
                      <button
                        type="button"
                        className="font-bold underline text-primary hover:text-primary/80 cursor-pointer"
                        onClick={() => setQuery(didYouMean)}
                      >
                        {didYouMean}
                      </button>
                      <span>？</span>
                    </div>
                  )}
                  {suggestions.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs text-muted-foreground mb-2">试试这些搜索</div>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {suggestions.map((s) => (
                          <button
                            key={s}
                            className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            onClick={() => setQuery(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {popular.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs text-muted-foreground mb-2">热门搜索</div>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {popular.map((s) => (
                          <button
                            key={s}
                            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-accent transition-colors"
                            onClick={() => setQuery(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {panel.actions.length > 0 && (
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {panel.actions.map((action) =>
                        action.external ? (
                          <a
                            key={action.kind}
                            href={safeHref(action.href ?? '', '')}
                            target={linkTarget}
                            rel="noopener noreferrer nofollow"
                            onClick={() => setIsFocused(false)}
                            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-accent transition-colors inline-flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {action.label}
                          </a>
                        ) : action.href ? (
                          <Link
                            key={action.kind}
                            href={safeHref(action.href)}
                            onClick={() => setIsFocused(false)}
                            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-accent transition-colors"
                          >
                            {action.label}
                          </Link>
                        ) : (
                          <button
                            key={action.kind}
                            className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            onClick={() => runPanelAction(action)}
                          >
                            {action.label}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ) : (


                hits.map((hit) => {
                  const site = hit.site
                  if (!site) return null
                  const channels = Object.keys(hit.contributions ?? {})
                  const faved = favorites.isFavorite(site.id)
                  return (
                    <div
                      key={hit.siteId}
                      id={`navhub-search-opt-${navIndexById.get('site-' + site.id) ?? -1}`}
                      role="option"
                      data-nav-index={navIndexById.get('site-' + site.id) ?? -1}
                      data-nav-item="site"
                      aria-selected={navIndexById.get('site-' + site.id) === activeIndex}
                      onClick={() => openSite(hit)}
                      className={`flex items-center gap-3 py-3 px-3 cursor-pointer ${
                        navIndexById.get('site-' + site.id) === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-md p-1 bg-muted/60 dark:bg-muted/30 border border-border/50 flex items-center justify-center">
                        <SiteFavicon
                          title={site.title}
                          url={site.url}
                          icon={site.iconKey ?? undefined}
                          className="w-full h-full object-contain rounded-xs"
                        />
                      </div>
                      <div className="flex flex-col flex-1 gap-1 min-w-0">
                        <span className="text-sm font-medium truncate">
                          <Highlighted text={site.title} query={query} />
                        </span>
                        {site.description && (
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            <Highlighted text={site.description} query={query} />
                          </span>
                        )}
                        <div className="flex items-center gap-1 flex-wrap">
                          {(site.status === 'broken' || site.health?.ok === false) && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium border border-amber-500/20 inline-flex items-center gap-1"
                              title="检测到站点当前可能无法直接访问，已就绪 Wayback 时光机自愈镜像"
                            >
                              <Clock className="w-2.5 h-2.5 text-amber-500" />
                              <span>快照自愈</span>
                            </span>
                          )}
                          {channels.map((c) => (
                            <span
                              key={c}
                              className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"
                              title={c === 'personal' ? '来自你近 30 天的点击与收藏偏好（可在「偏好设置」查看或清理画像）' : undefined}
                            >
                              {CHANNEL_LABELS[c] ?? c}
                            </span>
                          ))}
                          {site.tags?.slice(0, 3).map((t) => (
                            <span key={t} className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{t}</span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="flex-shrink-0 p-1 rounded hover:bg-muted"
                        title={faved ? '取消收藏' : '收藏'}
                        onClick={(e) => {
                          e.stopPropagation()
                          // 存储读不出来时写入会被拒绝（为了不覆盖原数据）：必须说出来
                          if (favorites.storageBlocked) {
                            toast({ title: '这一下没能保存', description: favorites.storageBlocked, variant: 'destructive' })
                            return
                          }
                          void favorites.toggle({
                            siteId: site.id, title: site.title, href: site.url,
                            icon: site.iconKey ?? undefined, description: site.description ?? undefined,
                          })
                        }}
                      >
                        <Star className={'h-4 w-4 ' + (faved ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
                      </button>
                    </div>
                  )
                })
              )}
              {/* 键盘提示：能力存在但没人知道，等于不存在（桌面端才显示） */}
              {(hits.length > 0 || pluginItems.length > 0) && (
                <div className="hidden sm:flex items-center gap-3 border-t border-border/60 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border/70 bg-background px-1 font-mono">↑</kbd>
                    <kbd className="rounded border border-border/70 bg-background px-1 font-mono">↓</kbd>
                    选择
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Enter</kbd>
                    打开
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Esc</kbd>
                    关闭
                  </span>
                </div>
              )}
              {showResults && hits.length > 0 && hasMore && (
                <div className="p-2 border-t">
                  <button
                    className="w-full text-xs py-2 rounded-md bg-muted hover:bg-accent text-muted-foreground transition-colors disabled:opacity-50"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore
                      ? '加载中…'
                      : moreFailed
                        ? `再试一次（已显示 ${hits.length} 条）`
                        : `加载更多（已显示 ${hits.length} 条）`}
                  </button>
                  {moreFailed && (
                    <p className="pt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                      下一页没加载成功（请求失败，不是没有更多了）。已显示的 {hits.length} 条仍然可用，点上面按钮可再试。
                    </p>
                  )}
                </div>
              )}
              {showResults && query.trim() && hits.length > 0 && (
                <div className="border-t border-border/60 bg-muted/10 px-2 py-1.5">
                  <Link
                    href={searchHref({ q: query })}
                    onClick={() => setIsFocused(false)}
                    className="flex items-center justify-center gap-1 rounded-md py-1 text-xs text-primary/90 transition-colors hover:bg-primary/5 hover:text-primary"
                  >
                    查看全部结果
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              )}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  )
}
