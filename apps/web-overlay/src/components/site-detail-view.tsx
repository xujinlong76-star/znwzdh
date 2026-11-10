'use client'

/**
 * 站点详情客户端岛（SiteDetailView）：完整信息 + 正交分面属性 + 强类型实体平替生态图谱 + 向量相似推荐。
 *
 * 由 `app/site/[id]/page.tsx` 服务端壳下发 id 与首屏 `initialSite` 后挂载。
 * 壳负责软 404 判定（hubGetProbe 确认不存在 → notFound()）与元信息；本岛
 * 只管渲染与交互——2026-10-21 从 page.tsx 整体抽出，交互代码原样保留。
 * 有 initialSite 时首屏不再重复请求（SSR 直出 `<h1>` 与正文），重试仍走客户端。
 *
 * 核心能力：
 * 1. 核心站点展板：Favicon、巡检状态、点击频次、外链与一键复制
 * 2. 正交分面属性胶囊：价格模型（免费/开源/商业）、支持平台、架构形态与语言
 * 3. 强类型实体知识图谱：对标平替 (Alternative)、生态搭配 (Complementary) 与上下游依赖 (Upstream)
 * 4. 向量相似推荐：基于嵌入向量 KNN 的相关站点发现
 */

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { FavoriteButton } from '@/components/favorite-button'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { tagSlug } from '@/lib/seo/tag-slug'
import {
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  Activity,
  AlertTriangle,
  ArrowRight,
  GitFork,
  Boxes,
  LayoutGrid,
  ShieldCheck,
  Tag,
  DollarSign,
  Laptop,
  Box,
  Globe,
  Layers,
  X,
  MonitorPlay,
  FileText,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { probeSiteLatency, type PingResult } from '@/lib/site-ping'
import {
  fetchSite,
  fetchSimilar,
  fetchSiteRelations,
  fetchSiteCollections,
  fetchSiteHealthHistory,
  fetchSiteAlternatives,
  type HubSite,
  type HubSiteRelation,
  type HubCollection,
  type HealthCheckPoint,
} from '@/lib/navhub-api'
import { EmptyState } from '@/components/ui/empty-state'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { copyText } from '@/lib/clipboard'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { SiteFavicon } from '@/components/site-favicon'
import { isBotBlockStatus, siteHealthBadge } from '@/lib/site-health'
import { safeHref } from '@/lib/safe-url'
import { cn } from '@/lib/utils'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'

const RELATION_TYPE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  alternative: {
    label: '对标平替',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
  },
  complementary: {
    label: '生态搭配',
    color: 'text-indigo-700 dark:text-indigo-300',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800',
  },
  ecosystem: {
    label: '同技术生态',
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
  },
  part_of: {
    label: '套件组件',
    color: 'text-purple-700 dark:text-purple-300',
    bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800',
  },
  upstream: {
    label: '核心依赖',
    color: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
  },
  mirror: {
    label: '镜像分流',
    color: 'text-cyan-700 dark:text-cyan-300',
    bg: 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800',
  },
  related: {
    label: '关联项目',
    color: 'text-gray-700 dark:text-gray-300',
    bg: 'bg-gray-50 dark:bg-gray-950/40 border-gray-200 dark:border-gray-800',
  },
}

const FACET_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  pricing: { label: '付费模式', icon: DollarSign },
  platform: { label: '运行平台', icon: Laptop },
  form: { label: '形态架构', icon: Box },
  language: { label: '界面语言', icon: Globe },
}

/** 域名：解析失败就原样返回，绝不因为脏 URL 把整页打挂 */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** 档案里的日期：缺失/非法时间戳返回 null，由调用方决定整行不渲染 */
function formatArchiveDay(ts: number | null | undefined): string | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null
  try {
    return new Date(ts).toLocaleDateString('zh-CN')
  } catch {
    return null
  }
}

/**
 * 收录时长（天）。未来时间戳与非法值一律返回 null：
 * 种子数据里出现过「更新时间在未来」的脏行，直接减会得到负数，写进正文就是错的。
 */
function daysSince(ts: number | null | undefined): number | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  return days >= 0 ? days : null
}

/**
 * 健康历史 sparkline：把最近 N 次巡检画成一条折线。
 * ok=true 的点画在顶部（绿），false 画在底部（琥珀）。
 * 少于 2 个点不渲染（单点画不出趋势，反而会让人误以为有数据）。
 */
function HealthSparkline({ checks }: { checks: HealthCheckPoint[] }) {
  if (checks.length < 2) return null
  const width = 120
  const height = 32
  const stepX = width / (checks.length - 1)
  const okY = 5
  const badY = height - 5
  const linePath =
    'M' + checks.map((c, i) => `${(i * stepX).toFixed(1)},${c.ok ? okY : badY}`).join(' L')
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle"
      role="img"
      aria-label={`最近 ${checks.length} 次巡检，${checks.filter((c) => c.ok).length} 次正常`}
    >
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-muted-foreground" />
      {checks.map((c, i) => (
        <circle key={i} cx={i * stepX} cy={c.ok ? okY : badY} r={2} fill={c.ok ? '#10b981' : '#f59e0b'} />
      ))}
    </svg>
  )
}

