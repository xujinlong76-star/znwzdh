'use client'

/**
 * 统一三合一搜索窗内的「找相似网站」面板标签页（SimilarSites.com 级 5 维雷达）。
 *
 * 与顶栏搜索输入框共用同一个输入值，不再在首页另开独立搜索框：
 *   - 180ms 防抖站内候选站点自动补全；
 *   - 最近查过历史胶囊（与 `/similar` 共用 `navhub.similar.history.v1`）+ 8 个热门跨领域试查站；
 *   - 原位呈现环形相似度百分比仪表、差异特色标签、领域快筛、`排除同品牌`、链式「探索路径」；
 *   - 支持一键拉起「大窗深度横评（VS 对比表 + 5 维信号拆解 + Markdown 导出）」或跳转 `/similar?q=...`。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  Loader2,
  Radar,
  Route,
  Scale,
  Search,
  Sparkles,
} from 'lucide-react'
import {
  lookupSimilarSites,
  type HubSimilarSiteMatch,
  type HubSimilarSitesReport,
} from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import { cn } from '@/lib/utils'
import { SiteFavicon } from '@/components/site-favicon'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'
import { detectDiscoveryIntent } from '@/lib/search-discovery-intent'

const RECENT_SIMILAR_HISTORY_KEY = 'navhub.similar.history.v1'
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

export const SIMILAR_QUICK_SEEDS = [
  { label: 'GitHub', q: 'github.com' },
  { label: '豆瓣电影', q: 'douban.com' },
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
    const raw = window.localStorage.getItem(RECENT_SIMILAR_HISTORY_KEY)
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
    window.localStorage.setItem(RECENT_SIMILAR_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)))
  } catch {
    // 隐私模式静默忽略
  }
}

function similarityTone(percent: number): {
  badge: string
  stroke: string
  label: string
} {
  if (percent >= 80) {
    return {
      badge: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      stroke: 'stroke-emerald-500',
      label: '极高相似',
    }
  }
  if (percent >= 60) {
    return {
      badge: 'border-primary/35 bg-primary/10 text-primary',
      stroke: 'stroke-primary',
      label: '高度相关',
    }
  }
  if (percent >= 40) {
    return {
      badge: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
      stroke: 'stroke-sky-500',
      label: '相关延伸',
    }
  }
  return {
    badge: 'border-border bg-muted text-muted-foreground',
    stroke: 'stroke-muted-foreground',
    label: '参考拓展',
  }
}

function MiniSimilarityRing({ percent, strokeClass }: { percent: number; strokeClass: string }) {
  const r = 13
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = c - (clamped / 100) * c
  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
      <svg width="32" height="32" viewBox="0 0 32 32" className="-rotate-90" aria-hidden="true">
        <circle cx="16" cy="16" r={r} fill="none" strokeWidth="2.75" className="stroke-muted" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={cn('transition-all duration-300', strokeClass)}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-bold text-foreground">{clamped}%</span>
    </div>
  )
}

export interface SearchPaletteSimilarTabProps {
  query: string
  onQueryChange: (next: string) => void
  /** 外部（例如按 Enter 或跨模式跳转）触发的查询指令 */
  submitRequest?: { query: string; resetTrail?: boolean; seq: number } | null
  /** 父输入框透传 ↑/↓/Enter 键盘漫游句柄，用于实时站点候选列表键盘选择 */
  keyNavRef?: MutableRefObject<((key: 'ArrowDown' | 'ArrowUp' | 'Enter') => boolean) | null>
  onSwitchToAi: (query: string) => void
  onOpenExpandedDialog?: (query?: string) => void
  onClosePanel: () => void
}

