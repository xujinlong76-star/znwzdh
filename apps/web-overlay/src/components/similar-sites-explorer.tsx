'use client'

/**
 * SimilarSites 级多信号相似站点发现与竞品洞察交互组件（旗舰增强版）。
 *
 * 复用场景：
 *   1. `mode="embedded"`：挂载于 `/site/[id]` 站点详情页，自动拉取当前站点的 5 维相似度报告；
 *   2. `mode="hub"`：挂载于 `/similar` 独立发现工作台，展示任意输入网址/域名/关键词的完整洞察结果。
 *
 * 核心能力（对标并超越 SimilarSites.com + AlternativeTo）：
 *   - 环形相似度百分比仪表 + 可展开 5 维信号拆解 + 差异特色标签（uniqueTags）
 *   - 真实站内全库排名 (#Global) + 细分领域排名 (#Category) + 实时健康延迟（零虚构流量）
 *   - 交互式「相似生态领域分布条」（点击任意色段即刻筛选对应分类）
 *   - 多维筛选（同细分领域 / 跨类目 / 排除同品牌子站 / 开源免费 / 健康直连 / 按分类 / 按共同标签 / 结果内关键词秒搜）
 *   - 零门槛「即时横评对比表」（任意 2–4 个站免登录直接并排对比 5 维得分、排名、延迟、共性与差异标签，支持导出 Markdown 对比表）
 *   - 一键复制分析链接 & 导出 Markdown 竞品榜单 + 无限链式探索（找它的相似站）
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Filter,
  GitFork,
  Globe,
  LayoutGrid,
  List,
  Radar,
  Scale,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Tag,
  Trophy,
  X,
  Zap,
} from 'lucide-react'
import {
  fetchSiteSimilarInsights,
  type HubSimilarScopeFilter,
  type HubSimilarSiteMatch,
  type HubSimilarSitesReport,
  type HubSimilarSortBy,
} from '@/lib/navhub-api'
import { SiteFavicon } from '@/components/site-favicon'
import { FavoriteButton } from '@/components/favorite-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyText } from '@/lib/clipboard'
import { useToast } from '@/components/ui/use-toast'
import { safeHref } from '@/lib/safe-url'
import { tagSlug } from '@/lib/seo/tag-slug'
import { cn } from '@/lib/utils'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function similarityTone(percent: number): {
  badge: string
  bar: string
  stroke: string
  label: string
} {
  if (percent >= 80) {
    return {
      badge: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      bar: 'bg-emerald-500',
      stroke: 'stroke-emerald-500',
      label: '极高相似',
    }
  }
  if (percent >= 60) {
    return {
      badge: 'border-primary/35 bg-primary/10 text-primary',
      bar: 'bg-primary',
      stroke: 'stroke-primary',
      label: '高度相关',
    }
  }
  if (percent >= 40) {
    return {
      badge: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
      bar: 'bg-sky-500',
      stroke: 'stroke-sky-500',
      label: '相关延伸',
    }
  }
  return {
    badge: 'border-border bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground',
    stroke: 'stroke-muted-foreground',
    label: '参考拓展',
  }
}

/** 迷你环形 SVG 相似度仪表（36×36，零依赖、亮暗双主题自适应） */
function SimilarityRing({ percent, strokeClass }: { percent: number; strokeClass: string }) {
  const r = 14
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = c - (clamped / 100) * c
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
      <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-muted" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={cn('transition-all duration-300', strokeClass)}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-extrabold text-foreground">
        {clamped}
      </span>
    </div>
  )
}

const SORT_OPTIONS: Array<{ id: HubSimilarSortBy; label: string }> = [
  { id: 'similarity', label: '综合相似度' },
  { id: 'popularity', label: '站内热度' },
  { id: 'tags', label: '重合标签最多' },
  { id: 'latency', label: '响应最快' },
]

const BREAKDOWN_DIMS: Array<{
  key: keyof HubSimilarSiteMatch['breakdown']
  label: string
  color: string
}> = [
  { key: 'tags', label: '标签重合', color: 'bg-primary' },
  { key: 'semantic', label: '内容语义', color: 'bg-sky-500' },
  { key: 'category', label: '分类亲缘', color: 'bg-violet-500' },
  { key: 'facets', label: '属性定位', color: 'bg-amber-500' },
  { key: 'graph', label: '图谱/受众', color: 'bg-emerald-500' },
]

const DIST_COLORS = [
  'bg-primary',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
]

export interface SimilarSitesExplorerProps {
  mode: 'embedded' | 'hub'
  /** `embedded` 模式下必传，用于自动请求 `/api/similar?mode=insights` */
  siteId?: string
  siteTitle?: string
  siteUrl?: string
  /** `hub` 模式下由父组件传入实时查询报告 */
  report?: HubSimilarSitesReport | null
  loading?: boolean
  /** `hub` 模式下点击「找它的相似站」时原地切换目标 */
  onExploreSite?: (query: string) => void
  className?: string
}