export function SiteDetailView({
  id,
  initialSite = null,
  initialRelated = [],
  category = null,
  canLinkCategory = false,
  categoryCount = 0,
  relatedScope = 'category',
  relatedLabel = null,
  relatedCategory = null,
  breadcrumb = null,
}: {
  id: string
  initialSite?: HubSite | null
  /** 同分类站点（服务端下发，SSR 输出 /site 内链） */
  initialRelated?: HubSite[]
  category?: { id: string; slug: string; title: string } | null
  /** 分类站点数达标才链分类页——薄分类路由是 404 */
  canLinkCategory?: boolean
  categoryCount?: number
  /** 相关站点的取数范围：相似标签 / 本分类 / 父分类子树 / 全站兜底 */
  relatedScope?: 'similar' | 'category' | 'parent' | 'more'
  /** 相关范围对应的分类名（全站兜底时为 null） */
  relatedLabel?: string | null
  /** 「浏览全部」入口：只有站点数达标的相关分类才有公开页 */
  relatedCategory?: { slug: string; title: string; count: number } | null
  /** 服务端渲染的可见面包屑 + BreadcrumbList JSON-LD */
  breadcrumb?: ReactNode
}) {
  const externalRel = externalLinkRelAttr(useSiteViewModel()?.externalLinkRel)
  const [site, setSite] = useState<HubSite | null>(initialSite)
  const [similar, setSimilar] = useState<HubSite[]>([])
  const [relations, setRelations] = useState<HubSiteRelation[]>([])
  const [collections, setCollections] = useState<Array<HubCollection & { collectionNote: string | null }>>([])
  /** 关系网络降级：中枢不可用时 relations 静默为空，需与「确实没有关系」区分 */
  const [relationsDegraded, setRelationsDegraded] = useState(false)
  /** 健康历史（详情页健康趋势 sparkline 用） */
  const [healthHistory, setHealthHistory] = useState<HealthCheckPoint[]>([])
  /** 死链时的替代推荐回退（relations 无 alternative 时启用） */
  const [alternativesFallback, setAlternativesFallback] = useState<HubSite[]>([])
  const [loading, setLoading] = useState(!initialSite)
  const [notFound, setNotFound] = useState(false)
  const { copyFeedback, reportCopy } = useCopyFeedback()
  const { copyFeedback: mdCopyFeedback, reportCopy: reportMdCopy } = useCopyFeedback()

  const handleCopyMarkdown = async () => {
    if (!site?.url || !site?.title) return
    const desc = site.description ? ` - ${site.description.trim()}` : ''
    const citation = `[${site.title.trim()}](${site.url.trim()})${desc}`
    const result = await copyText(citation)
    reportMdCopy(result)
  }
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

  const [relatedVideos, setRelatedVideos] = useState<any[]>([])
  const [loadingVideos, setLoadingVideos] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!site?.title) return
    const q = site.title.trim()
    fetch(`/api/videos?q=${encodeURIComponent(q)}&limit=3&compact=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data && Array.isArray(data.videos)) {
          setRelatedVideos(data.videos)
        }
        setLoadingVideos(false)
      })
      .catch(() => {
        if (!cancelled) setLoadingVideos(false)
      })
    return () => {
      cancelled = true
    }
  }, [site?.title])

  const [livePing, setLivePing] = useState<PingResult | null>(null)
  const [pinging, setPinging] = useState(false)

  const handleLivePing = async () => {
    if (!site?.url || pinging) return
    setPinging(true)
    try {
      const res = await probeSiteLatency(site.url)
      setLivePing(res)
    } finally {
      setPinging(false)
    }
  }

  const handleCopyUrl = async () => {
    if (!site?.url) return
    // 只有真的写入成功才显示「已复制」；失败要看得见（见 lib/clipboard.ts）
    const result = await copyText(site.url)
    reportCopy(result)
  }

  // 加载站点主数据（服务端已下发且未点重试时跳过，避免首屏重复请求）
  useEffect(() => {
    if (!id) return
    if (initialSite && reloadToken === 0) return
    let cancelled = false
    let failed = false
    setLoading(true)
    setNotFound(false)
    setNotice(null)
    void fetchSite(id, (error) => {
      failed = true
      if (!cancelled) setNotice(describeDegrade(error, '站点数据'))
    }).then((s) => {
      if (cancelled) return
      setSite(s)
      if (!s && !failed) setNotFound(true)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, reloadToken, initialSite])

  // 加载 KNN 相似站点
  useEffect(() => {
    if (!id || !site) return
    let cancelled = false
    void fetchSimilar(id, 6, (error) => {
      if (!cancelled) setNotice(describeDegrade(error, '相似推荐'))
    }).then((s) => {
      if (!cancelled) setSimilar(s)
    })
    return () => {
      cancelled = true
    }
  }, [id, site, reloadToken])

  // 加载强类型实体关系网络 (Alternative / Complementary / Upstream 等)
  useEffect(() => {
    if (!id || !site) return
    let cancelled = false
    let failed = false
    void fetchSiteRelations(id, () => {
      failed = true
    }).then((res) => {
      if (cancelled) return
      setRelationsDegraded(failed)
      if (res?.all) setRelations(res.all)
    })
    return () => {
      cancelled = true
    }
  }, [id, site, reloadToken])

  // 加载站点健康历史（详情页健康趋势 sparkline）
  useEffect(() => {
    if (!id || !site) return
    let cancelled = false
    void fetchSiteHealthHistory(id, 30).then((checks) => {
      if (!cancelled) setHealthHistory(checks)
    })
    return () => {
      cancelled = true
    }
  }, [id, site, reloadToken])

  // 死链时的替代推荐回退：站点非 active 时，用 /api/rank/alternatives 补替代
  // （relations 只覆盖人工/AI 标注过的站点，死链站点常常没有关系，此前是死链孤页）
  useEffect(() => {
    if (!id || !site) return
    if (site.status === 'active') {
      setAlternativesFallback([])
      return
    }
    let cancelled = false
    void fetchSiteAlternatives(id, 6).then((alts) => {
      if (!cancelled) setAlternativesFallback(alts)
    })
    return () => {
      cancelled = true
    }
  }, [id, site, reloadToken])

  // 加载收录该站点的精选专题
  useEffect(() => {
    if (!id || !site) return
    let cancelled = false
    void fetchSiteCollections(id).then((cols) => {
      if (!cancelled) setCollections(cols ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [id, site, reloadToken])

  if (loading) {
    return (
      <Container as="main" id="main-content">
        <div
          aria-busy="true"
          aria-live="polite"
          aria-label="正在加载站点详情"
          className="py-6 sm:py-10 max-w-4xl mx-auto space-y-6"
        >
          <span className="sr-only">加载站点详情中…</span>
          <div className="h-8 w-40 rounded-lg bg-muted/60 animate-pulse" />
          <div className="rounded-2xl border border-border/70 bg-card/50 p-6 sm:p-8 space-y-6 animate-pulse">
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <div className="h-16 w-16 rounded-2xl bg-muted shrink-0" />
              <div className="flex-1 space-y-3 w-full">
                <div className="h-7 w-1/2 rounded bg-muted" />
                <div className="h-4 w-full rounded bg-muted" />
                <div className="h-4 w-4/5 rounded bg-muted" />
                <div className="flex flex-wrap gap-2 pt-1">
                  <div className="h-6 w-20 rounded-full bg-muted" />
                  <div className="h-6 w-24 rounded-full bg-muted" />
                  <div className="h-6 w-16 rounded-full bg-muted" />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="h-9 w-28 rounded-xl bg-muted" />
              <div className="h-9 w-24 rounded-xl bg-muted" />
              <div className="h-9 w-20 rounded-xl bg-muted" />
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card/50 p-5 space-y-3 animate-pulse">
            <div className="h-5 w-32 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-5/6 rounded bg-muted" />
          </div>
        </div>
      </Container>
    )
  }

  if (!site && notice) {
    return (
      <Container as="main" id="main-content">
        <div className="py-20 text-center space-y-5 max-w-md mx-auto">
          <p className="text-muted-foreground text-sm">暂时无法加载该站点详情</p>
          <HubDegradedNotice notice={notice} onRetry={reload} incompleteHint={false} />
          <Button asChild variant="outline" size="sm" className="text-xs">
            <Link href="/">返回主站首页</Link>
          </Button>
        </div>
      </Container>
    )
  }

  if (notFound || !site) {
    return (
      <Container as="main" id="main-content">
        <div className="py-20 max-w-md mx-auto">
          <EmptyState
            icon={Globe}
            iconTone="muted"
            title="站点不存在或已被收录源清理"
            description="这条收录可能已从数据源下架；如果链接来自收藏夹，可以回到主页重新搜索同名站点。"
            action={
              <Button asChild variant="outline" size="sm" className="text-xs">
                <Link href="/">返回主站首页</Link>
              </Button>
            }
          />
        </div>
      </Container>
    )
  }

  const alternatives = relations.filter((r) => r.relationType === 'alternative')
  const ecosystemRelations = relations.filter((r) =>
    ['complementary', 'ecosystem', 'part_of'].includes(r.relationType),
  )
  const upstreamAndOthers = relations.filter((r) =>
    ['upstream', 'mirror', 'related'].includes(r.relationType),
  )

  const hasFacets = site.facets && Object.keys(site.facets).length > 0
  const healthBadge = siteHealthBadge(site.health)
  // 反爬状态（401/403/429）不等于站点下线：详情页只报 HTTP 码会被读成「打不开」，
  // 这一句把「我们被拒绝」和「站点不可用」分开（口径与 /search 的 broken 分区一致）。
  const botBlocked = isBotBlockStatus(site.health?.httpStatus)

  // 收录档案用的事实值：只在有真实时间戳时渲染，缺失就整行不出现，
  // 不用「未知 / --」占位（占位符会把缺失数据伪装成已核实）。
  const createdDay = formatArchiveDay(site.createdAt)
  const checkedDay = formatArchiveDay(site.health?.lastCheckedAt)
  const archivedForDays = daysSince(site.createdAt)
  /**
   * 条目来源：库里是 `seed` / `submit` / 其它自由值。
   * 只翻译有确定含义的两个，其余原样显示——不猜、不美化。
   */
  const sourceLabel =
    site.source === 'seed'
      ? '官方整理收录'
      : site.source === 'submit'
        ? '用户投稿'
        : (site.source ?? '').trim() || null

  const isDeadLink = site.status === 'broken' || (livePing && !livePing.reachable)
  const waybackUrl = `https://web.archive.org/web/*/${encodeURI(site.url)}`

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 max-w-4xl mx-auto space-y-8">
        {/* 面包屑：服务端渲染（可见 DOM 与 BreadcrumbList 同源） */}
        {breadcrumb}

        {/* 降级提示 */}
        {notice && <HubDegradedNotice notice={notice} onRetry={reload} />}

        {/* 核心站点展板（对齐市场轮展板语言：market-hero + 光斑 + 水印图标） */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-6 sm:p-8 shadow-xs space-y-6">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
          <div aria-hidden className="mt-0! pointer-events-none absolute -left-20 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
          <Globe
            aria-hidden
            strokeWidth={1}
            className="mt-0! pointer-events-none absolute right-6 top-16 hidden sm:block w-14 h-14 text-border/70"
          />
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-muted/60 border border-border/60 p-2 flex items-center justify-center overflow-hidden shadow-2xs">
              <SiteFavicon
                title={site.title}
                url={site.url}
                icon={site.iconKey ?? undefined}
                eager
                className="w-full h-full object-contain rounded-xl"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                  {site.title}
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                  {healthBadge && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-xs border ${
                        healthBadge.tone === 'ok'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                      }`}
                      title="服务端最新巡检结果"
                    >
                      <span className={`w-2 h-2 rounded-full ${healthBadge.tone === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                      <span>{healthBadge.label}</span>
                      {healthBadge.latencyMs != null && <span>({healthBadge.latencyMs}ms)</span>}
                    </span>
                  )}
                  {healthHistory.length >= 2 && (
                    <HealthSparkline checks={healthHistory} />
                  )}
                  <button
                    type="button"
                    onClick={handleLivePing}
                    disabled={pinging}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono border border-border/70 bg-background/60 hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                    title="点击由浏览器向该站点发起实时轻量握手，测试您当前网络直连延迟"
                  >
                    {pinging ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-primary" />
                        <span>测速中…</span>
                      </>
                    ) : livePing ? (
                      <>
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full',
                            livePing.quality === 'fast' && 'bg-emerald-500 animate-pulse',
                            livePing.quality === 'normal' && 'bg-sky-500',
                            livePing.quality === 'slow' && 'bg-amber-500',
                            livePing.quality === 'unreachable' && 'bg-rose-500',
                          )}
                        />
                        <span className={livePing.reachable ? 'text-foreground font-medium' : 'text-destructive font-medium'}>
                          本机实测: {livePing.label}
                        </span>
                        <RefreshCw className="w-2.5 h-2.5 ml-0.5 opacity-60 hover:opacity-100" />
                      </>
                    ) : (
                      <>
                        <Activity className="w-3 h-3 text-muted-foreground" />
                        <span>本机测速</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={safeHref(site.url)}
                  target="_blank"
                  rel={externalRel}
                  className="text-xs sm:text-sm text-primary hover:underline break-all font-mono"
                >
                  {site.url}
                </a>
                <button
                  onClick={handleCopyUrl}
                  aria-label={
                    copyFeedback.state === 'copied'
                      ? '已复制链接'
                      : copyFeedback.state === 'failed'
                        ? '复制失败，请手动选中链接复制'
                        : '复制链接'
                  }
                  title={
                    copyFeedback.state === 'copied'
                      ? '已复制'
                      : copyFeedback.state === 'failed'
                        ? `复制失败：${copyFeedback.reason}`
                        : '复制链接'
                  }
                  className={cn(
                    'text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors',
                    copyFeedback.state === 'failed' && 'text-destructive hover:text-destructive',
                  )}
                >
                  {copyFeedback.state === 'copied' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : copyFeedback.state === 'failed' ? (
                    <X className="w-3.5 h-3.5 text-destructive" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span role="status" className="sr-only">
                    {copyFeedback.reason ?? ''}
                  </span>
                </button>
              </div>

              {site.description && (
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  {site.description}
                </p>
              )}

              {/* 正交分面属性胶囊 (Phase 2) */}
              {hasFacets && (
                <div className="pt-2 flex flex-wrap items-center gap-2 border-t border-border/40 mt-3">
                  {Object.entries(site.facets!).map(([fKey, vals]) => {
                    const fMeta = FACET_LABELS[fKey] || { label: fKey, icon: Tag }
                    const FIcon = fMeta.icon
                    return vals.map((v) => (
                      <span
                        key={`${fKey}_${v}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-secondary/80 text-secondary-foreground border border-border/60 shadow-2xs"
                      >
                        <FIcon className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{fMeta.label}:</span>
                        <span className="font-semibold text-foreground">{v}</span>
                      </span>
                    ))
                  })}
                </div>
              )}

              {/* 话题标签 */}
              {site.tags && site.tags.length > 0 && (
                <div className="pt-1 flex flex-wrap items-center gap-1.5">
                  {site.tags.map((t) => {
                    const chipClass =
                      'text-xs px-2.5 py-0.5 rounded-full bg-muted/80 border border-border/50 transition-colors'
                    // 非 active 站点（broken/pending/archived）的标签不会被计入标签页的存活站点数，
                    // 因此 `/tags/<slug>` 会走 notFound() 变成真 404。详情页仍可访问这类站点，
                    // 这里把标签降级为纯文本，避免把用户送进 404（实测 CodePen / Grok 两例）。
                    if (site.status && site.status !== 'active') {
                      return (
                        <span key={t} className={cn(chipClass, 'cursor-default')}>
                          #{t}
                        </span>
                      )
                    }
                    return (
                      <Link
                        key={t}
                        href={'/tags/' + encodeURIComponent(tagSlug(t))}
                        className={cn(chipClass, 'hover:bg-primary/10 hover:text-primary')}
                      >
                        #{t}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 操作按钮栏 */}
          <div className="pt-4 border-t border-border/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Button asChild size="sm" className="h-9 text-xs px-4 gap-1.5 shadow-xs font-semibold">
                <a href={safeHref(site.url)} target="_blank" rel={externalRel}>
                  <span>立即直达官方主站</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyMarkdown}
                className="h-9 text-xs px-3 gap-1.5 font-medium shadow-2xs cursor-pointer"
                title="复制为 Markdown 引用格式：[标题](网址) - 简介"
                aria-label={mdCopyFeedback.state === 'copied' ? '已复制 Markdown 引用' : '复制 Markdown 引用'}
              >
                {mdCopyFeedback.state === 'copied' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span>{mdCopyFeedback.state === 'copied' ? '已复制引用' : '复制 Markdown'}</span>
              </Button>
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground/80 font-mono">
              {(site.visitCount ?? 0) > 0 && (
                <>
                  <Activity className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{site.visitCount} 次点击</span>
                </>
              )}
              {site.health?.lastCheckedAt && (
                <span>· 巡检时间: {new Date(site.health.lastCheckedAt).toLocaleDateString('zh-CN')}</span>
              )}
            </div>
          </div>
        </div>

        {/* 死链与失联自愈引导横幅 */}
        {isDeadLink && (
          <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>当前站点巡检或本机测速不可达，建议调取历史网页快照，或查阅下方的对标平替与生态方案。</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-8 text-xs border-amber-500/30 hover:bg-amber-500/20 font-medium"
              >
                <a href={waybackUrl} target="_blank" rel={externalRel}>
                  <span>查看历史快照</span>
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </Button>
              {alternatives.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('alternatives-section')
                    el?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className="h-8 text-xs font-medium cursor-pointer"
                >
                  <span>查看平替方案 ({alternatives.length})</span>
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 收录档案：详情页此前只有标题 + 一句话简介（生产集中位数 23 字），
            正文几乎全是链接列表。这里用库里**已有的事实字段**补出可读正文
            （域名 / 分类 / 标签 / 收录时间 / 巡检状态），既是用户判断"这站靠不靠谱"
            的依据，也是页面唯一的原创文本来源。
            严禁写「最好 / 必备 / 第一」这类无数据支撑的形容——红线与 V3 同源。 */}
        <section
          aria-labelledby="site-archive-heading"
          className="rounded-xl border border-border/70 bg-card/60 px-3.5 py-3 space-y-2.5"
        >
          <h2 id="site-archive-heading" className="text-sm font-bold text-foreground">
            收录档案
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex gap-2 min-w-0">
              <dt className="text-muted-foreground shrink-0">官网</dt>
              <dd className="font-mono truncate" title={site.url}>{safeHostname(site.url)}</dd>
            </div>
            <div className="flex gap-2 min-w-0">
              <dt className="text-muted-foreground shrink-0">所属分类</dt>
              <dd className="truncate">
                {category && canLinkCategory ? (
                  <Link href={`/category/${encodeURIComponent(category.slug)}`} className="hover:text-primary hover:underline">
                    {category.title}
                  </Link>
                ) : (
                  category?.title ?? '未分类'
                )}
              </dd>
            </div>
            {createdDay && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">收录时间</dt>
                <dd>
                  {createdDay}
                  {archivedForDays !== null ? ` · 已收录 ${archivedForDays} 天` : ''}
                </dd>
              </div>
            )}
            {sourceLabel && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">收录来源</dt>
                <dd>{sourceLabel}</dd>
              </div>
            )}
            {site.titleEn && (
              <div className="flex gap-2 min-w-0">
                <dt className="text-muted-foreground shrink-0">英文名</dt>
                <dd className="truncate">{site.titleEn}</dd>
              </div>
            )}
            {checkedDay && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">最近巡检</dt>
                <dd>
                  {checkedDay}
                  {site.health?.httpStatus ? ` · HTTP ${site.health.httpStatus}` : ''}
                </dd>
              </div>
            )}
          </dl>
          {botBlocked ? (
            <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
              最近一次巡检返回 HTTP {site.health?.httpStatus}：这通常表示对方站点拒绝了自动访问（反爬、登录墙或按 IP 限流），
              不代表站点无法打开。点「立即直达」通常仍可正常访问，巡检恢复后本条会自动更新。
            </p>
          ) : null}
          {/*
            这一段**刻意不复述标题、简介与标签**——它们在首屏卡片与标签区已经出现，
            重复一遍只是把字数刷上去，对读者和搜索引擎都没有增量。
            这里只写页面上别处没有的事实：站内位置、收录时长、巡检状态、条目来源。
          */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {site.title} 位于「{category?.title ?? '未分类'}」分类
            {categoryCount > 1 ? `，该分类下另有 ${categoryCount - 1} 个同类条目可横向对比` : ''}
            {archivedForDays !== null ? `；本条自 ${createdDay} 收录，已维护 ${archivedForDays} 天` : ''}
            {checkedDay
              ? `。最近一次可达性巡检于 ${checkedDay} 完成${site.health?.httpStatus ? `，返回 HTTP ${site.health.httpStatus}` : ''}`
              : ''}
            {sourceLabel ? `；条目来源为${sourceLabel}` : ''}。
          </p>
        </section>

        {/* 关系网络降级提示：此前中枢不可用时 relations 静默为空，
            与「该站点确实没有平替/生态关系」无法区分 */}
        {relationsDegraded && relations.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
            关系网络暂时不可用（服务未响应），已跳过平替与生态推荐。
          </div>
        )}

        {/* 强类型平替与竞品雷达 (Alternative Relations - Phase 3) */}
        {alternatives.length > 0 && (
          <div id="alternatives-section" className="space-y-3.5 scroll-m-16">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                <GitFork className="w-4 h-4 text-amber-500" />
                <span>开源与对标平替 (Alternatives)</span>
              </h2>
              <span className="text-xs text-muted-foreground font-mono">{alternatives.length} 个平替方案</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {alternatives.map((alt) => (
                <div
                  key={alt.id}
                  className="rounded-xl border border-border/70 bg-card p-4 hover:border-amber-500/40 transition-all shadow-2xs space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {alt.targetSiteId ? (
                          <Link
                            href={`/site/${alt.targetSiteId}`}
                            className="font-semibold text-sm hover:text-primary hover:underline truncate"
                          >
                            {alt.targetTitle}
                          </Link>
                        ) : (
                          <span className="font-semibold text-sm text-foreground truncate">
                            {alt.targetTitle}
                          </span>
                        )}
                        {alt.isFreeOrOpenSource && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <ShieldCheck className="w-2.5 h-2.5" />
                            开源/免费
                          </span>
                        )}
                      </div>
                      <a
                        href={safeHref(alt.targetUrl)}
                        target="_blank"
                        rel={externalRel}
                        className="text-xs text-muted-foreground hover:text-primary font-mono truncate block mt-0.5"
                      >
                        {alt.targetUrl}
                      </a>
                    </div>

                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                      <a href={safeHref(alt.targetUrl)} target="_blank" rel={externalRel}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </Button>
                  </div>

                  {alt.note && (
                    <p className="text-xs text-muted-foreground/90 bg-muted/30 p-2 rounded-lg border border-border/40">
                      💡 {alt.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 死链替代回退：站点非 active 且 relations 没有平替时，用 /api/rank/alternatives 补替代。
            此前死链站点若没有关系标注，详情页就是一个死链孤页——用户点出去打不开，也没有替代可走。 */}
        {alternatives.length === 0 && alternativesFallback.length > 0 && site.status !== 'active' && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                <GitFork className="w-4 h-4 text-amber-500" />
                <span>可用的替代站点</span>
              </h2>
              <span className="text-xs text-muted-foreground font-mono">{alternativesFallback.length} 个</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {alternativesFallback.map((alt) => (
                <div
                  key={alt.id}
                  className="rounded-xl border border-border/70 bg-card p-4 hover:border-amber-500/40 transition-all shadow-2xs space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/site/${alt.id}`} className="font-semibold text-sm hover:text-primary hover:underline truncate block">
                        {alt.title}
                      </Link>
                      <a
                        href={safeHref(alt.url)}
                        target="_blank"
                        rel={externalRel}
                        className="text-xs text-muted-foreground hover:text-primary font-mono truncate block mt-0.5"
                      >
                        {alt.url}
                      </a>
                    </div>
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                      <a href={safeHref(alt.url)} target="_blank" rel={externalRel}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 生态搭配与技术套件 (Ecosystem & Complementary - Phase 3) */}
        {ecosystemRelations.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                <Boxes className="w-4 h-4 text-indigo-500" />
                <span>推荐搭配与技术生态 (Ecosystem & Complementary)</span>
              </h2>
              <span className="text-xs text-muted-foreground font-mono">{ecosystemRelations.length} 个关联组件</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
              {ecosystemRelations.map((eco) => {
                const badge = RELATION_TYPE_LABEL[eco.relationType] || { label: eco.relationType, color: 'text-muted-foreground', bg: 'bg-muted' }
                return (
                  <div
                    key={eco.id}
                    className="rounded-xl border border-border/70 bg-card p-3.5 hover:border-indigo-500/40 transition-all shadow-2xs space-y-2 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.bg} ${badge.color}`}>
                          {badge.label}
                        </span>
                        <a href={safeHref(eco.targetUrl)} target="_blank" rel={externalRel} className="text-muted-foreground hover:text-primary">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="font-semibold text-xs sm:text-sm truncate">
                        {eco.targetSiteId ? (
                          <Link href={`/site/${eco.targetSiteId}`} className="hover:text-primary hover:underline">
                            {eco.targetTitle}
                          </Link>
                        ) : (
                          eco.targetTitle
                        )}
                      </div>
                      {eco.note && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {eco.note}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 精选专题反向链接 (Collections Ingestion) */}
        {collections.length > 0 && (
          <section aria-labelledby="site-collections-heading" className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2
                id="site-collections-heading"
                className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground"
              >
                <Layers className="w-4 h-4 text-violet-500" />
                <span>收录于精选专题</span>
              </h2>
              <Link href="/collections" className="text-xs text-muted-foreground hover:text-primary">
                浏览全部专题 →
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {collections.map((col) => (
                <Link
                  key={col.id}
                  href={`/collections/${encodeURIComponent(col.slug)}`}
                  className="rounded-xl border border-border/70 bg-card p-3.5 hover:border-violet-500/40 transition-all shadow-2xs space-y-2 flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-xs font-semibold text-violet-600 dark:text-violet-400 group-hover:text-primary transition-colors flex items-center gap-1.5 truncate">
                        <Layers className="w-3.5 h-3.5 shrink-0" />
                        {col.title}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold border bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 shrink-0">
                        {col.kind === 'roadmap' ? '路线图' : col.kind === 'geo' ? '地域' : '专题'}
                      </span>
                    </div>
                    {col.collectionNote ? (
                      <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded p-1.5 line-clamp-2 leading-relaxed">
                        💡 策展说明：{col.collectionNote}
                      </p>
                    ) : col.description ? (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {col.description}
                      </p>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 相关站点：服务端下发的站内 /site 内链（爬虫可见），
            与客户端 KNN 外链推荐分开——前者补内链图，后者做发现。
            分类只有自己 1 条时退回父分类子树或全站清单，避免整块消失后
            详情页一条可爬的 /site 内链都不剩。 */}
        {(initialRelated.length > 0 || (category && canLinkCategory)) && (
          <section aria-labelledby="related-sites-heading" className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2
                id="related-sites-heading"
                className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground"
              >
                <LayoutGrid className="w-4 h-4 text-sky-500" />
                <span>{relatedScope === 'similar' ? '相似站点推荐' : relatedScope === 'parent' ? '同类目站点' : relatedScope === 'more' ? '更多站点' : '同分类站点'}</span>
              </h2>
              {relatedLabel && (
                <span className="text-xs text-muted-foreground font-mono truncate">{relatedLabel}</span>
              )}
            </div>
            {initialRelated.length > 0 && (
              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                {initialRelated.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-xl border border-border/70 bg-card p-3.5 hover:border-sky-500/40 transition-all shadow-2xs"
                  >
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/site/${encodeURIComponent(s.id)}`}
                        className="flex min-w-0 flex-1 items-center gap-3 group"
                      >
                        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-muted/60 border border-border/50 p-1 flex items-center justify-center overflow-hidden">
                          <SiteFavicon
                            title={s.title}
                            url={s.url}
                            icon={s.iconKey ?? undefined}
                            className="w-full h-full object-contain rounded"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs sm:text-sm font-semibold truncate group-hover:text-primary transition-colors">
                            {s.title}
                          </div>
                          {s.description && (
                            <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {s.description}
                            </div>
                          )}
                        </div>
                      </Link>
                      <a
                        href={safeHref(s.url)}
                        target="_blank"
                        rel={externalRel}
                        aria-label={`访问 ${s.title} 官网`}
                        className="text-muted-foreground hover:text-primary p-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {relatedCategory && (
              <Link
                href={`/category/${encodeURIComponent(relatedCategory.slug)}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                浏览全部 {relatedCategory.count} 个「{relatedCategory.title}」站点
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </section>
        )}

        {/* 关联技术视频频道一键联动 */}
        <section aria-label="相关精选技术视频" className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <MonitorPlay className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                想深入学习「{site.title}」？
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                在精选技术视频库中检索相关实战视频与核心原理解析课程
              </div>
            </div>
          </div>
          <Link
            href={`/videos?q=${encodeURIComponent(site.title)}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs shrink-0 transition-all shadow-2xs self-start sm:self-auto"
          >
            <span>搜索相关教程</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </section>

        {/* 向量图谱相似推荐 (KNN) */}
        {similar.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="w-4 h-4 text-primary" />
                <span>向量图谱相似站点推荐 (KNN)</span>
              </h2>
              <span className="text-xs text-muted-foreground font-mono">{similar.length} 个推荐项</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
              {similar.map((s) => (
                <div
                  key={s.id}
                  className="group relative rounded-xl border border-border/70 glass-surface subtle-mesh p-3.5 transition-all hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5 flex flex-col justify-between"
                >
                  <a href={safeHref(s.url)} target="_blank" rel={externalRel} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-muted/60 border border-border/50 p-1 flex items-center justify-center overflow-hidden">
                      <SiteFavicon
                        title={s.title}
                        url={s.url}
                        icon={s.iconKey ?? undefined}
                        className="w-full h-full object-contain rounded"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-sm font-semibold truncate group-hover:text-primary transition-colors">
                        {s.title}
                      </div>
                      {s.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {s.description}
                        </div>
                      )}
                    </div>
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 跨生态精选视频推荐：连接工具与实战教程 */}
        {relatedVideos.length > 0 ? (
          <section aria-labelledby="site-videos-heading" className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2
                id="site-videos-heading"
                className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground"
              >
                <MonitorPlay className="w-4 h-4 text-violet-500" />
                <span>「{site.title}」相关实战视频与精品教程</span>
              </h2>
              <Link
                href={`/videos?q=${encodeURIComponent(site.title)}`}
                className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
              >
                <span>在视频中心查看更多</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
              {relatedVideos.map((video) => (
                <a
                  key={video.id}
                  href={safeHref(video.href) || `/videos?q=${encodeURIComponent(site.title)}`}
                  target="_blank"
                  rel={externalRel}
                  className="group rounded-xl border border-border/70 bg-card overflow-hidden hover:border-violet-500/40 hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="relative aspect-video w-full bg-muted overflow-hidden">
                    {video.icon ? (
                      <img
                        src={video.icon}
                        alt={video.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-violet-500/5 text-violet-500/40">
                        <MonitorPlay className="w-10 h-10" />
                      </div>
                    )}
                    {video.videoConfig?.durationSec && (
                      <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-black/75 text-white backdrop-blur-xs">
                        {Math.floor(video.videoConfig.durationSec / 60)}:{String(video.videoConfig.durationSec % 60).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                  <div className="p-3 space-y-1.5 flex-1 flex flex-col justify-between">
                    <h3 className="text-xs font-semibold text-foreground line-clamp-2 group-hover:text-primary transition-colors leading-snug">
                      {video.title}
                    </h3>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40 mt-1">
                      <span className="truncate max-w-[120px]">
                        {video.videoConfig?.author || '技术精选'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-primary font-medium group-hover:underline">
                        <span>观看教程</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-xs text-foreground">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <MonitorPlay className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <span className="font-semibold text-foreground block text-sm">想看「{site.title}」的视频教程与实操演练？</span>
                <span className="text-muted-foreground text-xs block truncate">
                  本站技术视频库收录 6,000+ 部开发者视频、实操讲解与系统课程
                </span>
              </div>
            </div>
            <Link
              href={`/videos?q=${encodeURIComponent(site.title)}`}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shrink-0 text-xs shadow-2xs"
            >
              <span>在视频中心检索相关资源</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>
      <Footer />
    </Container>
  )
}