export function SearchPaletteSimilarTab({
  query,
  onQueryChange,
  submitRequest,
  keyNavRef,
  onSwitchToAi,
  onOpenExpandedDialog,
  onClosePanel,
}: SearchPaletteSimilarTabProps) {
  const externalRel = externalLinkRelAttr(useSiteViewModel()?.externalLinkRel)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<HubSimilarSitesReport | null>(null)
  const [activeQuery, setActiveQuery] = useState('')
  const [excludeSameBrand, setExcludeSameBrand] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [trail, setTrail] = useState<TrailNode[]>([])
  const [recentHistory, setRecentHistory] = useState<string[]>([])
  const [acItems, setAcItems] = useState<AutocompleteSite[]>([])
  const [acIndex, setAcIndex] = useState(-1)
  const lastSeqRef = useRef(0)

  useEffect(() => {
    setRecentHistory(readRecentHistory())
  }, [])

  const runLookup = useCallback(
    async (raw: string, resetTrail = false) => {
      const q = raw.trim()
      if (!q) return
      setAcItems([])
      onQueryChange(q)
      setActiveQuery(q)
      setSelectedCategory(null)
      setShowAll(false)
      setLoading(true)
      setError(null)
      if (resetTrail) setTrail([])

      const data = await lookupSimilarSites(q, { limit: 36 }, () => {
        setError('相似站点分析服务暂时不可达，请稍后再试。')
      })

      setLoading(false)
      if (!data) {
        setReport(null)
        return
      }
      setReport(data)

      const label = data.target?.site.title ?? q
      setTrail((prev) => {
        if (resetTrail) return [{ query: q, label }]
        const existIdx = prev.findIndex((n) => n.query.toLowerCase() === q.toLowerCase())
        if (existIdx >= 0) return prev.slice(0, existIdx + 1)
        return [...prev.slice(-4), { query: q, label }]
      })
      setRecentHistory((prev) => {
        const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_HISTORY_ITEMS)
        writeRecentHistory(next)
        return next
      })
    },
    [onQueryChange],
  )

  useEffect(() => {
    if (!submitRequest || submitRequest.seq === lastSeqRef.current) return
    lastSeqRef.current = submitRequest.seq
    void runLookup(submitRequest.query, submitRequest.resetTrail ?? true)
  }, [submitRequest, runLookup])

  // 180ms 防抖实时站点自动补全（仅当输入与已查询词不同时展示候选）
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || q.toLowerCase() === activeQuery.toLowerCase()) {
      setAcItems([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hub/search?q=${encodeURIComponent(q)}&limit=5`, {
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
      } catch {
        // 忽略中止
      }
    }, 180)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query, activeQuery])

  // 键盘 ↑/↓/Enter 漫游实时候选列表
  useEffect(() => {
    if (!keyNavRef) return
    keyNavRef.current = (key) => {
      if (acItems.length === 0) return false
      if (key === 'ArrowDown') {
        setAcIndex((prev) => (prev + 1) % acItems.length)
        return true
      }
      if (key === 'ArrowUp') {
        setAcIndex((prev) => (prev <= 0 ? acItems.length - 1 : prev - 1))
        return true
      }
      if (key === 'Enter' && acIndex >= 0 && acItems[acIndex]) {
        const picked = acItems[acIndex]!
        void runLookup(safeHostname(picked.url) || picked.title, true)
        return true
      }
      return false
    }
    return () => {
      keyNavRef.current = null
    }
  }, [keyNavRef, acItems, acIndex, runLookup])

  const detectedIntent = useMemo(() => detectDiscoveryIntent(query), [query])

  const filteredItems = useMemo<HubSimilarSiteMatch[]>(() => {
    if (!report) return []
    return report.items.filter((item) => {
      if (excludeSameBrand && item.isSameBrand) return false
      if (selectedCategory && item.categoryName !== selectedCategory) return false
      return true
    })
  }, [report, excludeSameBrand, selectedCategory])

  const displayedItems = showAll ? filteredItems.slice(0, 20) : filteredItems.slice(0, 6)

  const categoryChips = useMemo(() => {
    if (!report) return []
    const counts = new Map<string, number>()
    for (const item of report.items) {
      if (excludeSameBrand && item.isSameBrand) continue
      const cat = item.categoryName?.trim()
      if (!cat) continue
      counts.set(cat, (counts.get(cat) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [report, excludeSameBrand])

  const trimmed = query.trim()

  return (
    <div className="p-3 space-y-3">
      {/* 智能需求句提示 */}
      {detectedIntent === 'ai' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs">
          <span className="text-foreground">检测到自然语言任务需求</span>
          <button
            type="button"
            onClick={() => onSwitchToAi(trimmed)}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-95 cursor-pointer"
          >
            <Sparkles className="h-3 w-3" />
            <span>切到「AI 找站」推荐工具</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {/* 输入新词时展示「立即查相似」动作条 + 实时站点候选 */}
      {trimmed && trimmed.toLowerCase() !== activeQuery.toLowerCase() ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-500/8 px-3 py-2">
            <span className="min-w-0 truncate text-xs text-foreground">
              <Radar className="mr-1 inline h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
              分析与「<strong className="font-semibold">{trimmed}</strong>」相似的网站与平替
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => void runLookup(trimmed, true)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              <span>查相似站</span>
            </button>
          </div>

          {acItems.length > 0 ? (
            <div role="listbox" aria-label="匹配站点候选" className="overflow-hidden rounded-xl border border-border/70 bg-card divide-y divide-border/40">
              {acItems.map((item, idx) => {
                const host = safeHostname(item.url)
                const active = idx === acIndex
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setAcIndex(idx)}
                    onClick={() => void runLookup(host || item.title, true)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer',
                      active ? 'bg-primary/10' : 'hover:bg-accent/60',
                    )}
                  >
                    <SiteFavicon
                      url={item.url}
                      icon={item.iconKey ?? undefined}
                      title={item.title}
                      eager
                      className="h-5 w-5 shrink-0 rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{item.title}</span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">{host}</span>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-primary">
                      <span>查相似</span>
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 最近查过 + 热门试查胶囊 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="font-semibold">输入任意网址 / 域名，或点选标杆站秒查平替</span>
          <Link
            href={activeQuery ? `/similar?q=${encodeURIComponent(activeQuery)}` : '/similar'}
            onClick={onClosePanel}
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline shrink-0"
          >
            <span>独立发现中心</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {recentHistory.length > 0 ? (
            <>
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>最近：</span>
              </span>
              {recentHistory.slice(0, 3).map((q) => (
                <button
                  key={`pal-hist-${q}`}
                  type="button"
                  disabled={loading}
                  onClick={() => void runLookup(q, true)}
                  className="inline-flex h-6 items-center rounded-full border border-primary/30 bg-primary/8 px-2 text-[11px] font-medium text-primary hover:bg-primary/15 cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </>
          ) : null}
          {SIMILAR_QUICK_SEEDS.map((seed) => (
            <button
              key={seed.q}
              type="button"
              disabled={loading}
              onClick={() => void runLookup(seed.q, true)}
              className={cn(
                'inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium transition-colors cursor-pointer',
                activeQuery.toLowerCase() === seed.q.toLowerCase()
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/75 bg-card text-foreground hover:border-primary/50 hover:text-primary',
              )}
            >
              {seed.label}
            </button>
          ))}
        </div>
      </div>

      {/* 链式探索路径 */}
      {trail.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
            <Route className="h-3.5 w-3.5 text-primary" />
            <span>探索路径：</span>
          </span>
          {trail.map((node, idx) => {
            const isLast = idx === trail.length - 1
            return (
              <span key={`${node.query}-${idx}`} className="inline-flex items-center gap-1">
                {idx > 0 ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : null}
                {isLast ? (
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                    {node.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void runLookup(node.query, false)}
                    className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    {node.label}
                  </button>
                )}
              </span>
            )
          })}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/15 px-3 py-2 text-xs text-destructive-text">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 animate-pulse">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="h-24 rounded-xl bg-muted/70" />
          ))}
        </div>
      ) : null}

      {/* 相似站原位雷达结果 */}
      {!loading && report ? (
        <div className="space-y-2.5 border-t border-border/60 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {report.target ? (
                <SiteFavicon
                  url={report.target.site.url}
                  icon={report.target.site.iconKey ?? undefined}
                  title={report.target.site.title}
                  eager
                  className="h-5 w-5 shrink-0 rounded-md"
                />
              ) : (
                <Radar className="h-4 w-4 shrink-0 text-primary" />
              )}
              <span className="truncate text-xs sm:text-sm font-bold text-foreground">
                {report.target
                  ? `与「${report.target.site.title}」最相似的网站`
                  : `与「${activeQuery}」相关的相似站点`}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground shrink-0">
                {filteredItems.length} 个
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {(report.summary.sameBrandCount ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => setExcludeSameBrand((v) => !v)}
                  aria-pressed={excludeSameBrand}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium cursor-pointer',
                    excludeSameBrand
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/70 bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Building2 className="h-3 w-3" />
                  <span>排除同品牌</span>
                </button>
              ) : null}
              {onOpenExpandedDialog && report.items.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onOpenExpandedDialog(activeQuery || trimmed)}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-2 text-[11px] font-semibold text-primary hover:bg-primary/20 cursor-pointer"
                >
                  <Scale className="h-3 w-3" />
                  <span>大窗深度横评</span>
                </button>
              ) : null}
            </div>
          </div>

          {categoryChips.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                className={cn(
                  'inline-flex h-6 items-center rounded-full border px-2 font-medium cursor-pointer',
                  selectedCategory === null
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/60 bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                全部领域
              </button>
              {categoryChips.map(([cat, count]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory((cur) => (cur === cat ? null : cat))}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full border px-2 font-medium cursor-pointer',
                    selectedCategory === cat
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  <span>{cat}</span>
                  <span className="font-mono text-[10px]">{count}</span>
                </button>
              ))}
            </div>
          ) : null}

          {displayedItems.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
              暂未命中高相关度相似站，试试常见域名（如 github.com、douban.com）或切到「AI 找站」描述需求。
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {displayedItems.map((item, idx) => {
                  const tone = similarityTone(item.similarityPercent)
                  const host = safeHostname(item.site.url)
                  // 中枢直连分支可能返回形状不全的 item（reasons/sharedTags 缺失），
                  // 与同文件 similar-sites-explorer 保持一致的 ?? [] 兜底。
                  const reasons = item.reasons ?? []
                  const sharedTags = item.sharedTags ?? []
                  const topReason =
                    reasons[0] ||
                    (sharedTags.length > 0 ? `共享标签 ${sharedTags.slice(0, 2).join(' / ')}` : '综合语义相似')
                  return (
                    <div
                      key={item.site.id}
                      className="flex flex-col justify-between gap-1.5 rounded-xl border border-border/70 bg-card p-2.5 transition-all hover:border-primary/45"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <SiteFavicon
                          url={item.site.url}
                          icon={item.site.iconKey ?? undefined}
                          title={item.site.title}
                          eager={idx < 6}
                          className="mt-0.5 h-6 w-6 shrink-0 rounded-md"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[10px] font-bold text-muted-foreground">#{idx + 1}</span>
                            <Link
                              href={`/site/${item.site.id}`}
                              onClick={onClosePanel}
                              className="truncate text-xs sm:text-sm font-semibold text-foreground hover:text-primary"
                            >
                              {item.site.title}
                            </Link>
                          </div>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">{host}</p>
                        </div>
                        <MiniSimilarityRing percent={item.similarityPercent} strokeClass={tone.stroke} />
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
                            tone.badge,
                          )}
                        >
                          {tone.label}
                        </span>
                        {item.categoryName ? (
                          <span className="truncate max-w-[100px] rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {item.categoryName}
                          </span>
                        ) : null}
                        {item.uniqueTags && item.uniqueTags.length > 0 ? (
                          <span className="truncate max-w-[90px] rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                            特色:{item.uniqueTags[0]}
                          </span>
                        ) : null}
                      </div>

                      <p className="line-clamp-1 text-[11px] text-muted-foreground" title={topReason}>
                        {topReason}
                      </p>

                      <div className="flex items-center justify-between gap-1.5 border-t border-border/40 pt-1.5 text-[11px]">
                        <a
                          href={safeHref(item.site.url)}
                          target="_blank"
                          rel={externalRel}
                          onClick={onClosePanel}
                          className="inline-flex items-center gap-0.5 font-medium text-foreground hover:text-primary"
                        >
                          <span>直达</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => void runLookup(host || item.site.title, false)}
                          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20 cursor-pointer"
                          title={`继续探索与「${item.site.title}」相似的网站`}
                        >
                          <Radar className="h-3 w-3" />
                          <span>找相似</span>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {filteredItems.length > 6 ? (
                <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-border/70 bg-card px-3 text-xs font-medium text-foreground hover:border-primary/40 hover:text-primary cursor-pointer"
                  >
                    {showAll ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" />
                        <span>收起到 Top 6</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        <span>展开更多（共 {filteredItems.length} 个）</span>
                      </>
                    )}
                  </button>
                  {onOpenExpandedDialog ? (
                    <button
                      type="button"
                      onClick={() => onOpenExpandedDialog(activeQuery || trimmed)}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer"
                    >
                      <Scale className="h-3.5 w-3.5" />
                      <span>VS 横评 & 5 维信号拆解</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* 桌面端快捷键提示尾栏 */}
      <div className="hidden sm:flex sm:pointer-coarse:hidden items-center gap-2.5 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/70 bg-background px-1 font-mono">↑</kbd>
          <kbd className="rounded border border-border/70 bg-background px-1 font-mono">↓</kbd>
          <span>选候选</span>
        </span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Enter</kbd>
          <span>查相似</span>
        </span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Esc</kbd>
          <span>关闭</span>
        </span>
      </div>
    </div>
  )
}
