'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react'
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
import { recordGrowthEvent } from '@/lib/growth'
import { safeHref } from '@/lib/safe-url'

/**
 * AI 智能找站（首页首屏入口）。
 *
 * 与 Copilot 抽屉的分工：抽屉是对话，这里是一句话换一组能直接点开的站点卡片。
 * 数据只来自 POST /api/ai/find——服务端保证每个链接都是站内真实收录，
 * 这里不做任何二次拼接 URL。未配密钥/额度用完时服务端会降级并在 notice 里
 * 如实说明，本组件原样展示，不把本地检索结果冒充 AI 推荐。
 *
 * 场景包共 24 个，场景区一页只展示 SCENE_PAGE_SIZE 个，「换一批」整页轮换；
 * 点开过的场景只在本机 localStorage 计数（不回传服务端），常用的自动排前面
 * 并带「常用」标记，无记录时就是服务端给的默认顺序。
 *
 * 场景清单以中枢 GET /api/scenes 为准（定义 SCENE_PACKS 在服务端，落地页
 * /scenes 与本面板共用同一份）；下面的 FALLBACK_SCENES 只在接口取不到时
 * 兜底渲染。落地页 CTA 以 /?scene={id}#ai-finder 回跳，挂载后自动展开。
 */

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
  steps: Array<{ label: string; sites: FinderSite[] }>
  categorySuggestions: Array<{ id: string; title: string; slug: string | null }>
  scene?: { id: string; title: string }
}

/**
 * 兜底清单：仅当中枢 GET /api/scenes 取不到时用，顺序与服务端 SCENE_PACKS
 * 定义顺序一致（挂载后会被服务端清单原位替换，避免芯片顺序跳变）。
 * query 即服务端 intro（点开场景时发给找站的那句话）。
 */
const FALLBACK_SCENES: Array<{ id: string; title: string; query: string }> = [
  { id: 'make-ppt', title: '做 PPT', query: '我要做一份 PPT' },
  { id: 'edit-video', title: '剪视频', query: '我要剪一个视频' },
  { id: 'write-paper', title: '写论文', query: '我要写论文查文献' },
  { id: 'watch-drama', title: '追短剧', query: '我想看短剧' },
  { id: 'make-drama', title: '做短剧', query: '我想自己做一部短剧' },
  { id: 'make-manga-drama', title: '做 AI 漫剧', query: '我想做 AI 漫剧' },
  { id: 'learn-english', title: '学英语', query: '我要学英语' },
  { id: 'design-poster', title: '做图设计', query: '我要做一张海报图' },
  { id: 'generate-video', title: 'AI 生视频', query: '我想用 AI 生成视频' },
  { id: 'learn-coding', title: '学编程', query: '我想学编程' },
  { id: 'job-interview', title: '求职面试', query: '我在准备求职面试' },
  { id: 'travel-plan', title: '旅行规划', query: '我要出去旅行做攻略' },
  { id: 'mind-map', title: '思维导图', query: '我要画一张思维导图' },
  { id: 'write-code', title: '写代码', query: '我要写代码做开发' },
  { id: 'photo-retouch', title: '修图美化', query: '我想修一张照片' },
  { id: 'meeting-notes', title: '会议纪要', query: '我要整理会议纪要' },
  { id: 'make-music', title: '做音乐', query: '我想做一首歌' },
  { id: 'build-agent', title: '搭 AI 智能体', query: '我想搭一个 AI 智能体' },
  { id: 'translate-doc', title: '翻译润色', query: '我要翻译一篇外文' },
  { id: 'online-shopping', title: '网购购物', query: '我想网购东西' },
  { id: 'make-resume', title: '做简历', query: '我要做一份简历找工作' },
  { id: 'data-sheets', title: '做表格', query: '我要做一份在线表格' },
  { id: 'write-novel', title: '写小说', query: '我想写网络小说' },
  { id: 'exam-prep', title: '考公考研', query: '我在准备考公考研' },
]

