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
  X,
} from 'lucide-react'
import {
  fetchSite,
  fetchSimilar,
  fetchSiteRelations,
  type HubSite,
  type HubSiteRelation,
} from '@/lib/navhub-api'
import { EmptyState } from '@/components/ui/empty-state'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { copyText } from '@/lib/clipboard'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { SiteFavicon } from '@/components/site-favicon'
import { siteHealthBadge } from '@/lib/site-health'
import { safeHref } from '@/lib/safe-url'
import { cn } from '@/lib/utils'

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

const FACET_LABELS: Record<string, { label: string; icon: any }> = {
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
  /** 相关站点的取数范围：本分类 / 父分类子树 / 全站兜底 */
  relatedScope?: 'category' | 'parent' | 'more'
  /** 相关范围对应的分类名（全站兜底时为 null） */
  relatedLabel?: string | null
  /** 「浏览全部」入口：只有站点数达标的相关分类才有公开页 */
  relatedCategory?: { slug: string; title: string; count: number } | null
  /** 服务端渲染的可见面包屑 + BreadcrumbList JSON-LD */
  breadcrumb?: ReactNode
}) {
  const [site, setSite] = useState<HubSite | null>(initialSite)
  const [similar, setSimilar] = useState<HubSite[]>([])
  const [relations, setRelations] = useState<HubSiteRelation[]>([])
  /** 关系网络降级：中枢不可用时 relations 静默为空，需与「确实没有关系」区分 */
  const [relationsDegraded, setRelationsDegraded] = useState(false)
  const [loading, setLoading] = useState(!initialSite)
  const [notFound, setNotFound] = useState(false)
  const { copyFeedback, reportCopy } = useCopyFeedback()
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

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
                {healthBadge && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-xs border ${
                      healthBadge.tone === 'ok'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${healthBadge.tone === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                    <span>{healthBadge.label}</span>
                    {healthBadge.latencyMs != null && <span>({healthBadge.latencyMs}ms)</span>}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={safeHref(site.url)}
                  target="_blank"
                  rel="noopener noreferrer"
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
                  {site.tags.map((t) => (
                    <Link
                      key={t}
                      href={'/tags/' + encodeURIComponent(tagSlug(t))}
                      className="text-xs px-2.5 py-0.5 rounded-full bg-muted/80 hover:bg-primary/10 hover:text-primary border border-border/50 transition-colors"
                    >
                      #{t}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 操作按钮栏 */}
          <div className="pt-4 border-t border-border/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Button asChild size="sm" className="h-9 text-xs px-4 gap-1.5 shadow-xs font-semibold">
                <a href={safeHref(site.url)} target="_blank" rel="noopener noreferrer">
                  <span>立即直达官方主站</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
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
          <div className="space-y-3.5">
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
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary font-mono truncate block mt-0.5"
                      >
                        {alt.targetUrl}
                      </a>
                    </div>

                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                      <a href={safeHref(alt.targetUrl)} target="_blank" rel="noopener noreferrer">
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
                        <a href={safeHref(eco.targetUrl)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
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
                <span>{relatedScope === 'parent' ? '同类目站点' : relatedScope === 'more' ? '更多站点' : '同分类站点'}</span>
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
                        rel="noopener noreferrer"
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
                  <a href={safeHref(s.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3">
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
      </div>
      <Footer />
    </Container>
  )
}
