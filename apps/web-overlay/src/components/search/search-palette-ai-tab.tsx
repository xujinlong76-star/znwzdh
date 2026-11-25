'use client'

/**
 * 统一三合一搜索窗内的「AI 找站」面板标签页。
 *
 * 与顶栏搜索输入框共用同一个输入值，避免首页重复出现多个搜索框：
 *   - 24 个场景包按本机使用频次置前（带「常用」徽标与「换一批」轮换）；
 *   - 直连 POST /api/ai/find，在搜索下拉窗内原位返回步骤/站点推荐卡片；
 *   - 每张推荐卡片自带「找相似」按钮，一键切到同窗口的「找相似」标签页查平替；
 *   - 也保留「AI 对话追问 (Enter)」直达 Copilot 抽屉及「大窗工作台」扩展出口。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Maximize2,
  MessageSquareText,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { getApiToken, hubUrl } from '@/lib/navhub-api'
import {
  SCENE_PAGE_SIZE,
  loadSceneUsage,
  nextSceneOffset,
  orderScenesByUsage,
  recordSceneUse,
  scenePage,
  type SceneUsage,
} from '@/lib/scene-usage'
import { recordGrowthEvent } from '@/lib/growth-lazy'
import { safeHref } from '@/lib/safe-url'
import { SiteFavicon } from '@/components/site-favicon'
import { useSiteViewModel } from '@/components/site-view-context'
import { externalLinkRelAttr } from '@/lib/site-settings'
import { detectDiscoveryIntent } from '@/lib/search-discovery-intent'

interface FinderSite {
  siteId: string
  title: string
  url: string
  description: string | null
  reason: string
}

interface FinderResponse {
  ok: boolean
  mode: 'ai' | 'local' | 'none'
  degraded?: string | null
  notice: string
  recommendations: FinderSite[]
  steps: Array<{ label: string; fallback?: boolean; sites: FinderSite[] }>
  categorySuggestions: Array<{ id: string; title: string; slug: string | null }>
  scene?: { id: string; title: string }
}

export const AI_FALLBACK_SCENES: Array<{ id: string; title: string; query: string }> = [
  { id: 'make-ppt', title: '做 PPT', query: '我要做一份 PPT' },
  { id: 'edit-video', title: '剪视频', query: '我要剪一个视频' },
  { id: 'write-paper', title: '写论文', query: '我要写论文查文献' },
  { id: 'design-poster', title: '做图设计', query: '我要做一张海报图' },
  { id: 'write-code', title: '写代码', query: '我要写代码做开发' },
  { id: 'build-agent', title: '搭 AI 智能体', query: '我想搭一个 AI 智能体' },
  { id: 'generate-video', title: 'AI 生视频', query: '我想用 AI 生成视频' },
  { id: 'learn-english', title: '学英语', query: '我要学英语' },
  { id: 'learn-coding', title: '学编程', query: '我想学编程' },
  { id: 'job-interview', title: '求职面试', query: '我在准备求职面试' },
  { id: 'travel-plan', title: '旅行规划', query: '我要出去旅行做攻略' },
  { id: 'mind-map', title: '思维导图', query: '我要画一张思维导图' },
  { id: 'photo-retouch', title: '修图美化', query: '我想修一张照片' },
  { id: 'meeting-notes', title: '会议纪要', query: '我要整理会议纪要' },
  { id: 'make-music', title: '做音乐', query: '我想做一首歌' },
  { id: 'translate-doc', title: '翻译润色', query: '我要翻译一篇外文' },
  { id: 'make-resume', title: '做简历', query: '我要做一份简历找工作' },
  { id: 'data-sheets', title: '做表格', query: '我要做一份在线表格' },
  { id: 'watch-drama', title: '追短剧', query: '我想看短剧' },
  { id: 'make-drama', title: '做短剧', query: '我想自己做一部短剧' },
  { id: 'make-manga-drama', title: '做 AI 漫剧', query: '我想做 AI 漫剧' },
  { id: 'online-shopping', title: '网购购物', query: '我想网购东西' },
  { id: 'write-novel', title: '写小说', query: '我想写网络小说' },
  { id: 'exam-prep', title: '考公考研', query: '我在准备考公考研' },
]

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export interface SearchPaletteAiTabProps {
  query: string
  onQueryChange: (next: string) => void
  /** 外部通过快捷胶囊或跨模式切换传入的自动执行请求（seq 变化即执行） */
  autoRun?: { query: string; sceneId?: string; seq: number } | null
  onSwitchToSimilar: (targetQuery: string) => void
  onAskCopilot: (query: string) => void
  onOpenExpandedDialog?: (query?: string) => void
  onClosePanel: () => void
}

