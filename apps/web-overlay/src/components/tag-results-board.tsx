'use client'

/**
 * 标签结果页客户端岛（hero + 搜索 + 站点卡片网格）。
 *
 * 为什么拆：站点卡片标题的 `/site/{id}` 内链必须进 **SSR HTML**。改版前整页
 * 客户端 useEffect 取数，爬虫首轮看到的是骨架屏——「点了内链也不被抓」。
 * 现在服务端 page 取数经 props 下发，首帧渲染即 SSR，每个标签页 50-100 条
 * 站点内链进入 HTML。
 *
 * 降级语义：degraded=true（服务端没取到）时展示 HubDegradedNotice + 重试；
 * 重试走客户端 searchSites（带 identity 个性化），成功后整块替换。
 * identity 只用于客户端重取；首帧服务端数据不带 identity（公开检索，
 * 个性化是增强不是前提）。
 */

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { FavoriteButton } from '@/components/favorite-button'
import { Button } from '@/components/ui/button'
import { Tag, Hash, LayoutGrid } from 'lucide-react'
import { searchSites, type HubSite } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { SearchPalette } from '@/components/search-palette'
import { SiteFavicon } from '@/components/site-favicon'
import { EmptyState } from '@/components/ui/empty-state'

export function TagResultsBoard({
  slug,
  initialSites,
  degraded: initialDegraded,
  tagDescription,
}: {
  slug: string
  initialSites: HubSite[]
  degraded: boolean
  /** 标签自身描述（≥5 站标签已由 scripts/tag-descriptions.mjs 回填）；null 时 hero 用通用文案 */
  tagDescription?: string | null
}) {
  const [sites, setSites] = useState<HubSite[]>(initialSites)
  const [loading, setLoading] = useState(false)
  const [degraded, setDegraded] = useState(initialDegraded)
  const identity = useMemo(() => getIdentity(), [])
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

  useEffect(() => {
    // 首帧用服务端数据；只有用户点重试（reloadToken>0）才客户端重取
    if (reloadToken === 0) return
    let cancelled = false
    setLoading(true)
    void searchSites({ q: '', tag: slug, limit: 100, status: 'active', identity }).then((res) => {
      if (cancelled) return
      // 与 SSR 的 loadTagPage 同口径：只保留 active，别让重试把 broken/pending 放上页面
      setSites(
        res.hits
          .map((h) => h.site)
          .filter((s): s is HubSite => s !== null && s.status === 'active'),
      )
      setDegraded(Boolean(res.degraded))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [slug, identity, reloadToken])

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* 顶部标题展板（对齐市场轮展板语言） */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-4 sm:p-7 shadow-xs">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
        <Tag
          aria-hidden
          strokeWidth={1}
          className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
        />
        <div className="relative z-10 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex flex-wrap items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 shadow-xs">
                  <Tag className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <span>「{slug}」相关站点</span>
                <span className="text-xs font-mono font-normal text-muted-foreground px-2.5 py-0.5 rounded-full bg-muted border border-border/60">
                  共 {sites.length} 个站点
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                {tagDescription ??
                  `基于中枢多通道检索与向量图谱，为您汇总所有归属于「${slug}」分类的优质技术资产与工具。`}
              </p>
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-indigo-500/25 bg-indigo-500/5 text-xs text-indigo-600 dark:text-indigo-400">
              <Hash className="w-3 h-3" />
              #{slug}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
              <Tag className="w-3 h-3 text-border" />
              {sites.length} 个站点收录
            </span>
            {/* 枢纽互链：标签页也是「随便逛逛」的入口，与 SearchPalette 的
                「不限于本标签」互补（一个回目录、一个去搜索） */}
            <Link
              href="/sites"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-xs text-primary hover:bg-primary/10 transition-colors"
            >
              <LayoutGrid className="w-3 h-3" />
              全部站点目录
            </Link>
          </div>
        </div>
      </div>

      {/* 站内搜索：标签页只能看这一类站点，想找别的就得回首页 —— 这里直接给出口 */}
      <SearchPalette placeholder="不限于本标签：搜索全部站点（中文 / 拼音 / 语义）" />

      {degraded && (
        <HubDegradedNotice
          notice={{ message: '检索服务暂时不可用，已切到本地离线降级索引。', retryable: true }}
          onRetry={reload}
          subject="标签检索"
        />
      )}

      {loading ? (
        <div aria-busy="true" aria-live="polite" aria-label="正在加载标签站点" className="space-y-4">
          <span className="sr-only">正在检索并对齐标签关联站点...</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! gap-3.5 sm:gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3 animate-pulse"
              >
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-muted shrink-0" />
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
      ) : sites.length === 0 ? (
        <EmptyState
          icon={Tag}
          iconTone="muted"
          title="该标签下暂无收录站点"
          description="标签是人工与检索共同对齐的结果；这个标签暂时没有匹配到站点，可以换个标签或直接搜索。"
          action={
            <Button asChild variant="outline" size="sm" className="text-xs">
              <Link href="/tags">浏览其他标签</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! gap-3.5 sm:gap-4">
          {sites.map((site) => (
            /* 卡片双模式：整卡拉伸外链（z-0）+ 标题站内内链（z-10）+
               收藏按钮（z-20）三者是**兄弟节点**，绝不嵌套——
               `<a>` 里嵌 `<Link>` 是非法 HTML，浏览器会自动闭合外层
               <a>，整卡点击当场坏掉（navigation-card 的教训）。
               行为：点空白/描述 = 直达官网（与改版前一致）；
               点标题 = 进 /site/{id} 详情；收藏按钮位置与可见性不变。 */
            <div
              key={site.id}
              className="relative group rounded-xl border border-border/70 glass-surface subtle-mesh p-4 transition-all duration-200 hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5 flex flex-col justify-between"
            >
              <a
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`访问 ${site.title} 官网（新窗口打开）`}
                className="absolute inset-0 z-0 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <div className="relative z-10 pointer-events-none flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-muted/60 border border-border/50 p-1 flex items-center justify-center overflow-hidden">
                  <SiteFavicon
                    title={site.title}
                    url={site.url}
                    icon={site.iconKey ?? undefined}
                    className="w-full h-full object-contain rounded"
                  />
                </div>
                <div className="min-w-0 flex-1 pr-6">
                  <Link
                    href={`/site/${encodeURIComponent(site.id)}`}
                    className="pointer-events-auto block text-sm font-semibold truncate hover:text-primary hover:underline underline-offset-4 transition-colors"
                  >
                    {site.title}
                  </Link>
                  {site.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">{site.description}</p>
                  )}
                </div>
              </div>
              <div className="absolute top-3 right-3 z-20 opacity-80 sm:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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
    </div>
  )
}
