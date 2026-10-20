'use client'

/**
 * 精选专题详情页：专题介绍 + 站点列表。
 * 数据来自中枢 GET /api/collections/:slug。
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { FavoriteButton } from '@/components/favorite-button'
import { Footer } from '@/components/footer'
import { fetchCollectionDetail, type HubCollection, type HubSite } from '@/lib/navhub-api'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { SearchPalette } from '@/components/search-palette'
import { ArrowLeft, Layers, ExternalLink, Boxes } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SiteFavicon } from '@/components/site-favicon'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

export default function CollectionDetailPage() {
  const params = useParams()
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params.slug[0] : ''
  const [collection, setCollection] = useState<HubCollection | null>(null)
  const [sites, setSites] = useState<HubSite[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  /**
   * 区分「专题确实下架」（404）与「中枢挂了」（5xx / 网络失败）。
   * 以前两者都渲染成「专题不存在或已下架」，一次机房抖动就让用户以为专题没了。
   */
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    let failed = false
    setLoading(true)
    setMissing(false)
    setNotice(null)
    void fetchCollectionDetail(slug, (error) => {
      failed = true
      if (!cancelled) setNotice(describeDegrade(error, '专题数据'))
    }).then((d: { collection: HubCollection; sites: HubSite[] } | null) => {
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
  }, [slug, reloadToken])

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        <div className="flex items-center gap-2">
          <Link
            href="/collections"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>全部专题</span>
          </Link>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border/70 bg-card/50 p-3.5 space-y-3 animate-pulse">
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
            <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-6 sm:p-8 shadow-xs">
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
                    <Layers className="w-3 h-3 mr-1" />
                    精选专题
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
            ) : (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 transition-all duration-200"
                style={{ gap: 'var(--density-grid-gap, 1rem)' }}
              >
                {sites.map((site) => (
                  <div
                    key={site.id}
                    className="relative group rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 backdrop-blur-xs transition-all duration-200 hover:-translate-y-0.5 p-[var(--density-card-padding,0.875rem)] flex flex-col justify-between shadow-2xs"
                  >
                    <a href={site.url} target="_blank" rel="noopener noreferrer" className="block min-w-0 flex-1">
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
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noopener noreferrer"
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
      <Footer />
    </Container>
  )
}