export function SearchPaletteAiTab({
  query,
  onQueryChange,
  autoRun,
  onSwitchToSimilar,
  onAskCopilot,
  onOpenExpandedDialog,
  onClosePanel,
}: SearchPaletteAiTabProps) {
  const externalRel = externalLinkRelAttr(useSiteViewModel()?.externalLinkRel)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FinderResponse | null>(null)
  const [scenes, setScenes] = useState(AI_FALLBACK_SCENES)
  const [usage, setUsage] = useState<SceneUsage>({})
  const [pageOffset, setPageOffset] = useState(0)
  const lastAutoSeqRef = useRef(0)

  useEffect(() => {
    setUsage(loadSceneUsage())
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(hubUrl('/api/scenes'))
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { scenes?: Array<{ id: string; title: string; intro: string }> } | null) => {
        if (cancelled || !body || !Array.isArray(body.scenes) || body.scenes.length === 0) return
        setScenes(body.scenes.map((s) => ({ id: s.id, title: s.title, query: s.intro })))
      })
      .catch(() => {
        /* 保留兜底清单 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const orderedScenes = useMemo(() => orderScenesByUsage(scenes, usage), [scenes, usage])
  const visibleScenes = useMemo(() => scenePage(orderedScenes, pageOffset), [orderedScenes, pageOffset])
  const detectedIntent = useMemo(() => detectDiscoveryIntent(query), [query])

  const runAiFind = useCallback(async (nextQuery: string, sceneId?: string) => {
    const q = nextQuery.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    recordGrowthEvent('ai_find')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = getApiToken()
      if (token) headers.Authorization = 'Bearer ' + token
      const res = await fetch(hubUrl('/api/ai/find'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: q, ...(sceneId ? { sceneId } : {}) }),
      })
      if (!res.ok) throw new Error('找站服务暂时不可用，请稍后再试')
      const raw = await res.json()
      setResult((() => {
        const body = raw as FinderResponse
        return {
          ...body,
          steps: Array.isArray(body.steps) ? body.steps : [],
          recommendations: Array.isArray(body.recommendations) ? body.recommendations : [],
          categorySuggestions: Array.isArray(body.categorySuggestions) ? body.categorySuggestions : [],
        }
      })())
    } catch {
      setError('AI 找站暂时没连上，你可以换个说法再试，或切到「找相似」查站点平替。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!autoRun || autoRun.seq === lastAutoSeqRef.current) return
    lastAutoSeqRef.current = autoRun.seq
    if (autoRun.sceneId) {
      setUsage(recordSceneUse(autoRun.sceneId))
      recordGrowthEvent('scene_open', { sceneId: autoRun.sceneId })
    }
    void runAiFind(autoRun.query, autoRun.sceneId)
  }, [autoRun, runAiFind])

  const trimmed = query.trim()

  return (
    <div className="p-3 space-y-3">
      {/* 顶部操作提示与智能网址检测 */}
      {detectedIntent === 'similar' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs">
          <span className="text-foreground">
            检测到网址/域名「<strong className="font-semibold">{trimmed}</strong>」
          </span>
          <button
            type="button"
            onClick={() => onSwitchToSimilar(trimmed)}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-95 cursor-pointer"
          >
            <Radar className="h-3 w-3" />
            <span>切到「找相似」查平替</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {/* 有输入词时提供「原位 AI 匹配」与「AI 对话追问」双动作 */}
      {trimmed ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            <Sparkles className="mr-1 inline h-3.5 w-3.5 text-violet-700 dark:text-violet-300" />
            为「<strong className="font-semibold">{trimmed}</strong>」挑选站内工具
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => void runAiFind(trimmed)}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            <span>立即找站</span>
          </button>
          <button
            type="button"
            onClick={() => onAskCopilot(trimmed)}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border-strong bg-background px-2.5 text-xs font-medium text-foreground hover:border-primary/50 hover:text-primary cursor-pointer"
            title="回车快捷键同样直达 AI 对话抽屉"
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            <span>对话追问</span>
          </button>
        </div>
      ) : null}

      {/* 场景包快捷行 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="font-semibold">任务场景包（一键出站单）</span>
          <div className="flex items-center gap-2">
            <a
              href="https://so.qq.com"
              target="_blank"
              rel={externalRel}
              className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
            >
              <span>元宝搜索</span>
              <ArrowUpRight className="h-3 w-3" />
            </a>
            <Link
              href="/scenes"
              onClick={onClosePanel}
              className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
            >
              <span>全部 24 场景</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleScenes.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={loading}
              onClick={() => {
                setUsage(recordSceneUse(s.id))
                recordGrowthEvent('scene_open', { sceneId: s.id })
                onQueryChange(s.query)
                void runAiFind(s.query, s.id)
              }}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border/75 bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50 cursor-pointer"
            >
              <span>{s.title}</span>
              {(usage[s.id] ?? 0) > 0 ? (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                  常用
                </span>
              ) : null}
            </button>
          ))}
          {scenes.length > SCENE_PAGE_SIZE ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => setPageOffset((o) => nextSceneOffset(o, orderedScenes.length))}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-primary/40 bg-background px-2.5 text-xs font-medium text-primary hover:border-primary disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" />
              <span>换一批</span>
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/15 px-3 py-2 text-xs text-destructive-text">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 animate-pulse">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="h-20 rounded-xl bg-muted/70" />
          ))}
        </div>
      ) : null}

      {/* 原位 AI 找站结果卡片 */}
      {!loading && result ? (
        <div className="space-y-3 border-t border-border/60 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-muted-foreground">
              {result.mode === 'ai' ? '✨ ' : ''}
              {result.notice}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {result.scene ? (
                <Link
                  href={`/scenes/${result.scene.id}`}
                  onClick={onClosePanel}
                  className="inline-flex h-6 items-center gap-1 rounded-md bg-primary/10 px-2 font-medium text-primary hover:bg-primary/20"
                >
                  <span>场景页</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              ) : null}
              {onOpenExpandedDialog ? (
                <button
                  type="button"
                  onClick={() => onOpenExpandedDialog(trimmed || undefined)}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 bg-card px-2 font-medium text-foreground hover:border-primary/40 hover:text-primary cursor-pointer"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>大窗</span>
                </button>
              ) : null}
            </div>
          </div>

          {result.steps.length > 0
            ? result.steps.map((step) => (
                <div key={step.label} className="space-y-1.5">
                  <h3 className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-foreground">
                    {step.label}
                    {step.fallback ? (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-foreground">
                        相关推荐
                      </span>
                    ) : null}
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {step.sites.map((site) => (
                      <div
                        key={site.siteId}
                        className="flex flex-col justify-between gap-1.5 rounded-xl border border-border/70 bg-card p-2.5 transition-colors hover:border-primary/45"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <SiteFavicon
                            url={site.url}
                            title={site.title}
                            eager
                            className="mt-0.5 h-5 w-5 shrink-0 rounded-md"
                          />
                          <div className="min-w-0 flex-1">
                            <a
                              href={safeHref(site.url)}
                              target="_blank"
                              rel={externalRel}
                              onClick={onClosePanel}
                              className="inline-flex max-w-full items-center gap-1 text-xs sm:text-sm font-semibold text-foreground hover:text-primary"
                            >
                              <span className="truncate">{site.title}</span>
                              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            </a>
                            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                              {site.reason}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 text-[11px]">
                          <span className="truncate font-mono text-muted-foreground">{safeHostname(site.url)}</span>
                          <button
                            type="button"
                            onClick={() => onSwitchToSimilar(safeHostname(site.url) || site.title)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20 cursor-pointer"
                            title={`查找与「${site.title}」相似的平替网站`}
                          >
                            <Radar className="h-3 w-3" />
                            <span>找相似</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            : null}

          {result.steps.length === 0 && result.recommendations.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {result.recommendations.map((site) => (
                <div
                  key={site.siteId}
                  className="flex flex-col justify-between gap-1.5 rounded-xl border border-border/70 bg-card p-2.5 transition-colors hover:border-primary/45"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <SiteFavicon
                      url={site.url}
                      title={site.title}
                      eager
                      className="mt-0.5 h-5 w-5 shrink-0 rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <a
                        href={safeHref(site.url)}
                        target="_blank"
                        rel={externalRel}
                        onClick={onClosePanel}
                        className="inline-flex max-w-full items-center gap-1 text-xs sm:text-sm font-semibold text-foreground hover:text-primary"
                      >
                        <span className="truncate">{site.title}</span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </a>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                        {site.reason}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 text-[11px]">
                    <span className="truncate font-mono text-muted-foreground">{safeHostname(site.url)}</span>
                    <button
                      type="button"
                      onClick={() => onSwitchToSimilar(safeHostname(site.url) || site.title)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20 cursor-pointer"
                    >
                      <Radar className="h-3 w-3" />
                      <span>找相似</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {result.mode === 'none' && result.categorySuggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {result.categorySuggestions.map((c) => (
                <Link
                  key={c.id}
                  href={`/category/${c.slug || c.id}`}
                  onClick={onClosePanel}
                  className="inline-flex h-7 items-center rounded-full bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  去「{c.title}」分类看看
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && !result && !trimmed ? (
        <p className="rounded-xl border border-dashed border-border/70 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
          在顶部输入框直接描述你想做的事（如「免费做 PPT」「在线剪视频」），按 <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">Enter</kbd> 问 AI 或点上方任意场景包即刻出结果。
        </p>
      ) : null}

      {/* 桌面端快捷键提示尾栏 */}
      <div className="hidden sm:flex sm:pointer-coarse:hidden items-center gap-2.5 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Enter</kbd>
          <span>对话追问</span>
        </span>
        <span>·</span>
        <span>点场景包即刻出站单</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Esc</kbd>
          <span>关闭</span>
        </span>
      </div>
    </div>
  )
}
