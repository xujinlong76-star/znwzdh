'use client'

/**
 * 精选专题详情客户端岛：专题介绍 + 站点列表 + 路线图时间轴 + 书签导出。
 *
 * 首屏数据由服务端 page 经 props 下发（站点卡片的 `/site/{id}` 内链必须进
 * SSR HTML）；本岛只负责降级重试、收藏与搜索面板。首帧已有数据时跳过
 * 挂载期请求，避免把 SSR 内容闪成骨架屏。
 */

import { useEffect, useState, useMemo } from 'react'
import { safeHref } from '@/lib/safe-url'
import Link from 'next/link'
import { FavoriteButton } from '@/components/favorite-button'
import { fetchCollectionDetail, type HubCollection, type HubCollectionDetailSite } from '@/lib/navhub-api'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { SearchPalette } from '@/components/search-palette'
import { ArrowLeft, Layers, ExternalLink, Boxes, Download, LayoutGrid, Milestone, Sparkles, MapPin, Video, ArrowRight, Search, X, Copy, Check, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SiteFavicon } from '@/components/site-favicon'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useFavorites } from '@/hooks/useFavorites'
import { copyText, copyFailureToast } from '@/lib/clipboard'
import { useToast } from '@/components/ui/use-toast'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'

export default function CollectionDetailView({
  slug,
  initialCollection = null,
  initialSites = [],
}: {
  slug: string
  initialCollection?: HubCollection | null
  initialSites?: HubCollectionDetailSite[]
}) {
  const externalRel = externalLinkRelAttr(useSiteViewModel()?.externalLinkRel)
  const favorites = useFavorites()
  const { toast } = useToast()
  const [collection, setCollection] = useState<HubCollection | null>(initialCollection)
  const [sites, setSites] = useState<HubCollectionDetailSite[]>(initialSites)
  const [loading, setLoading] = useState(!initialCollection)
  const [missing, setMissing] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'roadmap'>('grid')
  const [siteFilterQuery, setSiteFilterQuery] = useState('')
  const [copiedLinks, setCopiedLinks] = useState(false)
  const [batchFavoriting, setBatchFavoriting] = useState(false)

  // 路线图阶段打卡记录（保存在本地存储）
  const [completedSiteIds, setCompletedSiteIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = localStorage.getItem(`navhub_roadmap_progress:${slug}`)
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch {
      return new Set()
    }
  })

  const toggleSiteProgress = (siteId: string) => {
    setCompletedSiteIds((prev) => {
      const next = new Set(prev)
      if (next.has(siteId)) next.delete(siteId)
      else next.add(siteId)
      try {
        localStorage.setItem(`navhub_roadmap_progress:${slug}`, JSON.stringify([...next]))
      } catch {
        // 存储受限
      }
      return next
    })
  }

  const filteredSites = useMemo(() => {
    if (!siteFilterQuery.trim()) return sites
    const q = siteFilterQuery.trim().toLowerCase()
    return sites.filter((s) => {
      const titleMatch = s.title.toLowerCase().includes(q)
      const descMatch = (s.description ?? '').toLowerCase().includes(q)
      const noteMatch = (s.collectionNote ?? '').toLowerCase().includes(q)
      const urlMatch = (s.url ?? '').toLowerCase().includes(q)
      return titleMatch || descMatch || noteMatch || urlMatch
    })
  }, [sites, siteFilterQuery])
  /**
   * 区分「专题确实下架」（404）与「中枢挂了」（5xx / 网络失败）。
   * 以前两者都渲染成「专题不存在或已下架」，一次机房抖动就让用户以为专题没了。
   */
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

  useEffect(() => {
    if (!slug) return
    // 首帧用 SSR 数据；只有用户点重试（reloadToken>0）才客户端重取
    if (initialCollection && reloadToken === 0) return
    let cancelled = false
    let failed = false
    setLoading(true)
    setMissing(false)
    setNotice(null)
    void fetchCollectionDetail(slug, (error) => {
      failed = true
      if (!cancelled) setNotice(describeDegrade(error, '专题数据'))
    }).then((d: { collection: HubCollection; sites: HubCollectionDetailSite[] } | null) => {
      if (cancelled) return
      if (!d && !failed) setMissing(true)
      else if (d) {
        setCollection(d.collection)
        setSites(d.sites ?? [])
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [slug, reloadToken, initialCollection])

  const handleCopyLinks = async () => {
    if (!collection || sites.length === 0) return
    const text = sites
      .map((s) => `- [${s.title}](${s.url})${s.collectionNote || s.description ? ` - ${s.collectionNote || s.description}` : ''}`)
      .join('\n')
    const res = await copyText(text)
    if (res.ok) {
      setCopiedLinks(true)
      setTimeout(() => setCopiedLinks(false), 2000)
      toast({
        title: '已复制专题链接',
        description: `已复制「${collection.title}」全部 ${sites.length} 个站点链接（Markdown 格式）`,
      })
    } else {
      toast({
        ...copyFailureToast(res),
        variant: 'destructive',
      })
    }
  }

  const unfavoritedSites = useMemo(() => {
    return sites.filter((s) => !favorites.isFavorite(s.id))
  }, [sites, favorites])

  const completedCount = useMemo(() => {
    return sites.filter((s) => completedSiteIds.has(s.id)).length
  }, [sites, completedSiteIds])

  const progressPercent = useMemo(() => {
    if (sites.length === 0) return 0
    return Math.round((completedCount / sites.length) * 100)
  }, [completedCount, sites.length])

  const handleBatchFavorite = async () => {
    if (!collection || sites.length === 0 || unfavoritedSites.length === 0) return
    setBatchFavoriting(true)
    let count = 0
    try {
      for (const s of unfavoritedSites) {
        await favorites.toggle({
          siteId: s.id,
          title: s.title,
          href: s.url,
          icon: s.iconKey ?? undefined,
          description: s.description ?? undefined,
        })
        count++
      }
      toast({
        title: '批量收藏成功',
        description: `已将「${collection.title}」中的 ${count} 个站点加入本地收藏夹`,
      })
    } catch {
      toast({
        title: '批量收藏部分失败',
        description: '请检查本地存储权限',
        variant: 'destructive',
      })
    } finally {
      setBatchFavoriting(false)
    }
  }

  const handleExportBookmarks = () => {
    if (!collection || sites.length === 0) return
    const now = Math.floor(Date.now() / 1000)
    const items = sites
      .map(
        (s) =>
          `        <DT><A HREF="${s.url}" ADD_DATE="${now}">${s.title}</A>${
            s.collectionNote || s.description ? `\n        <DD>${s.collectionNote || s.description}` : ''
          }`,
      )
      .join('\n')
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>${collection.title} - 山羊胡专题书签</TITLE>
<H1>${collection.title}</H1>
<DL><p>
    <DT><H3 ADD_DATE="${now}" LAST_MODIFIED="${now}">${collection.title}</H3>
    <DL><p>
${items}
    </DL><p>
</DL><p>`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${collection.slug || 'collection'}-bookmarks.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isRoadmap = collection?.kind === 'roadmap'

  return (
    <>
      <div className="space-y-5 sm:space-y-6">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/collections"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>全部专题</span>
          </Link>

          {collection && sites.length > 0 && (
            <div className="flex items-center gap-2">
              {isRoadmap && (
                <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/50 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                      viewMode === 'grid'
                        ? 'bg-background text-foreground shadow-xs font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    <span>网格</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('roadmap')}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                      viewMode === 'roadmap'
                        ? 'bg-background text-foreground shadow-xs font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Milestone className="w-3 h-3 text-indigo-500" />
                    <span>路线图</span>
                  </button>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLinks}
                className="h-7 px-2.5 text-xs inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground border-border/70"
                title="一键复制本专题所有站点链接（Markdown 格式）"
              >
                {copiedLinks ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="hidden sm:inline text-emerald-600 dark:text-emerald-400">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="hidden sm:inline">复制链接</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportBookmarks}
                className="h-7 px-2.5 text-xs inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground border-border/70"
                title="导出本专题所有站点为浏览器书签 HTML"
              >
                <Download className="w-3.5 h-3.5 text-violet-500" />
                <span className="hidden sm:inline">导出书签</span>
              </Button>
              {unfavoritedSites.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={batchFavoriting}
                  onClick={handleBatchFavorite}
                  className="h-7 px-2.5 text-xs inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  title="一键将该合集所有站点加入我的收藏"
                >
                  <Star className="w-3.5 h-3.5 fill-amber-500/20 text-amber-500" />
                  <span className="hidden sm:inline">全部收藏 ({unfavoritedSites.length})</span>
                </Button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div aria-busy="true" aria-live="polite" aria-label="正在加载专题" className="space-y-6">
            <span className="sr-only">正在加载专题…</span>
            <div className="rounded-2xl border border-border/70 bg-card/50 p-6 sm:p-8 space-y-3 animate-pulse">
              <div className="h-5 w-24 rounded-full bg-muted" />
              <div className="h-8 w-2/3 rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-4/5 rounded bg-muted" />
            </div>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
              style={{ gap: 'var(--density-grid-gap, 1rem)' }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border/70 bg-card/50 p-[var(--density-card-padding,0.875rem)] space-y-3 animate-pulse">
                  <div className="flex items-start gap-2.5">
                    <div className="h-10 w-10 rounded-lg bg-muted shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-full rounded bg-muted" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : notice && !collection ? (
          <div className="py-12 space-y-4 max-w-md mx-auto text-center">
            <p className="text-muted-foreground text-sm">暂时无法加载该专题</p>
            <HubDegradedNotice notice={notice} onRetry={reload} incompleteHint={false} />
          </div>
        ) : missing || !collection ? (
          <EmptyState
            icon={Layers}
            iconTone="muted"
            title="专题不存在或已下架"
            description="这个专题可能已被站长下线，或链接里的 slug 不完整；可以回到专题列表看看其他合集。"
            action={
              <Button asChild size="sm" variant="outline" className="text-xs">
                <Link href="/collections">浏览全部专题</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-4 sm:p-8 shadow-xs">
              <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
              <Layers
                aria-hidden
                strokeWidth={1}
                className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
              />
              <div className="relative z-10 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-violet-500 border-violet-500/30 bg-violet-500/5 text-xs">
                    {collection.kind === 'roadmap' ? (
                      <Milestone className="w-3 h-3 mr-1 text-indigo-500" />
                    ) : collection.kind === 'geo' ? (
                      <MapPin className="w-3 h-3 mr-1 text-emerald-500" />
                    ) : (
                      <Layers className="w-3 h-3 mr-1" />
                    )}
                    {collection.kind === 'roadmap'
                      ? '路线图专题'
                      : collection.kind === 'geo'
                        ? '地域专题'
                        : '精选专题'}
                  </Badge>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{collection.title}</h1>
                {collection.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
                    {collection.description}
                  </p>
                )}
                <div className="mt-4 pt-3.5 border-t border-border/50 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-violet-500/25 bg-violet-500/5 text-xs text-violet-600 dark:text-violet-400">
                    <Layers className="w-3 h-3" />
                    共收录 {sites.length} 个站点
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                    站长人工策划
                  </span>
                </div>
              </div>
            </div>

            {/* 站内搜索：专题只覆盖其中一部分站点，给出「直接搜全部」的出口 */}
            <SearchPalette placeholder="不限于本专题：搜索全部站点（中文 / 拼音 / 语义）" />

            {/* 跨生态技术视频联动横幅 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-blue-500/25 bg-blue-500/5 text-xs text-foreground">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Video className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-foreground truncate">
                    相关技术视频教程：{collection.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    在 6,000+ 部精选视频库中查看「{collection.title}」对应的实战教程与深度讲解
                  </div>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" className="text-xs shrink-0 self-start sm:self-auto border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10">
                <Link href={`/videos?q=${encodeURIComponent(collection.title)}`}>
                  <span>查看相关视频</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Link>
              </Button>
            </div>

            {/* 专题内即时快速筛选条 */}
            {sites.length > 2 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-muted/30 border border-border/60 rounded-xl p-2.5">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={siteFilterQuery}
                    onChange={(e) => setSiteFilterQuery(e.target.value)}
                    placeholder={`在「${collection.title}」内极速筛选站点...`}
                    aria-label={`在专题${collection.title}内筛选站点`}
                    className="w-full text-xs bg-background/80 border border-border/60 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-lg pl-8 pr-8 py-1.5 outline-none transition-colors"
                  />
                  {siteFilterQuery && (
                    <button
                      type="button"
                      onClick={() => setSiteFilterQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                      title="清空筛选"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground shrink-0 px-1">
                  显示 <span className="font-mono font-semibold text-foreground">{filteredSites.length}</span> / {sites.length} 个站点
                </div>
              </div>
            )}

            {sites.length === 0 ? (
              <EmptyState
                icon={Boxes}
                iconTone="muted"
                title="该专题暂时没有站点"
                description="专题可能还在编排中；可以用上方搜索直接查全部站点，或回专题列表逛逛。"
                action={
                  <Button asChild size="sm" variant="outline" className="text-xs">
                    <Link href="/collections">浏览全部专题</Link>
                  </Button>
                }
              />
            ) : filteredSites.length === 0 ? (
              <EmptyState
                icon={Search}
                iconTone="muted"
                title="未找到匹配站点"
                description={`在「${collection.title}」中未搜索到包含 “${siteFilterQuery}” 的站点`}
                action={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => setSiteFilterQuery('')}
                  >
                    清空筛选条件
                  </Button>
                }
              />
            ) : isRoadmap && viewMode === 'roadmap' ? (
              /* 路线图时间轴视图 */
              <div className="space-y-4">
                {/* 学习进度条 */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-indigo-500/25 bg-indigo-500/5 text-xs">
                  <div className="flex items-center gap-2">
                    <Milestone className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="font-semibold text-foreground">路线图阶段学习打卡</span>
                    <span className="text-muted-foreground">
                      已掌握 <span className="font-semibold text-indigo-600 dark:text-indigo-400 font-mono">{completedCount}</span> / {sites.length} 阶段 ({progressPercent}%)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-32 sm:w-48 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all duration-300 rounded-full"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="relative pl-6 sm:pl-8 space-y-6 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-indigo-500/30">
                  {filteredSites.map((site, index) => {
                    const isCompleted = completedSiteIds.has(site.id)
                    return (
                      <div key={site.id} className="relative group">
                        {/* 时间轴序号节点：点击打卡 */}
                        <button
                          type="button"
                          onClick={() => toggleSiteProgress(site.id)}
                          className={cn(
                            "absolute -left-6 sm:-left-8 top-3 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shadow-xs transition-colors cursor-pointer",
                            isCompleted
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : "bg-background border-indigo-500 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50"
                          )}
                          title={isCompleted ? "点击取消掌握标记" : "点击标记为已掌握"}
                        >
                          {isCompleted ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : index + 1}
                        </button>

                        <div className={cn(
                          "rounded-xl border transition-all shadow-xs p-4",
                          isCompleted
                            ? "border-emerald-500/40 bg-emerald-500/[0.02]"
                            : "border-border/70 hover:border-indigo-500/40 bg-card/90"
                        )}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <div className="shrink-0 w-10 h-10 rounded-lg p-1.5 bg-muted/50 border border-border/50 flex items-center justify-center">
                                <SiteFavicon
                                  title={site.title}
                                  url={site.url}
                                  icon={site.iconKey ?? undefined}
                                  className="w-full h-full object-contain rounded-xs"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={cn(
                                    "text-xs font-mono font-semibold px-1.5 py-0.5 rounded",
                                    isCompleted
                                      ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                                      : "text-indigo-500 bg-indigo-500/10"
                                  )}>
                                    阶段 {index + 1}
                                  </span>
                                  <a
                                    href={safeHref(site.url)}
                                    target="_blank"
                                    rel={externalRel}
                                    className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate"
                                  >
                                    {site.title}
                                  </a>
                                  {isCompleted && (
                                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded font-medium">
                                      已掌握
                                    </span>
                                  )}
                                </div>
                                {site.description && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                    {site.description}
                                  </p>
                                )}
                                {site.collectionNote && (
                                  <div className="mt-2 text-xs bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20 rounded-md p-2 flex items-start gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                      <span className="font-semibold">学习与实践要点：</span>
                                      <span>{site.collectionNote}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleSiteProgress(site.id)}
                                className={cn(
                                  "h-7 px-2 text-xs",
                                  isCompleted ? "text-emerald-600 hover:text-emerald-700" : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                {isCompleted ? '已掌握' : '标记已学'}
                              </Button>
                              <Link
                                href={`/site/${encodeURIComponent(site.id)}`}
                                className="text-xs text-primary hover:underline underline-offset-4 px-2 py-1"
                              >
                                站内详情
                              </Link>
                              <a
                                href={safeHref(site.url)}
                                target="_blank"
                                rel={externalRel}
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                                title="新标签页打开"
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
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 transition-all duration-200"
                style={{ gap: 'var(--density-grid-gap, 1rem)' }}
              >
                {filteredSites.map((site) => (
                  <div
                    key={site.id}
                    className="relative group rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 backdrop-blur-xs transition-all duration-200 hover:-translate-y-0.5 p-[var(--density-card-padding,0.875rem)] flex flex-col justify-between shadow-2xs"
                  >
                    <a href={safeHref(site.url)} target="_blank" rel={externalRel} className="block min-w-0 flex-1">
                      <div className="flex items-start gap-2.5">
                        <div className="shrink-0 w-10 h-10 rounded-lg p-1.5 bg-muted/50 border border-border/50 flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-xs">
                          <SiteFavicon
                            title={site.title}
                            url={site.url}
                            icon={site.iconKey ?? undefined}
                            className="w-full h-full object-contain rounded-xs"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors truncate pr-8">
                            {site.title}
                          </div>
                          {site.description && (
                            <div className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed mt-1">
                              {site.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </a>

                    {/* 策展点评推荐语 */}
                    {site.collectionNote && (
                      <div className="mt-2 text-xs bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20 rounded-md px-2 py-1 flex items-start gap-1">
                        <span className="font-semibold shrink-0">💡 推荐语：</span>
                        <span className="line-clamp-2 leading-relaxed">{site.collectionNote}</span>
                      </div>
                    )}

                    {/* 站内详情内链：与 SSG 的 /site/{id} 一起进首屏 HTML */}
                    <div className="mt-2 flex justify-end">
                      <Link
                        href={`/site/${encodeURIComponent(site.id)}`}
                        className="text-xs text-primary hover:underline underline-offset-4"
                      >
                        站内详情
                      </Link>
                    </div>
                    <div className="absolute top-2 right-2 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1">
                      <a
                        href={safeHref(site.url)}
                        target="_blank"
                        rel={externalRel}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                        title="新标签页打开"
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
            )}
          </>
        )}
      </div>
    </>
  )
}
