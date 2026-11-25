'use client'

/**
 * SimilarSites.com 级「相似网站发现中心」客户端工作台（/similar · 旗舰增强版）。
 *
 * 新增精细体验：
 *   1. 输入框实时自动补全下拉（180ms 防抖检索全库 4,800+ 站点，支持 ↑/↓/Enter/Esc 键盘漫游）；
 *   2. 链式探索路径面包屑（GitHub → Gitee 码云 → GitLab，点击任意历史节点秒级回跳）；
 *   3. 最近查过历史胶囊（localStorage 持久化，一键复查或清空）；
 *   4. URL `?q=` 实时同步与热门跨领域标杆站一键发现。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  Radar,
  Route,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  fetchSimilarSuggestions,
  lookupSimilarSites,
  type HubSimilarSitesReport,
  type HubSimilarSuggestion,
} from '@/lib/navhub-api'
import { SimilarSitesExplorer } from '@/components/similar-sites-explorer'
import { SiteFavicon } from '@/components/site-favicon'
import { Button } from '@/components/ui/button'
import { safeHref } from '@/lib/safe-url'
import { cn } from '@/lib/utils'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'

const RECENT_HISTORY_KEY = 'navhub.similar.history.v1'
const MAX_HISTORY_ITEMS = 8

interface AutocompleteSite {
  id: string
  title: string
  url: string
  iconKey?: string | null
  description?: string | null
}

interface TrailNode {
  query: string
  label: string
}

const QUICK_EXAMPLES = [
  { label: '豆瓣电影', q: 'douban.com' },
  { label: 'GitHub', q: 'github.com' },
  { label: 'Figma', q: 'figma.com' },
  { label: 'Notion', q: 'notion.so' },
  { label: 'DeepSeek', q: 'deepseek.com' },
  { label: 'Bilibili', q: 'bilibili.com' },
  { label: 'Vercel', q: 'vercel.com' },
  { label: '免费图床', q: '免费图床' },
]

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function readRecentHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, MAX_HISTORY_ITEMS)
      : []
  } catch {
    return []
  }
}

function writeRecentHistory(items: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)))
  } catch {
    // 隐私模式静默忽略
  }
}

export function SimilarHubClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const externalRel = externalLinkRelAttr(useSiteViewModel()?.externalLinkRel)

  const urlQuery = (searchParams.get('q') ?? '').trim()
  const [inputValue, setInputValue] = useState(urlQuery)
  const [activeQuery, setActiveQuery] = useState(urlQuery)
  const [report, setReport] = useState<HubSimilarSitesReport | null>(null)
  const [loading, setLoading] = useState(Boolean(urlQuery))
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<HubSimilarSuggestion[]>([])
  const [totalActiveSites, setTotalActiveSites] = useState<number>(0)

  // 实时联想下拉
  const [acItems, setAcItems] = useState<AutocompleteSite[]>([])
  const [acOpen, setAcOpen] = useState(false)
  const [acIndex, setAcIndex] = useState(-1)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)

  // 探索路径面包屑 + 最近查询历史
  const [trail, setTrail] = useState<TrailNode[]>([])
  const [recentHistory, setRecentHistory] = useState<string[]>([])

  useEffect(() => {
    setRecentHistory(readRecentHistory())
  }, [])

  useEffect(() => {
    setInputValue(urlQuery)
    setActiveQuery(urlQuery)
  }, [urlQuery])

  // 点击外部收起联想框
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setAcOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  // 180ms 防抖实时自动补全（复用全站 /api/hub/search 拼音+全文检索引擎）
  useEffect(() => {
    const q = inputValue.trim()
    if (q.length < 2 || q === activeQuery) {
      setAcItems([])
      setAcIndex(-1)
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hub/search?q=${encodeURIComponent(q)}&limit=6`, {
          headers: { accept: 'application/json' },
          signal: ctrl.signal,
        })
        if (!res.ok) return
        const data = (await res.json()) as { hits?: Array<{ site?: AutocompleteSite | null }> }
        const hits = (data.hits ?? [])
          .map((h) => h.site)
          .filter((s): s is AutocompleteSite => Boolean(s && s.id && s.title && s.url))
        setAcItems(hits)
        setAcIndex(-1)
        setAcOpen(hits.length > 0)
      } catch {
        // 忽略中止或网络抖动
      }
    }, 180)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [inputValue, activeQuery])

  // 加载精选种子站
  useEffect(() => {
    let cancelled = false
    void fetchSimilarSuggestions(12).then((res) => {
      if (cancelled) return
      setSuggestions(res.items)
      setTotalActiveSites(res.totalActiveSites)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 执行相似站检索 + 更新探索路径与历史
  useEffect(() => {
    if (!activeQuery) {
      setReport(null)
      setLoading(false)
      setErrorMsg(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setErrorMsg(null)
    void lookupSimilarSites(activeQuery, { limit: 48 }, () => {
      if (!cancelled) setErrorMsg('相似站点分析服务暂时不可达，请稍后重试。')
    }).then((data) => {
      if (cancelled) return
      setReport(data)
      setLoading(false)

      const label = data?.target?.site.title ?? activeQuery
      setTrail((prev) => {
        const existIdx = prev.findIndex((n) => n.query.toLowerCase() === activeQuery.toLowerCase())
        if (existIdx >= 0) return prev.slice(0, existIdx + 1)
        return [...prev.slice(-5), { query: activeQuery, label }]
      })
      setRecentHistory((prev) => {
        const next = [activeQuery, ...prev.filter((x) => x.toLowerCase() !== activeQuery.toLowerCase())].slice(
          0,
          MAX_HISTORY_ITEMS,
        )
        writeRecentHistory(next)
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [activeQuery])

  const runLookup = useCallback(
    (raw: string, resetTrail = false) => {
      const next = raw.trim()
      setAcOpen(false)
      setAcItems([])
      setInputValue(next)
      setActiveQuery(next)
      if (resetTrail) setTrail([])
      if (next) {
        router.replace(`/similar?q=${encodeURIComponent(next)}`, { scroll: false })
      } else {
        router.replace('/similar', { scroll: false })
      }
    },
    [router],
  )

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (acOpen && acIndex >= 0 && acItems[acIndex]) {
      const picked = acItems[acIndex]!
      runLookup(safeHostname(picked.url) || picked.title, true)
      return
    }
    runLookup(inputValue, true)
  }

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!acOpen || acItems.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAcIndex((prev) => (prev + 1) % acItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAcIndex((prev) => (prev <= 0 ? acItems.length - 1 : prev - 1))
    } else if (e.key === 'Escape') {
      setAcOpen(false)
      setAcIndex(-1)
    }
  }

  const clearHistory = () => {
    setRecentHistory([])
    writeRecentHistory([])
  }

  return (
    <div className="space-y-7">
      {/* SimilarSites 风格居中 Hero 搜索展板 */}
      <section
        aria-label="相似网站智能检索"
        className="relative rounded-3xl border border-border/70 bg-gradient-to-br from-primary/8 via-card to-sky-500/5 p-6 sm:p-10 shadow-xs"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -left-20 -bottom-20 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-2xl text-center space-y-5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Radar className="h-3.5 w-3.5" aria-hidden />
            <span>
              SimilarSites 级发现引擎 · 覆盖全库{' '}
              {totalActiveSites > 0 ? totalActiveSites.toLocaleString('zh-CN') : '4,800+'} 个精选网站
            </span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            一键发现任意网站的相似站点与平替
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            输入任意网址、域名、网站名称或主题词，融合标签特异性、语义内容、分类树亲缘、产品属性与图谱受众 5 大维度，秒级给出透明度可拆解的相似排行榜。
          </p>

          <div ref={searchBoxRef} className="relative mx-auto max-w-xl text-left">
            <form onSubmit={handleSubmit}>
              <div className="flex items-center gap-2 rounded-2xl border border-border-strong bg-background/95 p-1.5 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <Search className="ml-2.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  type="text"
                  value={inputValue}
                  onFocus={() => acItems.length > 0 && setAcOpen(true)}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="输入网址、域名或站名，如 douban.com、github.com、豆瓣…"
                  aria-label="输入网址、域名或站点名称查找相似网站"
                  aria-expanded={acOpen && acItems.length > 0}
                  aria-autocomplete="list"
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {inputValue && (
                  <button
                    type="button"
                    onClick={() => runLookup('', true)}
                    aria-label="清空输入"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={loading || !inputValue.trim()}
                  className="h-10 rounded-xl px-4 text-xs sm:text-sm font-semibold gap-1.5 cursor-pointer shrink-0"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>分析中</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>找相似站</span>
                    </>
                  )}
                </Button>
              </div>
            </form>

            {/* 实时站内自动补全联想下拉 */}
            {acOpen && acItems.length > 0 && (
              <ul
                role="listbox"
                data-testid="similar-autocomplete-list"
                className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-2xl border border-border/80 bg-popover p-1.5 shadow-xl backdrop-blur-md"
              >
                {acItems.map((site, idx) => {
                  const host = safeHostname(site.url)
                  const highlighted = idx === acIndex
                  return (
                    <li key={site.id} role="option" aria-selected={highlighted}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          runLookup(host || site.title, true)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer',
                          highlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70',
                        )}
                      >
                        <div className="h-7 w-7 shrink-0 rounded-lg border border-border/60 bg-muted/50 p-1 flex items-center justify-center overflow-hidden">
                          <SiteFavicon
                            title={site.title}
                            url={site.url}
                            icon={site.iconKey ?? undefined}
                            className="h-full w-full object-contain rounded"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-foreground">{site.title}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{host}</span>
                          </div>
                          {site.description && (
                            <p className="truncate text-[11px] text-muted-foreground">{site.description}</p>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* 一键热门示例 */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1 text-xs">
            <span className="text-muted-foreground mr-1">试试搜索：</span>
            {QUICK_EXAMPLES.map((ex) => (
              <button
                key={ex.q}
                type="button"
                onClick={() => runLookup(ex.q, true)}
                className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/50 hover:bg-primary/8 hover:text-primary transition-colors cursor-pointer"
              >
                {ex.label}
              </button>
            ))}
          </div>

          {/* 最近查询历史 */}
          {recentHistory.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" aria-hidden />
              <span>最近查过：</span>
              {recentHistory.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => runLookup(h, true)}
                  className="rounded-md border border-border/60 bg-background/60 px-2 py-0.5 font-mono text-[11px] text-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer"
                >
                  {h}
                </button>
              ))}
              <button
                type="button"
                onClick={clearHistory}
                aria-label="清空最近查询历史"
                title="清空最近查询历史"
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive-text cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                <span>清空</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 链式探索路径面包屑（当用户连续点击「找相似」时显示完整回溯路径） */}
      {trail.length > 1 && (
        <nav
          aria-label="相似站点探索路径"
          data-testid="similar-exploration-trail"
          className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-3.5 py-2 text-xs"
        >
          <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground mr-1">
            <Route className="h-3.5 w-3.5 text-primary" aria-hidden />
            <span>探索路径</span>
          </span>
          {trail.map((node, idx) => {
            const isLast = idx === trail.length - 1
            return (
              <span key={`${node.query}-${idx}`} className="inline-flex items-center gap-1.5">
                {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                {isLast ? (
                  <span className="rounded-md bg-primary/12 px-2 py-0.5 font-semibold text-primary">
                    {node.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => runLookup(node.query, false)}
                    className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    {node.label}
                  </button>
                )}
              </span>
            )
          })}
        </nav>
      )}

      {errorMsg && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/15 px-4 py-3 text-xs text-destructive-text">
          {errorMsg}
        </div>
      )}

      {/* 命中目标站概览卡片 */}
      {report?.target && (
        <section
          aria-label="当前分析目标站点"
          className="rounded-2xl border border-primary/25 bg-card/85 p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-2xs"
        >
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="h-12 w-12 shrink-0 rounded-xl border border-border/60 bg-muted/50 p-1.5 flex items-center justify-center overflow-hidden">
              <SiteFavicon
                title={report.target.site.title}
                url={report.target.site.url}
                icon={report.target.site.iconKey ?? undefined}
                eager
                className="h-full w-full object-contain rounded"
              />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                  正在分析目标站点
                </span>
                {report.target.categoryName && (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {report.target.parentCategoryName
                      ? `${report.target.parentCategoryName} · ${report.target.categoryName}`
                      : report.target.categoryName}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/site/${encodeURIComponent(report.target.site.id)}`}
                  className="text-base font-bold text-foreground hover:text-primary hover:underline truncate"
                >
                  {report.target.site.title}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">
                  {safeHostname(report.target.site.url)}
                </span>
              </div>
              {report.target.site.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {report.target.site.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1">
              <Link href={`/site/${encodeURIComponent(report.target.site.id)}`}>
                <span>查看完整档案</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild size="sm" className="h-8 text-xs gap-1">
              <a href={safeHref(report.target.site.url)} target="_blank" rel={externalRel}>
                <span>直达官网</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </section>
      )}

      {/* 核心结果工作台 */}
      {activeQuery ? (
        <SimilarSitesExplorer
          mode="hub"
          report={report}
          loading={loading}
          onExploreSite={(q) => runLookup(q, false)}
        />
      ) : (
        /* 空查询态：跨领域精选热门站点网格，点击即查相似站 */
        <section aria-labelledby="similar-seeds-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 id="similar-seeds-heading" className="text-base sm:text-lg font-bold text-foreground">
                热门网站相似发现入口
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                点选任意标杆站点，立即查看它的高分平替、跨类目延伸、生态分布与即时横评对比
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((item) => {
              const host = safeHostname(item.url)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => runLookup(host || item.title, true)}
                  className="group flex items-start gap-3 rounded-xl border border-border/70 bg-card/75 p-4 text-left transition-all hover:border-primary/45 hover:shadow-sm cursor-pointer"
                >
                  <div className="h-10 w-10 shrink-0 rounded-xl border border-border/60 bg-muted/50 p-1.5 flex items-center justify-center overflow-hidden">
                    <SiteFavicon
                      title={item.title}
                      url={item.url}
                      icon={item.iconKey ?? undefined}
                      className="h-full w-full object-contain rounded"
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                        {item.title}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary shrink-0">
                        <span>查相似</span>
                        <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                      <span className="inline-flex items-center gap-1 truncate">
                        <Globe className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{host}</span>
                      </span>
                      {item.categoryName && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-sans text-[10px]">
                          {item.categoryName}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
