'use client'

import { useState } from 'react'
import { ArrowUpRight, Loader2, Search, Sparkles } from 'lucide-react'
import { getApiToken, hubUrl } from '@/lib/navhub-api'

/**
 * AI 智能找站（首页首屏入口）。
 *
 * 与 Copilot 抽屉的分工：抽屉是对话，这里是一句话换一组能直接点开的站点卡片。
 * 数据只来自 POST /api/ai/find——服务端保证每个链接都是站内真实收录，
 * 这里不做任何二次拼接 URL。未配密钥/额度用完时服务端会降级并在 notice 里
 * 如实说明，本组件原样展示，不把本地检索结果冒充 AI 推荐。
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

const SCENES: Array<{ id: string; title: string; query: string }> = [
  { id: 'make-ppt', title: '做 PPT', query: '我要做一份 PPT' },
  { id: 'edit-video', title: '剪视频', query: '我要剪一个视频' },
  { id: 'write-paper', title: '写论文', query: '我要写论文查文献' },
  { id: 'watch-drama', title: '追短剧', query: '我想看短剧' },
  { id: 'learn-english', title: '学英语', query: '我要学英语' },
]

function SiteCard({ site }: { site: FinderSite }) {
  return (
    <a
      href={site.url}
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

  async function run(nextQuery: string, sceneId?: string) {
    const q = nextQuery.trim()
    if (!q || loading) return
    setLoading(true)
    setError(null)
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

  return (
    <section
      aria-label="AI 智能找站"
      className="mb-4 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-background to-background p-4 sm:mb-6 sm:p-5"
    >
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
        <Sparkles className="h-5 w-5 text-primary" />
        AI 智能找站
        <span className="text-xs font-normal text-muted-foreground sm:text-sm">说一句话，给你能直接打开的网站</span>
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
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-3.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
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

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="py-1.5 text-sm text-muted-foreground">场景包：</span>
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={loading}
            onClick={() => {
              setQuery(s.query)
              void run(s.query, s.id)
            }}
            className="min-h-10 rounded-full border border-border bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50 disabled:opacity-50"
          >
            {s.title}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {result.mode === 'ai' ? '✨ ' : ''}
            {result.notice}
          </p>
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