function SiteCard({ site }: { site: FinderSite }) {
  return (
    <a
      href={safeHref(site.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          <span className="truncate">{site.title}</span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{site.reason}</p>
      </div>
    </a>
  )
}

export function AiFinderPanel() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FinderResponse | null>(null)
  // 场景清单：首屏用兜底清单渲染，挂载后换成中枢 GET /api/scenes 的服务端清单
  const [scenes, setScenes] = useState(FALLBACK_SCENES)
  // 使用习惯只存本机：首屏先按默认顺序渲染，挂载后读 localStorage 再个性化，避免水合不一致
  const [usage, setUsage] = useState<SceneUsage>({})
  const [pageOffset, setPageOffset] = useState(0)
  // 落地页 /scenes/{id} 的 CTA 带 ?scene={id} 回跳：只自动展开一次
  const autoRanRef = useRef(false)

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
        /* 取不到就保留兜底清单，场景功能不受影响 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const orderedScenes = useMemo(() => orderScenesByUsage(scenes, usage), [scenes, usage])
  const visibleScenes = useMemo(() => scenePage(orderedScenes, pageOffset), [orderedScenes, pageOffset])

  async function run(nextQuery: string, sceneId?: string) {
    const q = nextQuery.trim()
    if (!q || loading) return
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
      setResult((await res.json()) as FinderResponse)
    } catch {
      setError('找站没成功，可能是网络或服务暂时不可用。你可以换个说法再试，或先从下方分类里找。')
    } finally {
      setLoading(false)
    }
  }

  // 落地页 CTA 回跳（/?scene={id}#ai-finder）：场景清单就绪后自动展开一次，
  // 计数与成长事件与手动点开一致（recordSceneUse + scene_open）。
  useEffect(() => {
    if (autoRanRef.current) return
    const targetId = new URLSearchParams(window.location.search).get('scene')
    if (!targetId) {
      autoRanRef.current = true
      return
    }
    const target = scenes.find((s) => s.id === targetId)
    if (!target) return // 清单还没换成服务端的，等下一次渲染再判
    autoRanRef.current = true
    setUsage(recordSceneUse(target.id))
    recordGrowthEvent('scene_open', { sceneId: target.id })
    setQuery(target.query)
    void run(target.query, target.id)
    document.getElementById('ai-finder')?.scrollIntoView({ block: 'start' })
    // run 每次渲染重建，这里只以「目标场景是否已就绪」为触发条件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes])

  return (
    <section
      id="ai-finder"
      aria-label="AI 智能找站"
      className="mb-4 scroll-mt-4 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-background to-background p-4 sm:mb-6 sm:p-5"
    >
      <h2 className="flex flex-wrap items-center gap-2 text-base font-bold text-foreground sm:text-lg">
        <Sparkles className="h-5 w-5 text-primary" />
        AI 智能找站
        <span className="text-xs font-normal text-muted-foreground sm:text-sm">说一句话，给你能直接打开的网站</span>
        <Link
          href="/scenes"
          className="ml-auto inline-flex min-h-8 items-center text-xs font-medium text-primary underline-offset-4 hover:underline sm:text-sm"
        >
          全部场景包 →
        </Link>
      </h2>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run(query)
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="比如：想找个免费做 PPT 的网站"
          aria-label="描述你想找的网站"
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-border-strong bg-background px-3.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          找站
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="py-1.5 text-sm text-muted-foreground">场景包：</span>
        {visibleScenes.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={loading}
            onClick={() => {
              setUsage(recordSceneUse(s.id))
              recordGrowthEvent('scene_open', { sceneId: s.id })
              setQuery(s.query)
              void run(s.query, s.id)
            }}
            className="inline-flex min-h-10 items-center rounded-full border border-border bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50 disabled:opacity-50"
          >
            {s.title}
            {(usage[s.id] ?? 0) > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary">
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
            className="inline-flex min-h-10 items-center gap-1 rounded-full border border-dashed border-primary/40 bg-background px-3.5 text-sm font-medium text-primary transition-colors hover:border-primary disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            换一批
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/15 px-3 py-2 text-sm text-destructive-text">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {result.mode === 'ai' ? '✨ ' : ''}
            {result.notice}
          </p>
          {result.scene ? (
            <p className="text-sm">
              <Link
                href={`/scenes/${result.scene.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                查看「{result.scene.title}」完整场景页（含每步网站清单）→
              </Link>
            </p>
          ) : null}
          {result.steps.length > 0
            ? result.steps.map((step) => (
                <div key={step.label}>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{step.label}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {step.sites.map((site) => (
                      <SiteCard key={site.siteId} site={site} />
                    ))}
                  </div>
                </div>
              ))
            : null}
          {result.steps.length === 0 && result.recommendations.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {result.recommendations.map((site) => (
                <SiteCard key={site.siteId} site={site} />
              ))}
            </div>
          ) : null}
          {result.mode === 'none' && result.categorySuggestions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {result.categorySuggestions.map((c) => (
                <a
                  key={c.id}
                  href={`/category/${c.slug || c.id}`}
                  className="inline-flex min-h-10 items-center rounded-full bg-primary/10 px-3.5 text-sm font-medium text-primary"
                >
                  去「{c.title}」分类看看
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
