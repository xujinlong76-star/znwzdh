'use client'

/**
 * 订阅源小卡。
 *
 * 以前这张卡片完全不取数：`config.feedUrl` 读了不用，列表是五条写死在源码里的
 * 假新闻（标题里的版本号永远不会变老），刷新按钮只是把同一批假数据洗牌后盖上
 * 「刚刚更新」。现在走 `/api/rss` 服务端代取（绕开 CORS），取不到就按原因明说；
 * 只有上一次成功抓取还没过期太久时才复用，并标「陈旧」。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Clock, ExternalLink, RefreshCw, Rss, Settings2 } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { safeHref } from '@/lib/safe-url'
import { relativeTime, type ParsedFeedItem } from '@/lib/modular/feed-parse'

interface RssFeedWidgetProps {
  config?: {
    feedUrl?: string
    title?: string
    limit?: number
  }
}

interface FeedPayload {
  feedTitle: string | null
  format: string
  items: ParsedFeedItem[]
  dropped: number
  truncated: boolean
  /** 抓取时刻；响应没带（或带了脏值）就是 null —— 宁显「时间未知」也不补一个假的「刚刚」 */
  fetchedAt: number | null
  cached?: boolean
}

type State =
  | { kind: 'unconfigured' }
  | { kind: 'loading' }
  | { kind: 'ready'; payload: FeedPayload }
  | { kind: 'error'; reason: string; message: string; stale: FeedPayload | null }

