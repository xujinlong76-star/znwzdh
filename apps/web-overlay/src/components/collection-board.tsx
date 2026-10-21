'use client'

/**
 * 精选专题列表的客户端岛（hero + 统计 + 合集卡片网格）。
 *
 * 为什么拆：合集卡片的 `/collections/{slug}` 内链必须进 **SSR HTML**。
 * 改版前整页是客户端组件、useEffect 才取数，爬虫首轮看不到任何详情
 * 入链——link-graph 实测 4 个合集详情页 100% 孤岛。现在服务端 page
 * 取数经 props 下发，首帧渲染即 SSR，4 条 `/collections/{slug}` 内链
 * 进入 HTML（与 tags 家族的 Batch B 同构）。
 *
 * 降级语义（诚实遥测，别简化）：「站长正在策划中」与「中枢挂了」
 * 必须分开说——两者都渲染成空列表会让用户误以为站长没做事。
 * initialCollections === null（服务端没取到）时挂载即自动客户端重取一次：
 * 服务端抖动不该逼用户点按钮。
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fetchCollections, type HubCollection } from '@/lib/navhub-api'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { ArrowLeft, Layers, Compass, MapPin, Route, ArrowUpRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

const KIND_META: Record<string, { label: string; icon: typeof Compass }> = {
  topic: { label: '主题', icon: Compass },
  geo: { label: '地域', icon: MapPin },
  roadmap: { label: '路线图', icon: Route },
}

export function CollectionBoard({
  initialCollections,
}: {
  /** 服务端取数结果；null = 服务端没取到，挂载即自动客户端重取 */
  initialCollections: HubCollection[] | null
}) {
  const [cols, setCols] = useState<HubCollection[]>(initialCollections ?? [])
  const [loading, setLoading] = useState(initialCollections === null)
  /** 「站长正在策划中」和「中枢挂了」必须分开说，否则用户会以为站长没做事 */
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

  useEffect(() => {
    // 首帧用服务端数据；只有服务端没取到（null）或用户点重试才客户端取数
    if (reloadToken === 0 && initialCollections !== null) return
    let cancelled = false
    setLoading(true)
    setNotice(null)
    void fetchCollections((error) => {
      if (!cancelled) setNotice(describeDegrade(error, '专题数据'))
    }).then((c: HubCollection[]) => {
      if (cancelled) return
      setCols(c)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [reloadToken, initialCollections])

  const stats = useMemo(() => {
    const counted = cols.filter((c) => typeof c.siteCount === 'number')
    const coveredSites = counted.reduce((sum, c) => sum + (c.siteCount ?? 0), 0)
    const kinds = new Set(cols.map((c) => c.kind)).size
    return { coveredSites, kinds, hasCounts: counted.length > 0 }
  }, [cols])

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-4 sm:p-8 shadow-xs">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
        <Layers
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
            <Badge variant="outline" className="text-violet-500 border-violet-500/30 bg-violet-500/5 text-xs">
              精选策划
            </Badge>
          </div>
          <div className="max-w-2xl">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-violet-500/10 text-violet-500 border border-violet-500/20 shadow-xs">
                <Layers className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span>精选专题</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
              由站长人工策划的主题合集：AI 智能体、AI 编码、前端入门与设计工具四个方向。
            </p>
          </div>
          <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-violet-500/25 bg-violet-500/5 text-xs text-violet-600 dark:text-violet-400">
              <Layers className="w-3 h-3" />
              {loading ? '—' : cols.length} 个专题
            </span>
            {stats.hasCounts ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                <Compass className="w-3 h-3 text-border" />
                覆盖 {loading ? '—' : stats.coveredSites} 个站点
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                <Route className="w-3 h-3 text-border" />
                人工策划 · 持续更新
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3 text-border" />
              {loading ? '—' : stats.kinds} 种专题类型
            </span>
          </div>
        </div>
      </div>

      {notice && <HubDegradedNotice notice={notice} onRetry={reload} />}

      {loading ? (
        <div aria-busy="true" aria-live="polite" aria-label="正在加载精选专题" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <span className="sr-only">正在加载精选专题…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/70 bg-card/50 p-5 space-y-3 animate-pulse">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-muted" />
                <div className="h-5 w-14 rounded-full bg-muted" />
              </div>
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-4/5 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : cols.length === 0 ? (
        <EmptyState
          icon={Layers}
          iconTone="muted"
          title={notice ? '本次未能取回专题列表' : '暂无精选专题，站长正在策划中'}
          description={
            notice
              ? '中枢暂时不可用，专题数据没有取回来；这不代表站长没有策划专题。'
              : '专题由站长人工编排；建好后会出现在这里，也可以先去热度榜或标签云逛逛。'
          }
          action={
            <Button asChild size="sm" variant="outline" className="text-xs">
              <Link href="/">去主页浏览站点</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
          {cols.map((c) => {
            const meta = KIND_META[c.kind] ?? KIND_META.topic!
            const Icon = meta.icon
            return (
              <Link
                key={c.id}
                href={'/collections/' + encodeURIComponent(c.slug)}
                className="group rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 backdrop-blur-xs p-4 sm:p-5 transition-all duration-200 hover:-translate-y-0.5 shadow-2xs flex flex-col"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="p-1.5 rounded-lg bg-violet-500/10 text-violet-500 border border-violet-500/20">
                    <Icon className="w-4 h-4" />
                  </span>
                  <Badge variant="outline" className="text-xs">{meta.label}</Badge>
                </div>
                <div className="text-base font-semibold group-hover:text-primary transition-colors">{c.title}</div>
                {c.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1.5">
                    {c.description}
                  </div>
                )}
                <div className="mt-auto pt-4 border-t border-border/50 flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Layers className="w-3 h-3 text-border" />
                    {typeof c.siteCount === 'number' ? `${c.siteCount} 个站点` : '人工精选'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground group-hover:text-primary transition-colors">
                    查看专题
                    <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
