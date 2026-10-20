'use client'

/**
 * 榜单页：热度榜 / 新品榜。
 * 热度分来自中枢 recompute_rank 任务（Phase 3 落地；
 * 未重算时按 visit_count 兜底，不会空白）。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { FavoriteButton } from '@/components/favorite-button'
import { Footer } from '@/components/footer'
import { fetchNewSites, fetchTrending, type HubSite } from '@/lib/navhub-api'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { SearchPalette } from '@/components/search-palette'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Flame, Sparkles, ArrowLeft, Trophy, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import { DensityToggle } from '@/components/density-toggle'
import { SiteFavicon } from '@/components/site-favicon'
import { EmptyState } from '@/components/ui/empty-state'

export default function HotPage() {
  const [trending, setTrending] = useState<HubSite[]>([])
  const [fresh, setFresh] = useState<HubSite[]>([])
  const [loading, setLoading] = useState(true)
  /**
   * 中枢不可用时，「暂无热度数据」和「中枢挂了」看起来一模一样。
   * 榜单页的全部内容就是数据，静默降级等于告诉用户「本站没数据」，
   * 所以这里记下降级原因并给重试入口。
   */
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotice(null)
    const onDegraded = (error: unknown) => {
      if (!cancelled) setNotice(describeDegrade(error, '榜单数据'))
    }
    void Promise.all([fetchTrending(30, onDegraded), fetchNewSites(30, onDegraded)]).then(([t, f]) => {
      if (cancelled) return
      setTrending(t)
      setFresh(f)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const getRankBadge = (index: number) => {
    const rank = index + 1
    if (rank === 1) {
      return (
        <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40 flex items-center justify-center text-xs font-bold font-mono shadow-xs">
          🥇
        </span>
      )
    }
    if (rank === 2) {
      return (
        <span className="w-6 h-6 rounded-full bg-slate-400/20 text-slate-600 dark:text-slate-300 border border-slate-400/40 flex items-center justify-center text-xs font-bold font-mono shadow-xs">
          🥈
        </span>
      )
    }
    if (rank === 3) {
      return (
        <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/40 flex items-center justify-center text-xs font-bold font-mono shadow-xs">
          🥉
        </span>
      )
    }
    return (
      <span className="w-6 h-6 rounded-full bg-muted/60 text-muted-foreground border border-border/40 flex items-center justify-center text-xs font-mono font-medium">
        {rank}
      </span>
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
            <div className="shrink-0 pt-0.5">
              {getRankBadge(i)}
            </div>
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="block min-w-0 flex-1">
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
                  <div className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors truncate pr-8">
                    {site.title}
                  </div>
                  {site.description && (
                    <div className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed mt-1">
                      {site.description}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground font-mono flex-wrap">
                    {typeof site.visitCount === 'number' && site.visitCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                        {site.visitCount} 次热度
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
            </a>
          </div>
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 沉浸式 Hero 展板（对齐插件市场轮的展板语言：market-hero + 光斑 + 水印图标） */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-6 sm:p-8 shadow-xs">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
          <Trophy
            aria-hidden
            strokeWidth={1}
            className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
          />

          <div className="relative z-10 space-y-3">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回主页</span>
              </Link>
              <span className="text-border">/</span>
              <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/5 text-xs">
                实时动态榜单
              </Badge>
            </div>

            <div className="max-w-2xl">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-xs">
                  <Trophy className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <span>全站技术风向标与热度榜</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                基于真实用户检索与点击行为权重自动更新。掌握当下开发者最受追捧的新潮利器与经久不衰的经典基础设施。
              </p>
            </div>

            <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/25 bg-amber-500/5 text-xs text-amber-600 dark:text-amber-400">
                <Flame className="w-3 h-3" />
                热度榜 {loading ? '—' : trending.length} 条
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/5 text-xs text-emerald-600 dark:text-emerald-400">
                <Sparkles className="w-3 h-3" />
                新品 {loading ? '—' : fresh.length} 条
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                <Trophy className="w-3 h-3 text-border" />
                按真实访问热度自动排序
              </span>
            </div>
          </div>
        </div>

        {/* 站内搜索：此前只有首页有搜索入口（⌘K 也只绑在首页），到了榜单页就只能一路点下去 */}
        <SearchPalette placeholder="没找到想要的？直接搜索全部站点（中文 / 拼音 / 语义）" />

        {notice && <HubDegradedNotice notice={notice} onRetry={reload} />}

        {loading ? (
          <div aria-busy="true" aria-live="polite" aria-label="正在加载榜单" className="space-y-4">
            <span className="sr-only">正在计算最新榜单排行…</span>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="h-9 w-56 rounded-xl bg-muted/60 animate-pulse" />
              <div className="h-8 w-8 rounded-lg bg-muted/60 animate-pulse" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3 animate-pulse"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
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
          <Tabs defaultValue="trending" className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <TabsList className="p-1 rounded-xl bg-muted/40 border border-border/50">
                <TabsTrigger value="trending" className="text-xs sm:text-sm gap-1.5 rounded-lg">
                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                  <span>热度飙升榜</span>
                </TabsTrigger>
                <TabsTrigger value="new" className="text-xs sm:text-sm gap-1.5 rounded-lg">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  <span>最新入库榜</span>
                </TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-1.5">
                <DensityToggle className="h-8.5 w-8.5 border border-border/40" />
              </div>
            </div>
            <TabsContent value="trending" className="pt-2">
              {trending.length === 0 ? (
                <EmptyState
                  icon={Flame}
                  iconTone="warning"
                  title={notice ? '本次未能取回热度数据' : '暂无热度数据'}
                  description="热度分由中枢按真实访问行为重算；榜单为空通常意味着重算任务尚未跑过，或服务暂时不可用。"
                  action={
                    <Button asChild size="sm" variant="outline" className="text-xs">
                      <Link href="/">去主页浏览全部站点</Link>
                    </Button>
                  }
                />
              ) : (
                renderList(trending)
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
                    <Button asChild size="sm" variant="outline" className="text-xs">
                      <Link href="/tags">浏览标签云</Link>
                    </Button>
                  }
                />
              ) : (
                renderList(fresh)
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
      <Footer />
    </Container>
  )
}