/** 只是告诉用户「订阅地址长什么样」，不拿来当内容渲染 */
const EXAMPLE_FEEDS = [
  { label: 'Rust 官方博客', url: 'https://blog.rust-lang.org/feed.xml' },
  { label: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { label: '阮一峰科技周刊', url: 'https://www.ruanyifeng.com/blog/atom.xml' },
]

const REASON_HINT: Record<string, string> = {
  blocked: '地址指向内网或被 SSRF 防护拒绝，换成公网可访问的订阅地址。',
  not_a_feed: '该地址返回的是普通网页而不是 RSS/Atom 源；确认一下 feed 链接。',
  empty_feed: '源里没有可解析的条目（或条目都缺标题）。',
  upstream_status: '订阅源拒绝或找不到，稍后重试或换个源。',
  timeout: '订阅源响应慢，稍后重试。',
  network: '服务器无法连接该站点（可能被墙或站点已下线）。',
  rate_limited: '刷新太频繁，等一分钟再试。',
}

function formatClock(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function RssFeedWidget({ config }: RssFeedWidgetProps) {
  const feedUrl = config?.feedUrl?.trim() ?? ''
  const title = config?.title?.trim() || (feedUrl ? '订阅源' : '技术动态订阅')
  const limit = Math.min(30, Math.max(3, Math.floor(config?.limit ?? 8)))

  const [state, setState] = useState<State>(() => (feedUrl ? { kind: 'loading' } : { kind: 'unconfigured' }))
  const [refreshing, setRefreshing] = useState(false)

  // 用序号拦掉迟到响应：改地址后旧请求不能把新源的条目挂上来
  const requestId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const fetchFeed = useCallback(
    async (fresh: boolean) => {
      if (!feedUrl) {
        setState({ kind: 'unconfigured' })
        return
      }
      const id = ++requestId.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      // 已有内容时不闪回骨架屏，只让按钮转起来；没有内容才显示加载态
      setState((prev) => (prev.kind === 'ready' || prev.kind === 'error' ? prev : { kind: 'loading' }))
      setRefreshing(true)
      try {
        const url = `/api/rss?limit=${limit}&url=${encodeURIComponent(feedUrl)}${fresh ? '&fresh=1' : ''}`
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
        // 响应体不是 JSON 时读不出 reason/message，下面的 error 态会回落成「订阅请求失败」；
        // 关键是不能因为读不出就当成「订阅没有内容」的空态。
        const body = (await res.json().catch(() => {
          return null
        })) as
          | (Partial<FeedPayload> & { ok?: boolean; reason?: string; message?: string; stale?: boolean; staleAt?: number; items?: ParsedFeedItem[] })
          | null
        if (id !== requestId.current) return
        if (body && body.ok && Array.isArray(body.items) && body.items.length) {
          setState({
            kind: 'ready',
            payload: {
              feedTitle: body.feedTitle ?? null,
              format: body.format ?? 'rss',
              items: body.items,
              dropped: Number(body.dropped ?? 0),
              truncated: body.truncated === true,
              fetchedAt: typeof body.fetchedAt === 'number' && Number.isFinite(body.fetchedAt) ? body.fetchedAt : null,
              cached: body.cached === true,
            },
          })
          return
        }
        const staleItems = body && body.stale && Array.isArray(body.items) && body.items.length ? body.items : null
        const stalePayload: FeedPayload | null = staleItems
          ? {
              feedTitle: body?.feedTitle ?? null,
              format: body?.format ?? 'rss',
              items: staleItems,
              dropped: Number(body?.dropped ?? 0),
              truncated: false,
              fetchedAt: typeof body?.staleAt === 'number' && Number.isFinite(body.staleAt) ? body.staleAt : null,
              cached: true,
            }
          : null
        setState({
          kind: 'error',
          reason: body?.reason ?? 'network',
          message: body?.message ?? '订阅请求失败',
          stale: stalePayload,
        })
      } catch (err) {
        if (id !== requestId.current) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState({ kind: 'error', reason: 'network', message: '订阅请求未能发出（网络异常或本地服务不可用）', stale: null })
      } finally {
        if (id === requestId.current) setRefreshing(false)
        if (id === requestId.current && abortRef.current === controller) abortRef.current = null
      }
    },
    [feedUrl, limit],
  )

  useEffect(() => {
    void fetchFeed(false)
    return () => abortRef.current?.abort()
  }, [fetchFeed])

  if (!feedUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Settings2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <p className="text-xs font-medium text-foreground">尚未配置订阅地址</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed max-w-[240px]">
          编辑模式下点这张卡片的齿轮，把 RSS/Atom 地址填进「订阅地址」。
          这里不再放写死的示例新闻——以前那五条假标题会让人以为社区真的在出新版。
        </p>
        <ul className="text-[10px] text-muted-foreground space-y-0.5 mt-1">
          {EXAMPLE_FEEDS.map((f) => (
            <li key={f.url} className="font-mono break-all">
              {f.label}：{f.url}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const ready = state.kind === 'ready' ? state.payload : state.kind === 'error' && state.stale ? state.stale : null
  const isStale = state.kind === 'error' && state.stale !== null
  const isBusy = refreshing || state.kind === 'loading'

  return (
    <div className="flex flex-col h-full justify-between p-3.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
            <Rss className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-foreground truncate max-w-[160px]">{title}</h4>
            <span className="text-[10px] text-muted-foreground font-mono truncate block" title={feedUrl}>
              {ready?.feedTitle ?? feedUrl}
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => void fetchFeed(true)}
          disabled={isBusy}
          title="强制重新抓取订阅源"
          aria-label="强制重新抓取订阅源"
        >
          <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {state.kind === 'error' && !isStale && (
        <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[11px] text-destructive leading-snug">{state.message}</p>
            <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
              {REASON_HINT[state.reason] ?? '可以用齿轮换个地址，或稍后重试。'}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1.5 flex-1 overflow-y-auto pr-1 min-h-0">
        {state.kind === 'loading' && !ready && (
          <div className="space-y-1.5" aria-hidden>
            {Array.from({ length: Math.min(4, limit) }).map((_, i) => (
              <div key={i} className="h-[42px] rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}
        {ready?.items.map((item, index) => {
          const meta = (
            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground min-w-0">
              {item.author && (
                <span className="font-semibold text-amber-600 dark:text-amber-400 truncate max-w-[110px]">{item.author}</span>
              )}
              <span className="flex items-center gap-0.5 shrink-0">
                <Clock className="w-2.5 h-2.5" />
                {relativeTime(item.publishedAt) ?? '无时间标记'}
              </span>
            </div>
          )
          // 链接缺失或非法（服务端已用 safeSrc 过滤）时不渲染成可点跳转，
          // 否则会退化成 safeHref 的兜底值，看起来像「点不开的新闻」
          if (!item.link) {
            return (
              <div key={`${item.title}-${index}`} className="block p-2 rounded-lg bg-muted/30 border border-border/40">
                <span className="text-xs font-medium text-foreground line-clamp-2 leading-snug">{item.title}</span>
                {meta}
              </div>
            )
          }
          return (
            <a
              key={`${item.link}-${index}`}
              href={safeHref(item.link)}
              target="_blank"
              rel="noopener noreferrer"
              className="group block p-2 rounded-lg bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-border transition-all"
            >
              <div className="flex items-start justify-between gap-1.5">
                <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2 leading-snug">
                  {item.title}
                </span>
                <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {meta}
            </a>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
        <span className="truncate">
          {ready
            ? `解析 ${ready.items.length} 条${ready.dropped > 0 ? `（丢弃 ${ready.dropped} 条无标题）` : ''}${
                ready.truncated ? ' · 源内容过长已截断' : ''
              }`
            : '本次没有可显示条目'}
        </span>
        <span className="shrink-0 font-mono">
          {ready
            ? `${isStale ? '陈旧快照' : ready.cached ? '缓存' : '抓取'} ${
                ready.fetchedAt === null ? '时间未知' : formatClock(ready.fetchedAt)
              }`
            : '--:--:--'}
        </span>
      </div>

      {isStale && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
          以上是上一次成功抓取的内容，不是实时状态（{state.kind === 'error' ? state.message : ''}）。
        </p>
      )}
    </div>
  )
}