export function SimilarSitesExplorer({
  mode,
  siteId,
  siteTitle,
  siteUrl,
  report: externalReport,
  loading: externalLoading = false,
  onExploreSite,
  className,
}: SimilarSitesExplorerProps) {
  const externalRel = externalLinkRelAttr(useSiteViewModel()?.externalLinkRel)
  const { toast } = useToast()

  const [fetchedReport, setFetchedReport] = useState<HubSimilarSitesReport | null>(null)
  const [internalLoading, setInternalLoading] = useState(mode === 'embedded')

  const [scope, setScope] = useState<HubSimilarScopeFilter>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('')
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [openSourceOnly, setOpenSourceOnly] = useState(false)
  const [healthyOnly, setHealthyOnly] = useState(false)
  const [excludeSameBrand, setExcludeSameBrand] = useState(false)
  const [keywordFilter, setKeywordFilter] = useState('')
  const [sortBy, setSortBy] = useState<HubSimilarSortBy>('similarity')
  const [layout, setLayout] = useState<'ranked' | 'grid'>('ranked')
  const [visibleCount, setVisibleCount] = useState(mode === 'embedded' ? 8 : 16)
  const [expandedBreakdownIds, setExpandedBreakdownIds] = useState<Record<string, boolean>>({})

  // 即时横评对比（免登录、免收藏，最多勾选 3 个候选站与目标站组成 4 列对比）
  const [vsIds, setVsIds] = useState<string[]>([])
  const [vsOpen, setVsOpen] = useState(false)
  const [copiedAction, setCopiedAction] = useState<'link' | 'markdown' | 'vs' | null>(null)

  useEffect(() => {
    if (mode !== 'embedded' || !siteId) return
    let cancelled = false
    setInternalLoading(true)
    setScope('all')
    setSelectedCategoryId('')
    setSelectedTag('')
    setOpenSourceOnly(false)
    setHealthyOnly(false)
    setExcludeSameBrand(false)
    setKeywordFilter('')
    setSortBy('similarity')
    setVisibleCount(8)
    setExpandedBreakdownIds({})
    setVsIds([])
    setVsOpen(false)

    void fetchSiteSimilarInsights(siteId, { limit: 48 }).then((data) => {
      if (cancelled) return
      setFetchedReport(data)
      setInternalLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [mode, siteId])

  useEffect(() => {
    if (mode !== 'hub') return
    setScope('all')
    setSelectedCategoryId('')
    setSelectedTag('')
    setOpenSourceOnly(false)
    setHealthyOnly(false)
    setExcludeSameBrand(false)
    setKeywordFilter('')
    setSortBy('similarity')
    setVisibleCount(16)
    setExpandedBreakdownIds({})
    setVsIds([])
    setVsOpen(false)
  }, [mode, externalReport?.query, externalReport?.target?.site.id])

  const report = mode === 'hub' ? externalReport ?? null : fetchedReport
  const isLoading = mode === 'hub' ? externalLoading : internalLoading

  const filteredItems = useMemo(() => {
    if (!report) return []
    const tagLower = selectedTag.toLowerCase()
    const kwLower = keywordFilter.trim().toLowerCase()
    const list = report.items.filter((item) => {
      if (scope === 'same-category' && !item.sameCategory) return false
      if (scope === 'cross-category' && item.sameCategory) return false
      if (selectedCategoryId && item.site.categoryId !== selectedCategoryId) return false
      if (openSourceOnly && !item.isOpenSource) return false
      if (healthyOnly && !item.isHealthy) return false
      if (excludeSameBrand && item.isSameBrand) return false
      if (tagLower && !(item.sharedTags ?? []).some((t) => typeof t === 'string' && t.toLowerCase() === tagLower)) return false
      if (kwLower) {
        const hay = [
          item.site.title,
          item.site.titleEn ?? '',
          item.site.url,
          item.site.description ?? '',
          item.categoryName ?? '',
          ...(item.site.tags ?? []),
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(kwLower)) return false
      }
      return true
    })
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'popularity':
          return a.siteRank - b.siteRank || b.similarityPercent - a.similarityPercent
        case 'tags':
          return (b.sharedTags ?? []).length - (a.sharedTags ?? []).length || b.similarityPercent - a.similarityPercent
        case 'latency': {
          const la = a.site.health?.ok && typeof a.site.health.latencyMs === 'number' ? a.site.health.latencyMs : 999_999
          const lb = b.site.health?.ok && typeof b.site.health.latencyMs === 'number' ? b.site.health.latencyMs : 999_999
          return la - lb || b.similarityPercent - a.similarityPercent
        }
        case 'similarity':
        default:
          return b.similarityPercent - a.similarityPercent || a.siteRank - b.siteRank
      }
    })
  }, [
    report,
    scope,
    selectedCategoryId,
    selectedTag,
    openSourceOnly,
    healthyOnly,
    excludeSameBrand,
    keywordFilter,
    sortBy,
  ])

  const vsItems = useMemo(() => {
    if (!report || vsIds.length === 0) return []
    const byId = new Map(report.items.map((i) => [i.site.id, i]))
    return vsIds.map((id) => byId.get(id)).filter((x): x is HubSimilarSiteMatch => Boolean(x))
  }, [report, vsIds])

  // 生态分类分布分段（Top 5 分类 + 其余汇总）
  const categoryDistribution = useMemo(() => {
    if (!report || report.summary.categories.length <= 1 || report.summary.totalFound <= 0) return []
    const total = report.summary.totalFound
    const top = report.summary.categories.slice(0, 5)
    const covered = top.reduce((sum, c) => sum + c.count, 0)
    const segments = top.map((c, idx) => ({
      id: c.id,
      name: c.name,
      count: c.count,
      pct: Math.max(4, Math.round((c.count / total) * 100)),
      color: DIST_COLORS[idx % DIST_COLORS.length]!,
    }))
    if (total - covered > 0) {
      segments.push({
        id: '__other__',
        name: '其他领域',
        count: total - covered,
        pct: Math.max(4, Math.round(((total - covered) / total) * 100)),
        color: 'bg-muted-foreground',
      })
    }
    return segments
  }, [report])

  const visibleItems = filteredItems.slice(0, visibleCount)
  const hasActiveFilters =
    scope !== 'all' ||
    Boolean(selectedCategoryId) ||
    Boolean(selectedTag) ||
    openSourceOnly ||
    healthyOnly ||
    excludeSameBrand ||
    Boolean(keywordFilter.trim())

  const resetFilters = () => {
    setScope('all')
    setSelectedCategoryId('')
    setSelectedTag('')
    setOpenSourceOnly(false)
    setHealthyOnly(false)
    setExcludeSameBrand(false)
    setKeywordFilter('')
    setSortBy('similarity')
  }

  const toggleBreakdown = (id: string) => {
    setExpandedBreakdownIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleVsPick = (candId: string) => {
    setVsIds((prev) => {
      if (prev.includes(candId)) return prev.filter((x) => x !== candId)
      const maxPicks = report?.target ? 3 : 4
      if (prev.length >= maxPicks) {
        toast({
          title: '最多同时横评 4 个站点',
          description: '请先取消一个已选站点，再添加新的对比项。',
        })
        return prev
      }
      return [...prev, candId]
    })
  }

  const flashCopied = (kind: 'link' | 'markdown' | 'vs') => {
    setCopiedAction(kind)
    setTimeout(() => setCopiedAction((cur) => (cur === kind ? null : cur)), 2000)
  }

  if (isLoading) {
    return (
      <section
        aria-label="相似站点智能雷达加载中"
        aria-busy="true"
        className={cn('rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5 space-y-4 animate-pulse', className)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="h-5 w-48 rounded bg-muted" />
          <div className="h-7 w-32 rounded-lg bg-muted" />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="h-7 w-24 rounded-full bg-muted" />
          <div className="h-7 w-24 rounded-full bg-muted" />
          <div className="h-7 w-28 rounded-full bg-muted" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-24 rounded-xl bg-muted/70" />
          ))}
        </div>
      </section>
    )
  }

  if (!report || report.items.length === 0) {
    if (mode === 'embedded') return null
    return (
      <section className={cn('rounded-2xl border border-border/70 bg-card/60 p-8 text-center space-y-3', className)}>
        <Radar className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-bold text-foreground">暂未找到高相关度的相似站点</h2>
        <p className="mx-auto max-w-md text-xs sm:text-sm text-muted-foreground">
          试试输入更通用的域名、品牌名（如 douban.com、github.com、figma.com）或中文主题关键词（如「影视评分」「免费图床」「AI 编程」）。
        </p>
      </section>
    )
  }

  const target = report.target
  const displayTargetName = target?.site.title ?? siteTitle ?? report.query
  const displayTargetHost = target ? safeHostname(target.site.url) : siteUrl ? safeHostname(siteUrl) : report.query
  const sameBrandCount = report.summary.sameBrandCount ?? 0

  const handleCopyShareLink = async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}/similar?q=${encodeURIComponent(displayTargetHost || report.query)}`
    const res = await copyText(url)
    if (res.ok) {
      flashCopied('link')
      toast({ title: '已复制分析链接', description: '可直接分享给团队查看这份相似站雷达报告。' })
    } else {
      toast({ title: '复制失败', description: res.reason ?? '请手动复制浏览器地址栏链接。' })
    }
  }

  const handleExportMarkdown = async () => {
    const topRows = filteredItems.slice(0, 15)
    const lines = [
      `## 与「${displayTargetName}」最相似的站点与平替（Top ${topRows.length}）`,
      '',
      '| 排名 | 站点 | 相似度 | 分类 | 站内热度 | 匹配依据 |',
      '| :---: | :--- | :---: | :--- | :---: | :--- |',
      ...topRows.map((item, idx) => {
        const reason = (item.reasons ?? [])[0] ?? ((item.sharedTags ?? []).length ? `共享标签 ${(item.sharedTags ?? []).slice(0, 2).join('/')}` : '综合语义相关')
        return `| #${idx + 1} | [${item.site.title.replace(/\|/g, '/')}](${item.site.url}) | **${item.similarityPercent}%** | ${item.categoryName ?? '-'} | #${item.siteRank} | ${reason.replace(/\|/g, '/')} |`
      }),
    ]
    const res = await copyText(lines.join('\n'))
    if (res.ok) {
      flashCopied('markdown')
      toast({
        title: `已复制 Markdown 竞品榜单（${topRows.length} 条）`,
        description: '可直接粘贴至 Notion、飞书文档、Obsidian 或技术评审 PRD。',
      })
    } else {
      toast({ title: '导出失败', description: res.reason ?? '剪贴板不可用。' })
    }
  }

  const handleCopyVsMarkdown = async () => {
    const cols: Array<{ title: string; url: string; sim: string; rank: string; cat: string; os: string; tags: string }> = []
    if (target) {
      cols.push({
        title: `${target.site.title}（基准）`,
        url: target.site.url,
        sim: '基准站',
        rank: `#${target.siteRank}`,
        cat: target.categoryName ?? '-',
        os: target.isOpenSource ? '开源' : '闭源/商业',
        tags: (target.site.tags ?? []).slice(0, 4).join('、') || '-',
      })
    }
    for (const item of vsItems) {
      cols.push({
        title: item.site.title,
        url: item.site.url,
        sim: `${item.similarityPercent}%`,
        rank: `#${item.siteRank}`,
        cat: item.categoryName ?? '-',
        os: item.isOpenSource ? '开源' : '闭源/商业',
        tags: [...(item.sharedTags ?? []).slice(0, 2), ...(item.uniqueTags ?? []).slice(0, 2)].join('、') || '-',
      })
    }
    const md = [
      `### 横评对比：${cols.map((c) => c.title).join(' vs ')}`,
      '',
      `| 维度 | ${cols.map((c) => `[${c.title}](${c.url})`).join(' | ')} |`,
      `| :--- | ${cols.map(() => ':---').join(' | ')} |`,
      `| 综合相似度 | ${cols.map((c) => c.sim).join(' | ')} |`,
      `| 全库热度排名 | ${cols.map((c) => c.rank).join(' | ')} |`,
      `| 所属分类 | ${cols.map((c) => c.cat).join(' | ')} |`,
      `| 开源属性 | ${cols.map((c) => c.os).join(' | ')} |`,
      `| 核心标签 | ${cols.map((c) => c.tags).join(' | ')} |`,
    ].join('\n')
    const res = await copyText(md)
    if (res.ok) {
      flashCopied('vs')
      toast({ title: '已复制横评对比表格（Markdown）' })
    }
  }

  return (
    <section
      aria-labelledby="similar-sites-radar-heading"
      data-testid="similar-sites-explorer"
      className={cn('rounded-2xl border border-border/70 bg-card/75 p-4 sm:p-6 shadow-2xs space-y-5', className)}
    >
      {/* 头部：标题 + 导出/分享/全景入口/视图切换 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Radar className="h-4 w-4" aria-hidden />
            </span>
            <h2
              id="similar-sites-radar-heading"
              className="text-base sm:text-lg font-extrabold tracking-tight text-foreground"
            >
              {report.matchType === 'topic-discovery'
                ? `与「${report.query}」最相似的推荐站点`
                : `与「${displayTargetName}」最相似的站点与平替`}
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              <Sparkles className="h-3 w-3" aria-hidden />
              <span>{report.summary.signalMode === 'hybrid-vector' ? '向量+5维融合' : '5维多信号融合'}</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {target ? (
              <>
                基于 <span className="font-mono text-foreground">{displayTargetHost}</span> 的标签特异性、语义内容、分类亲缘、产品定位与图谱受众共现，共挖掘{' '}
                <span className="font-semibold text-foreground">{report.summary.totalFound}</span> 个高相关站点
              </>
            ) : (
              <>
                未在馆藏中直接命中该外站域名，已自动基于域名主题与语义特征从全库匹配{' '}
                <span className="font-semibold text-foreground">{report.summary.totalFound}</span> 个高相似替代站点
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportMarkdown}
            className="h-8 px-2.5 text-xs gap-1 cursor-pointer"
            title="将当前筛选结果导出为 Markdown 竞品表格并复制到剪贴板"
          >
            {copiedAction === 'markdown' ? (
              <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
            ) : (
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span>{copiedAction === 'markdown' ? '已复制 MD' : '导出榜单'}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyShareLink}
            className="h-8 px-2.5 text-xs gap-1 cursor-pointer"
            title="复制当前相似站点分析页面的直达分享链接"
          >
            {copiedAction === 'link' ? (
              <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
            ) : (
              <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="hidden sm:inline">{copiedAction === 'link' ? '已复制链接' : '分享'}</span>
          </Button>

          {mode === 'embedded' && (
            <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1">
              <Link href={`/similar?q=${encodeURIComponent(displayTargetHost)}`}>
                <Compass className="h-3.5 w-3.5 text-primary" />
                <span>全景发现</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          )}

          <div
            role="group"
            aria-label="切换结果展示视图"
            className="inline-flex items-center rounded-lg border border-border-strong bg-muted/40 p-0.5"
          >
            <button
              type="button"
              onClick={() => setLayout('ranked')}
              aria-pressed={layout === 'ranked'}
              title="榜单详情视图（显示环形相似度仪表与 5 维拆解）"
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer',
                layout === 'ranked'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">榜单</span>
            </button>
            <button
              type="button"
              onClick={() => setLayout('grid')}
              aria-pressed={layout === 'grid'}
              title="紧凑双列网格视图"
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer',
                layout === 'grid'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">网格</span>
            </button>
          </div>
        </div>
      </div>

      {/* 目标站点站内指标条 */}
      {target && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Trophy className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 shrink-0" aria-hidden />
              <span>全库热度排名</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1 font-mono">
              <span className="text-base font-extrabold text-foreground">#{target.siteRank}</span>
              <span className="text-[11px] text-muted-foreground">/ {target.totalActiveSites}</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <LayoutGrid className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
              <span className="truncate">{target.categoryName ?? '同分类'}排名</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1 font-mono">
              <span className="text-base font-extrabold text-foreground">#{target.categoryRank}</span>
              <span className="text-[11px] text-muted-foreground">/ {target.categoryTotal}</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <GitFork className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden />
              <span>同领域 / 跨类目</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className="text-base font-extrabold text-foreground">{report.summary.sameCategoryCount}</span>
              <span className="text-[11px] text-muted-foreground">同域 · {report.summary.crossCategoryCount} 跨类</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden />
              <span>开源 / 健康直连</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono">
              <span className="text-base font-extrabold text-foreground">{report.summary.openSourceCount}</span>
              <span className="text-[11px] text-muted-foreground">开源 · {report.summary.healthyCount} 健康</span>
            </div>
          </div>
        </div>
      )}

      {/* 相似生态领域分布条（交互式色段，点任意领域即刻过滤） */}
      {categoryDistribution.length > 0 && (
        <div
          data-testid="similar-category-distribution"
          className="rounded-xl border border-border/60 bg-background/60 px-3.5 py-2.5 space-y-2"
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-foreground">相似生态领域分布</span>
            <span className="text-muted-foreground">点击任意色块快速按领域筛选</span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted gap-0.5">
            {categoryDistribution.map((seg) => {
              const selectable = seg.id !== '__other__'
              const active = selectable && selectedCategoryId === seg.id
              return (
                <button
                  key={seg.id}
                  type="button"
                  disabled={!selectable}
                  onClick={() =>
                    selectable &&
                    setSelectedCategoryId((prev) => (prev === seg.id ? '' : seg.id))
                  }
                  style={{ width: `${seg.pct}%` }}
                  title={`${seg.name}：${seg.count} 个（约 ${seg.pct}%）`}
                  aria-label={`按「${seg.name}」筛选，共 ${seg.count} 个站点`}
                  className={cn(
                    'h-full transition-opacity',
                    seg.color,
                    selectable ? 'cursor-pointer hover:opacity-85' : 'cursor-default opacity-60',
                    selectedCategoryId && !active && 'opacity-30',
                  )}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {categoryDistribution.map((seg) => {
              const selectable = seg.id !== '__other__'
              const active = selectable && selectedCategoryId === seg.id
              return (
                <button
                  key={seg.id}
                  type="button"
                  disabled={!selectable}
                  onClick={() =>
                    selectable &&
                    setSelectedCategoryId((prev) => (prev === seg.id ? '' : seg.id))
                  }
                  className={cn(
                    'inline-flex items-center gap-1.5 transition-colors',
                    selectable ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
                    active ? 'font-bold text-primary' : 'text-muted-foreground',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full shrink-0', seg.color)} aria-hidden />
                  <span>{seg.name}</span>
                  <span className="font-mono">{seg.pct}%</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 多维筛选 + 结果内二次关键词搜索 + 排序栏 */}
      <div className="space-y-2.5 rounded-xl border border-border/60 bg-muted/25 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {target && (
              <>
                <button
                  type="button"
                  onClick={() => setScope('all')}
                  aria-pressed={scope === 'all'}
                  className={cn(
                    'h-7 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer border',
                    scope === 'all'
                      ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                      : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  全部 ({report.summary.totalFound})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('same-category')}
                  aria-pressed={scope === 'same-category'}
                  className={cn(
                    'h-7 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer border',
                    scope === 'same-category'
                      ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                      : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  同细分领域 ({report.summary.sameCategoryCount})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('cross-category')}
                  aria-pressed={scope === 'cross-category'}
                  className={cn(
                    'h-7 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer border',
                    scope === 'cross-category'
                      ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                      : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  跨类目发现 ({report.summary.crossCategoryCount})
                </button>
              </>
            )}

            {sameBrandCount > 0 && (
              <button
                type="button"
                onClick={() => setExcludeSameBrand((v) => !v)}
                aria-pressed={excludeSameBrand}
                title="隐藏同域名或同品牌的文档/子站，只看外部独立竞品平替"
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer border',
                  excludeSameBrand
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <Building2 className="h-3 w-3" />
                <span>排除同品牌 ({sameBrandCount})</span>
              </button>
            )}

            {report.summary.openSourceCount > 0 && (
              <button
                type="button"
                onClick={() => setOpenSourceOnly((v) => !v)}
                aria-pressed={openSourceOnly}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer border',
                  openSourceOnly
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <ShieldCheck className="h-3 w-3" />
                <span>开源免费 ({report.summary.openSourceCount})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setHealthyOnly((v) => !v)}
              aria-pressed={healthyOnly}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors cursor-pointer border',
                healthyOnly
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300'
                  : 'border-border/70 bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              <Zap className="h-3 w-3" />
              <span>仅健康直连</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* 结果内关键词二次过滤 */}
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground" aria-hidden />
              <input
                type="text"
                value={keywordFilter}
                onChange={(e) => setKeywordFilter(e.target.value)}
                placeholder="结果内筛词…"
                aria-label="在当前相似站点结果内筛选关键词"
                className="h-7 w-32 sm:w-40 rounded-md border border-border-strong bg-background pl-6 pr-6 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {keywordFilter && (
                <button
                  type="button"
                  onClick={() => setKeywordFilter('')}
                  aria-label="清空结果内关键词"
                  className="absolute right-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
              <label htmlFor={`similar-sort-${mode}`} className="text-muted-foreground shrink-0">
                排序
              </label>
              <select
                id={`similar-sort-${mode}`}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as HubSimilarSortBy)}
                className="h-7 rounded-md border border-border-strong bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 细分分类快捷胶囊 */}
        {report.summary.categories.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
            <span className="text-[11px] font-medium text-muted-foreground mr-0.5">按分类：</span>
            <button
              type="button"
              onClick={() => setSelectedCategoryId('')}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer',
                selectedCategoryId === ''
                  ? 'bg-foreground text-background'
                  : 'bg-background text-muted-foreground border border-border/60 hover:text-foreground',
              )}
            >
              全部分类
            </button>
            {report.summary.categories.slice(0, 8).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategoryId((prev) => (prev === cat.id ? '' : cat.id))}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer',
                  selectedCategoryId === cat.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground border border-border/60 hover:text-foreground',
                )}
              >
                {cat.name} <span className="font-mono">{cat.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* 重合主题标签快捷筛选 */}
        {(report.summary.topSharedTags.length > 0 || hasActiveFilters) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
            {report.summary.topSharedTags.length > 0 && (
              <>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground mr-0.5">
                  <Tag className="h-3 w-3" aria-hidden />
                  <span>共同标签：</span>
                </span>
                {report.summary.topSharedTags.slice(0, 8).map(({ tag, count }) => {
                  const active = selectedTag.toLowerCase() === tag.toLowerCase()
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setSelectedTag((prev) => (prev.toLowerCase() === tag.toLowerCase() ? '' : tag))}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer border',
                        active
                          ? 'border-primary bg-primary/15 text-primary font-semibold'
                          : 'border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      #{tag} <span className="font-mono">{count}</span>
                    </button>
                  )
                })}
              </>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto text-[11px] font-medium text-primary hover:underline cursor-pointer"
              >
                清空筛选（命中 {filteredItems.length} 项）
              </button>
            )}
          </div>
        )}
      </div>

      {/* 即时横评对比操作条（勾选任意站即可免登录一键开表对照） */}
      {vsItems.length > 0 && (
        <div
          data-testid="similar-vs-bar"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-primary/35 bg-primary/8 px-3.5 py-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <Scale className="h-4 w-4 text-primary shrink-0" aria-hidden />
            <span className="font-semibold text-foreground">即时横评对比：</span>
            {target && (
              <span className="rounded-full bg-background px-2 py-0.5 font-medium text-foreground border border-primary/30">
                {target.site.title}（基准）
              </span>
            )}
            {vsItems.map((item) => (
              <span
                key={item.site.id}
                className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 font-medium text-foreground border border-border/70"
              >
                <span>{item.site.title}</span>
                <button
                  type="button"
                  onClick={() => toggleVsPick(item.site.id)}
                  aria-label={`移出对比：${item.site.title}`}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setVsIds([])}
              className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              清空
            </button>
            <Button
              type="button"
              size="sm"
              onClick={() => setVsOpen(true)}
              className="h-7 px-3 text-xs font-semibold gap-1 cursor-pointer"
            >
              <Scale className="h-3.5 w-3.5" />
              <span>开始横评 ({vsItems.length + (target ? 1 : 0)} 站)</span>
            </Button>
          </div>
        </div>
      )}

      {/* 结果列表 */}
      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-6 text-center space-y-2">
          <p className="text-sm font-medium text-foreground">当前筛选条件下暂无匹配站点</p>
          <p className="text-xs text-muted-foreground">尝试放宽「开源」「排除同品牌」「关键词」或「分类」过滤条件。</p>
          <Button type="button" variant="outline" size="sm" onClick={resetFilters} className="mt-1 h-8 text-xs cursor-pointer">
            重置全部筛选
          </Button>
        </div>
      ) : (
        <ol
          className={cn(
            layout === 'ranked'
              ? 'space-y-3'
              : 'grid grid-cols-1 gap-3 sm:grid-cols-2',
          )}
        >
          {visibleItems.map((item, idx) => {
            const tone = similarityTone(item.similarityPercent)
            const host = safeHostname(item.site.url)
            const isExpanded = Boolean(expandedBreakdownIds[item.site.id])
            const isVsPicked = vsIds.includes(item.site.id)
            const latencyMs = item.site.health?.ok && typeof item.site.health.latencyMs === 'number'
              ? item.site.health.latencyMs
              : null
            const uniqueTags = item.uniqueTags ?? []

            return (
              <li
                key={item.site.id}
                data-similar-site-card={item.site.id}
                className={cn(
                  'group rounded-xl border bg-background/85 p-3.5 sm:p-4 transition-all hover:shadow-sm',
                  isVsPicked
                    ? 'border-primary ring-1 ring-primary/35 bg-primary/[0.03]'
                    : 'border-border/75 hover:border-primary/45',
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  {/* 左侧：排名序标 + 图标 + 核心信息 */}
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                      <span
                        className={cn(
                          'inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-mono text-[11px] font-bold',
                          idx < 3
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {idx + 1}
                      </span>
                      <div className="h-10 w-10 rounded-xl border border-border/60 bg-muted/50 p-1.5 flex items-center justify-center overflow-hidden">
                        <SiteFavicon
                          title={item.site.title}
                          url={item.site.url}
                          icon={item.site.iconKey ?? undefined}
                          className="h-full w-full object-contain rounded"
                        />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          href={`/site/${encodeURIComponent(item.site.id)}`}
                          className="text-sm sm:text-[15px] font-bold text-foreground hover:text-primary hover:underline truncate max-w-full"
                        >
                          {item.site.title}
                        </Link>
                        {item.relationType === 'alternative' && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            <GitFork className="h-2.5 w-2.5" />
                            <span>认证平替</span>
                          </span>
                        )}
                        {item.isSameBrand && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            <Building2 className="h-2.5 w-2.5" />
                            <span>同品牌矩阵</span>
                          </span>
                        )}
                        {item.isOpenSource && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <ShieldCheck className="h-2.5 w-2.5" />
                            <span>开源</span>
                          </span>
                        )}
                        {item.categoryName && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {item.categoryName}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground font-mono">
                        <span className="inline-flex items-center gap-1 truncate max-w-[220px]">
                          <Globe className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{host}</span>
                        </span>
                        <span>全库 #{item.siteRank}</span>
                        <span>类目 #{item.categoryRank}</span>
                        {latencyMs !== null && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <Activity className="h-3 w-3" aria-hidden />
                            <span>{latencyMs}ms</span>
                          </span>
                        )}
                      </div>

                      {item.site.description && (
                        <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                          {item.site.description}
                        </p>
                      )}

                      {/* 共同标签 + 差异亮点 + 匹配依据 */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {(item.sharedTags ?? []).slice(0, 3).map((t) => (
                          <Link
                            key={t}
                            href={`/tags/${encodeURIComponent(tagSlug(t))}`}
                            className="rounded-full border border-primary/25 bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
                          >
                            #{t}
                          </Link>
                        ))}
                        {uniqueTags.slice(0, 2).map((t) => (
                          <span
                            key={`u-${t}`}
                            title="该替代站独有的特色标签"
                            className="rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            +{t}
                          </span>
                        ))}
                        {(item.reasons ?? [])[0] && (
                          <span className="text-[11px] text-muted-foreground">
                            · {(item.reasons ?? [])[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 右侧：环形相似度仪表 + 完整操作条（加宽至 sm:w-60 防止拆解按钮孤行折行） */}
                  <div
                    className={cn(
                      'flex shrink-0 gap-2.5 border-t border-border/50 pt-2.5 sm:border-t-0 sm:pt-0',
                      layout === 'ranked'
                        ? 'flex-row items-center justify-between sm:w-60 sm:flex-col sm:items-end'
                        : 'flex-row items-center justify-between sm:flex-col sm:items-end',
                    )}
                  >
                    <div className="flex items-center gap-2.5 sm:w-full sm:justify-end">
                      <div className="flex-1 sm:max-w-[148px] space-y-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone.badge)}>
                            {tone.label}
                          </span>
                          <span className="font-mono text-xs font-extrabold text-foreground">
                            {item.similarityPercent}%
                          </span>
                        </div>
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuenow={item.similarityPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${item.site.title} 相似度 ${item.similarityPercent}%`}
                        >
                          <div
                            className={cn('h-full rounded-full transition-all duration-300', tone.bar)}
                            style={{ width: `${item.similarityPercent}%` }}
                          />
                        </div>
                      </div>
                      <SimilarityRing percent={item.similarityPercent} strokeClass={tone.stroke} />
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Button asChild size="sm" variant="default" className="h-7 px-2 text-[11px] gap-1">
                        <a
                          href={safeHref(item.site.url)}
                          target="_blank"
                          rel={externalRel}
                          aria-label={`访问 ${item.site.title} 官网`}
                        >
                          <span>访问</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>

                      <button
                        type="button"
                        onClick={() => toggleVsPick(item.site.id)}
                        aria-pressed={isVsPicked}
                        title={isVsPicked ? '已加入横评，点击移出' : `将「${item.site.title}」加入即时横评对比`}
                        className={cn(
                          'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors cursor-pointer',
                          isVsPicked
                            ? 'border-primary bg-primary/15 text-primary'
                            : 'border-border/70 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                        )}
                      >
                        <Scale className="h-3 w-3" />
                        <span>{isVsPicked ? '已选' : 'VS'}</span>
                      </button>

                      {onExploreSite ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onExploreSite(host || item.site.title)}
                          className="h-7 px-2 text-[11px] gap-1 cursor-pointer"
                          title={`以「${item.site.title}」为起点继续查相似站`}
                        >
                          <Radar className="h-3 w-3 text-primary" />
                          <span>找相似</span>
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1">
                          <Link
                            href={`/similar?q=${encodeURIComponent(host || item.site.title)}`}
                            title={`以「${item.site.title}」为起点继续查相似站`}
                          >
                            <Radar className="h-3 w-3 text-primary" />
                            <span>找相似</span>
                          </Link>
                        </Button>
                      )}

                      <FavoriteButton
                        site={{
                          siteId: item.site.id,
                          title: item.site.title,
                          href: item.site.url,
                          icon: item.site.iconKey ?? undefined,
                          description: item.site.description ?? undefined,
                        }}
                      />

                      <button
                        type="button"
                        onClick={() => toggleBreakdown(item.site.id)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? `收起 ${item.site.title} 相似度拆解` : `查看 ${item.site.title} 相似度拆解`}
                        className="inline-flex h-7 items-center gap-0.5 rounded-md border border-border/70 bg-muted/40 px-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <span>拆解</span>
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 可展开：5 维相似度信号拆解 + 差异特色标签 + 完整匹配依据 */}
                {isExpanded && (
                  <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                      {BREAKDOWN_DIMS.map((dim) => {
                        const val = item.breakdown[dim.key]
                        return (
                          <div key={dim.key} className="space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-muted-foreground">{dim.label}</span>
                              <span className="font-mono font-semibold text-foreground">{val}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                              <div className={cn('h-full rounded-full', dim.color)} style={{ width: `${val}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {uniqueTags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40 text-[11px]">
                        <span className="font-semibold text-foreground">相对特色（该站独有）：</span>
                        {uniqueTags.map((t) => (
                          <span key={t} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                            +{t}
                          </span>
                        ))}
                      </div>
                    )}
                    {(item.reasons ?? []).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground">匹配依据：</span>
                        {(item.reasons ?? []).map((r, i) => (
                          <span key={i} className="rounded bg-background px-2 py-0.5 border border-border/50">
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {/* 展开更多按钮 */}
      {filteredItems.length > visibleCount && (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((c) => c + 12)}
            className="h-9 px-5 text-xs font-semibold gap-1.5 cursor-pointer"
          >
            <span>展开更多相似站点（剩余 {filteredItems.length - visibleCount} 个）</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* 免登录即时横评对比弹窗 */}
      <Dialog open={vsOpen} onOpenChange={setVsOpen}>
        <DialogContent className="min-w-0 max-w-[calc(100vw-1.5rem)] sm:max-w-3xl max-h-[85vh] flex flex-col gap-3 p-4 sm:p-6 overflow-hidden">
          <DialogHeader className="shrink-0 text-left pr-6">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Scale className="h-4 w-4 text-primary" />
              <span>竞品即时横评对比（{vsItems.length + (target ? 1 : 0)} 站）</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              基于本库真实排名、健康延迟、5 维相似度与标签差异的透明对照表，免登录即可导出分享。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border/70 bg-muted/50">
                  <th className="w-24 p-2.5 font-semibold text-muted-foreground">对比维度</th>
                  {target && (
                    <th className="min-w-[150px] p-2.5 font-bold text-foreground bg-primary/[0.06]">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 shrink-0 rounded border border-border/60 bg-background p-0.5">
                          <SiteFavicon title={target.site.title} url={target.site.url} icon={target.site.iconKey ?? undefined} className="h-full w-full" />
                        </div>
                        <span className="truncate">{target.site.title}</span>
                      </div>
                      <span className="mt-0.5 inline-block text-[10px] font-medium text-primary">基准目标站</span>
                    </th>
                  )}
                  {vsItems.map((item) => (
                    <th key={item.site.id} className="min-w-[150px] p-2.5 font-bold text-foreground">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 shrink-0 rounded border border-border/60 bg-background p-0.5">
                          <SiteFavicon title={item.site.title} url={item.site.url} icon={item.site.iconKey ?? undefined} className="h-full w-full" />
                        </div>
                        <span className="truncate">{item.site.title}</span>
                      </div>
                      <span className="mt-0.5 inline-block font-mono text-[10px] text-muted-foreground">
                        {safeHostname(item.site.url)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                <tr>
                  <td className="p-2.5 font-medium text-muted-foreground">综合相似度</td>
                  {target && <td className="p-2.5 font-mono font-semibold text-primary bg-primary/[0.03]">基准 100%</td>}
                  {vsItems.map((item) => (
                    <td key={item.site.id} className="p-2.5 font-mono font-extrabold text-foreground">
                      {item.similarityPercent}%
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-muted-foreground">全库 / 类目排名</td>
                  {target && (
                    <td className="p-2.5 font-mono bg-primary/[0.03]">
                      #{target.siteRank} / 类目 #{target.categoryRank}
                    </td>
                  )}
                  {vsItems.map((item) => (
                    <td key={item.site.id} className="p-2.5 font-mono">
                      #{item.siteRank} / 类目 #{item.categoryRank}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-muted-foreground">所属分类</td>
                  {target && <td className="p-2.5 bg-primary/[0.03]">{target.categoryName ?? '-'}</td>}
                  {vsItems.map((item) => (
                    <td key={item.site.id} className="p-2.5">
                      {item.categoryName ?? '-'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-muted-foreground">开源与可达性</td>
                  {target && (
                    <td className="p-2.5 bg-primary/[0.03]">
                      {target.isOpenSource ? '开源' : '商业/闭源'}
                      {target.site.health?.ok && typeof target.site.health.latencyMs === 'number'
                        ? ` · ${target.site.health.latencyMs}ms`
                        : ''}
                    </td>
                  )}
                  {vsItems.map((item) => (
                    <td key={item.site.id} className="p-2.5">
                      {item.isOpenSource ? '开源' : '商业/闭源'}
                      {item.site.health?.ok && typeof item.site.health.latencyMs === 'number'
                        ? ` · ${item.site.health.latencyMs}ms`
                        : item.isHealthy
                          ? ' · 可达'
                          : ' · 待复检'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-muted-foreground">共有标签</td>
                  {target && (
                    <td className="p-2.5 bg-primary/[0.03] text-muted-foreground">
                      {(target.site.tags ?? []).slice(0, 4).map((t) => `#${t}`).join(' ') || '无'}
                    </td>
                  )}
                  {vsItems.map((item) => (
                    <td key={item.site.id} className="p-2.5 text-primary">
                      {(item.sharedTags ?? []).slice(0, 4).map((t) => `#${t}`).join(' ') || '跨领域语义匹配'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-muted-foreground">差异特色</td>
                  {target && <td className="p-2.5 bg-primary/[0.03] text-muted-foreground">参考基准</td>}
                  {vsItems.map((item) => (
                    <td key={item.site.id} className="p-2.5 text-emerald-700 dark:text-emerald-300">
                      {(item.uniqueTags ?? []).slice(0, 4).map((t) => `+${t}`).join(' ') || '定位高度一致'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2.5 font-medium text-muted-foreground">直达入口</td>
                  {target && (
                    <td className="p-2.5 bg-primary/[0.03]">
                      <a href={safeHref(target.site.url)} target="_blank" rel={externalRel} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <span>官网</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  )}
                  {vsItems.map((item) => (
                    <td key={item.site.id} className="p-2.5">
                      <a href={safeHref(item.site.url)} target="_blank" rel={externalRel} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <span>官网</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 shrink-0">
            <span className="text-[11px] text-muted-foreground">
              数据源自全站实时收录档案，零虚构指标
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCopyVsMarkdown} className="h-8 text-xs gap-1.5 cursor-pointer">
                {copiedAction === 'vs' ? <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedAction === 'vs' ? '已复制对比表' : '复制 Markdown 对比表'}</span>
              </Button>
              <Button type="button" size="sm" onClick={() => setVsOpen(false)} className="h-8 text-xs cursor-pointer">
                完成
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
