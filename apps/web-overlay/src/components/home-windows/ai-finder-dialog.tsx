'use client'

/**
 * 「AI 智能找站 × 找相似网站」融合搜索工作台弹窗：
 *   - 首页内联融合条点击「大窗 / 深度横评」或顶栏「AI 找站 · 找相似」按钮时呼出；
 *   - 支持「AI 找站（自然语言 + 24 场景包）」与「找相似网站（SimilarSites 级 5 维雷达 + VS 横评 + Markdown 导出）」
 *     在同一窗口无痛切换与双向联动（AI 推荐卡片一键跳到找相似平替）。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
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
  X,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { AiFinderPanel } from '@/components/ai/ai-finder-panel'
import { SimilarSitesExplorer } from '@/components/similar-sites-explorer'
import { SiteFavicon } from '@/components/site-favicon'
import { lookupSimilarSites, type HubSimilarSitesReport } from '@/lib/navhub-api'
import { handleTabListKeyDown } from '@/lib/tab-keyboard'
import { cn } from '@/lib/utils'

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

const DIALOG_SIMILAR_SEEDS = [
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

export interface AiFinderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sceneTrigger?: string | null
  defaultMode?: 'ai' | 'similar'
  initialQuery?: string
}

export function AiFinderDialog({
  open,
  onOpenChange,
  sceneTrigger,
  defaultMode = 'ai',
  initialQuery = '',
}: AiFinderDialogProps) {
  const [activeTab, setActiveTab] = useState<'ai' | 'similar'>(defaultMode)
  const [aiInitialQuery, setAiInitialQuery] = useState(defaultMode === 'ai' ? initialQuery : '')
  const [aiPanelSeed, setAiPanelSeed] = useState(0)

  // 找相似内部状态
  const [similarInput, setSimilarInput] = useState(defaultMode === 'similar' ? initialQuery : '')
  const [similarActiveQuery, setSimilarActiveQuery] = useState('')
  const [similarReport, setSimilarReport] = useState<HubSimilarSitesReport | null>(null)
  const [similarLoading, setSimilarLoading] = useState(false)
  const [similarError, setSimilarError] = useState<string | null>(null)
  const [trail, setTrail] = useState<TrailNode[]>([])
  const [recentHistory, setRecentHistory] = useState<string[]>([])

  // 找相似 180ms 实时联想
  const [acItems, setAcItems] = useState<AutocompleteSite[]>([])
  const [acOpen, setAcOpen] = useState(false)
  const [acIndex, setAcIndex] = useState(-1)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)
  const similarInputRef = useRef<HTMLInputElement | null>(null)

  const runSimilarLookup = useCallback(async (raw: string, resetTrail = false) => {
    const q = raw.trim()
    if (!q) return
    setAcOpen(false)
    setAcItems([])
    setSimilarInput(q)
    setSimilarActiveQuery(q)
    setSimilarLoading(true)
    setSimilarError(null)
    if (resetTrail) setTrail([])

    const data = await lookupSimilarSites(q, { limit: 48 }, () => {
      setSimilarError('相似站点分析服务暂时不可达，请稍后再试。')
    })

    setSimilarLoading(false)
    if (!data) {
      setSimilarReport(null)
      return
    }
    setSimilarReport(data)

    const label = data.target?.site.title ?? q
    setTrail((prev) => {
      if (resetTrail) return [{ query: q, label }]
      const existIdx = prev.findIndex((n) => n.query.toLowerCase() === q.toLowerCase())
      if (existIdx >= 0) return prev.slice(0, existIdx + 1)
      return [...prev.slice(-5), { query: q, label }]
    })
    setRecentHistory((prev) => {
      const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_HISTORY_ITEMS)
      writeRecentHistory(next)
      return next
    })
  }, [])

  // 打开弹窗时按外部参数同步初始模式和查询词
  useEffect(() => {
    if (!open) return
    setRecentHistory(readRecentHistory())
    const nextMode: 'ai' | 'similar' = sceneTrigger ? 'ai' : defaultMode
    setActiveTab(nextMode)
    const trimmed = initialQuery.trim()
    if (nextMode === 'similar' && trimmed) {
      void runSimilarLookup(trimmed, true)
    } else if (nextMode === 'ai') {
      setAiInitialQuery(trimmed)
      setAiPanelSeed((n) => n + 1)
    }
  }, [open, defaultMode, initialQuery, sceneTrigger, runSimilarLookup])

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

  // 180ms 实时站点联想
  useEffect(() => {
    if (!open || activeTab !== 'similar') {
      setAcItems([])
      setAcOpen(false)
      return
    }
    const q = similarInput.trim()
    if (q.length < 2 || q === similarActiveQuery) {
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
        // 忽略中止
      }
    }, 180)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [open, activeTab, similarInput, similarActiveQuery])

  const handlePivotToSimilar = useCallback(
    (q: string) => {
      setActiveTab('similar')
      void runSimilarLookup(q, true)
    },
    [runSimilarLookup],
  )

  const handleSimilarSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (acOpen && acIndex >= 0 && acItems[acIndex]) {
      const picked = acItems[acIndex]!
      void runSimilarLookup(safeHostname(picked.url) || picked.title, true)
      return
    }
    void runSimilarLookup(similarInput, true)
  }

  const handleSimilarKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!acOpen || acItems.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAcIndex((prev) => (prev + 1) % acItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAcIndex((prev) => (prev <= 0 ? acItems.length - 1 : prev - 1))
    } else if (e.key === 'Escape') {
      setAcOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-[calc(100vw-1.5rem)] max-h-[86vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden transition-[max-width]',
          activeTab === 'similar' ? 'max-w-[920px]' : 'max-w-[700px]',
        )}
      >
        <DialogHeader className="shrink-0 pr-6 text-left space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              {activeTab === 'ai' ? (
                <Sparkles className="h-4 w-4 text-primary" />
              ) : (
                <Radar className="h-4 w-4 text-primary" />
              )}
              <span>AI 找站 × 找相似工作台</span>
            </DialogTitle>

            {/* U-434：双模式融合切换 tablist——←/→ 漫游见 @/lib/tab-keyboard。 */}
            <div
              role="tablist"
              aria-label="融合工作台模式切换"
              onKeyDown={handleTabListKeyDown}
              className="inline-flex items-center rounded-xl border border-border/70 bg-muted/50 p-0.5"
            >
              <button
                type="button"
                role="tab"
                id="ai-finder-tab-ai"
                aria-selected={activeTab === 'ai'}
                aria-controls="ai-finder-panel-ai"
                tabIndex={activeTab === 'ai' ? 0 : -1}
                onClick={() => setActiveTab('ai')}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-all cursor-pointer',
                  activeTab === 'ai'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>AI 找站</span>
              </button>
              <button
                type="button"
                role="tab"
                id="ai-finder-tab-similar"
                aria-selected={activeTab === 'similar'}
                aria-controls="ai-finder-panel-similar"
                tabIndex={activeTab === 'similar' ? 0 : -1}
                onClick={() => setActiveTab('similar')}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-all cursor-pointer',
                  activeTab === 'similar'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Radar className="h-3.5 w-3.5" />
                <span>找相似网站</span>
              </button>
            </div>

            <Link
              href={
                activeTab === 'ai'
                  ? '/scenes'
                  : similarActiveQuery
                    ? `/similar?q=${encodeURIComponent(similarActiveQuery)}`
                    : '/similar'
              }
              className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <span>{activeTab === 'ai' ? '全部场景' : '独立完整页'}</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {activeTab === 'ai'
              ? '描述你想完成的任务或选择场景，即刻匹配本站工具；每张推荐站都可一键切到「找相似」查平替。'
              : '输入任意网址、域名或站名，即刻生成 5 维相似度雷达报告，支持排除同品牌、VS 即时横评与导出 Markdown。'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {activeTab === 'ai' ? (
            <div role="tabpanel" id="ai-finder-panel-ai" aria-labelledby="ai-finder-tab-ai" className="[&>section]:mb-0 [&>section]:border-0 [&>section]:p-1 [&>section]:shadow-none [&>section]:bg-transparent">
              <AiFinderPanel
                key={`${sceneTrigger || 'default'}-${aiPanelSeed}`}
                initialQuery={aiInitialQuery}
                onFindSimilar={handlePivotToSimilar}
              />
            </div>
          ) : (
            <div role="tabpanel" id="ai-finder-panel-similar" aria-labelledby="ai-finder-tab-similar" className="space-y-3.5 p-0.5">
              {/* 找相似搜索条 + 180ms 自动补全 */}
              <div ref={searchBoxRef} className="relative">
                <form onSubmit={handleSimilarSubmit} className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border-strong bg-background pl-3 pr-1.5 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
                    <Globe className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <input
                      ref={similarInputRef}
                      type="text"
                      value={similarInput}
                      onChange={(e) => setSimilarInput(e.target.value)}
                      onFocus={() => {
                        if (acItems.length > 0) setAcOpen(true)
                      }}
                      onKeyDown={handleSimilarKeyDown}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="输入任意网址、域名或站名，如：github.com、douban.com、figma.com…"
                      aria-label="输入目标网址或站名查找相似网站"
                      className="h-10 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                    {similarInput ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSimilarInput('')
                          setAcItems([])
                          setAcOpen(false)
                          similarInputRef.current?.focus()
                        }}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                        aria-label="清空输入"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="submit"
                    disabled={similarLoading || !similarInput.trim()}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    {similarLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    <span>查相似站</span>
                  </button>
                </form>

                {acOpen && acItems.length > 0 ? (
                  <div
                    role="listbox"
                    aria-label="相似站点搜索候选"
                    className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-border-strong bg-popover shadow-xl"
                  >
                    <ul className="divide-y divide-border/40 py-0.5">
                      {acItems.map((item, idx) => {
                        const host = safeHostname(item.url)
                        const active = idx === acIndex
                        return (
                          <li key={item.id} role="option" aria-selected={active}>
                            <button
                              type="button"
                              onMouseEnter={() => setAcIndex(idx)}
                              onClick={() => void runSimilarLookup(host || item.title, true)}
                              className={cn(
                                'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer',
                                active ? 'bg-primary/10' : 'hover:bg-accent/60',
                              )}
                            >
                              <SiteFavicon
                                url={item.url}
                                icon={item.iconKey ?? undefined}
                                title={item.title}
                                className="h-5 w-5 shrink-0 rounded-md"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-semibold text-foreground">{item.title}</span>
                                  <span className="truncate font-mono text-[11px] text-muted-foreground">{host}</span>
                                </div>
                              </div>
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>

              {/* 最近历史 + 热门试查 */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {recentHistory.length > 0 ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-muted-foreground font-medium">
                      <Clock className="h-3 w-3" />
                      <span>最近：</span>
                    </span>
                    {recentHistory.slice(0, 4).map((q) => (
                      <button
                        key={`dlg-hist-${q}`}
                        type="button"
                        onClick={() => void runSimilarLookup(q, true)}
                        className="inline-flex h-7 items-center rounded-full border border-primary/30 bg-primary/8 px-2.5 font-medium text-primary hover:bg-primary/15 cursor-pointer"
                      >
                        {q}
                      </button>
                    ))}
                  </>
                ) : null}
                <span className="text-muted-foreground font-medium">热门：</span>
                {DIALOG_SIMILAR_SEEDS.map((seed) => (
                  <button
                    key={seed.q}
                    type="button"
                    onClick={() => void runSimilarLookup(seed.q, true)}
                    className={cn(
                      'inline-flex h-7 items-center rounded-full border px-2.5 font-medium transition-colors cursor-pointer',
                      similarActiveQuery.toLowerCase() === seed.q.toLowerCase()
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border/70 bg-card text-foreground hover:border-primary/50 hover:text-primary',
                    )}
                  >
                    {seed.label}
                  </button>
                ))}
              </div>

              {/* 探索路径 */}
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
                            onClick={() => void runSimilarLookup(node.query, false)}
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

              {similarError ? (
                <p role="alert" className="rounded-xl bg-destructive/15 px-3 py-2 text-sm text-destructive-text">
                  {similarError}
                </p>
              ) : null}

              {similarActiveQuery || similarLoading ? (
                <SimilarSitesExplorer
                  mode="hub"
                  report={similarReport}
                  loading={similarLoading}
                  onExploreSite={(q) => void runSimilarLookup(q, false)}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/25 p-6 text-center space-y-2">
                  <Radar className="mx-auto h-7 w-7 text-primary" />
                  <p className="text-sm font-semibold text-foreground">输入任意网址或点击上方热门标杆站开始探索</p>
                  <p className="text-xs text-muted-foreground">
                    支持 5 维相似度信号拆解、领域分布筛选、排除同品牌子站、任意 2–4 站免登录 VS 横评与一键导出 Markdown。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
