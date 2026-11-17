'use client'

/**
 * 问问我的收藏（/ask）：在自己的收藏里带引用问答。
 *
 * 交互口径（见 apps/api/src/routes/ask.ts 与设计稿）：
 *  - 顶部大输入框，?q= 深链预填；下方 3 条「试试问」示例取自真实收藏标题；
 *  - 加载分两段诚实展示（正在翻你的 N 条收藏… → 找到 M 条相关 → AI 正在整理答案…），
 *    检索 0 命中直接进「不知道」分支；引用角标只在终稿里出现；
 *  - 收藏 <5 条时不开放提问（按钮置灰 + 说明 + 去逛逛/去导入入口）；
 *  - 移动端输入框吸底、目标 ≥44px；本机历史最近 20 条，一键清空。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen,
  ExternalLink,
  Lightbulb,
  Loader2,
  LogIn,
  MessageCircleQuestion,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Button } from '@/registry/new-york/ui/button'
import { safeHref } from '@/lib/safe-url'
import {
  askHistoryForRequest,
  clearAskHistory,
  fetchAskStatus,
  loadAskHistory,
  saveAskHistoryEntry,
  streamAskQuestion,
  type AskCitationCard,
  type AskFinalBody,
  type AskHistoryEntry,
  type AskStatus,
} from '@/lib/ask-client'

export const ASK_PRIVACY_NOTE =
  '你的收藏标题、描述与备注会随问题一起发给 AI 服务商（默认 AI 服务商）生成答案；问题与答案默认只保存在这台设备上，不会同步到服务器。关闭 AI 或清空本机记录可随时停止。'

const UNKNOWN_SUMMARY = '在你的收藏里没找到能回答这个问题的依据。'

function formatFavDate(createdAt: number): string {
  try {
    return new Date(createdAt).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

function exampleQuestions(samples: string[]): string[] {
  const templates = [
    (t: string) => `「${t}」是做什么的？`,
    (t: string) => `收藏里有哪些和「${t}」类似的站？`,
    (t: string) => `「${t}」适合新手直接用吗？`,
  ]
  return samples.slice(0, 3).map((t, i) => templates[i % templates.length]!(t))
}

function CitationCard({
  card,
  index,
  highlighted,
  cardRef,
}: {
  card: AskCitationCard
  index: number
  highlighted: boolean
  cardRef?: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={cardRef}
      id={`ask-citation-${card.siteId}`}
      className={`rounded-xl border bg-card p-4 ${highlighted ? 'border-primary ring-2 ring-primary/30' : ''}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-semibold text-muted-foreground">[{index + 1}]</span>
        <Link
          href={`/site/${encodeURIComponent(card.siteId)}`}
          className="text-sm font-medium hover:text-primary"
        >
          {card.title}
        </Link>
        <a
          href={safeHref(card.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          打开原站 <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
      {card.description ? (
        <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {card.note ? <span>备注：{card.note}</span> : null}
        {card.tags.length > 0 ? <span>标签：{card.tags.join('、')}</span> : null}
        <span>收藏于 {formatFavDate(card.createdAt)}</span>
      </div>
    </div>
  )
}

export default function AskView({ initialQ }: { initialQ?: string }) {
  const [status, setStatus] = useState<AskStatus | null>(null)
  const [statusState, setStatusState] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>(
    'loading',
  )
  const [question, setQuestion] = useState(initialQ ?? '')
  const [asking, setAsking] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [result, setResult] = useState<AskFinalBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<AskHistoryEntry[]>([])
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  const loadStatus = useCallback(() => {
    setStatusState('loading')
    fetchAskStatus()
      .then((s) => {
        setStatus(s)
        setStatusState('ready')
      })
      .catch((err: unknown) => {
        setStatusState((err as { status?: number })?.status === 401 ? 'unauthorized' : 'error')
      })
  }, [])

  useEffect(() => {
    loadStatus()
    setHistory(loadAskHistory())
  }, [loadStatus])

  const ask = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed || asking) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setAsking(true)
      setError(null)
      setResult(null)
      setHighlightedId(null)
      setStage(`正在翻你的 ${status?.favoritesCount ?? ''} 条收藏…`)
      try {
        const final = await streamAskQuestion(trimmed, askHistoryForRequest(loadAskHistory()), {
          signal: controller.signal,
          onProgress: (p) => {
            if (p.stage === 'retrieved') {
              setStage(`找到 ${p.matched ?? 0} 条相关`)
            } else if (p.stage === 'generating') {
              setStage('AI 正在整理答案…')
            }
          },
        })
        setResult(final)
        if (final.ok !== false) {
          const summary =
            final.answer?.[0]?.text ?? (final.unknown ? UNKNOWN_SUMMARY : '')
          if (summary) {
            setHistory(
              saveAskHistoryEntry({
                question: trimmed,
                summary,
                siteIds: (final.citations ?? []).map((c) => c.siteId),
                at: Date.now(),
              }),
            )
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : '提问失败，请重试。')
      } finally {
        setAsking(false)
        setStage(null)
      }
    },
    [asking, status?.favoritesCount],
  )

  const canAsk = status?.canAsk === true
  const examples = status ? exampleQuestions(status.samples) : []
  const citations = result?.citations ?? []

  const scrollToCitation = (siteId: string) => {
    setHighlightedId(siteId)
    cardRefs.current.get(siteId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <Container className="pb-8">
      <header className="pb-6 pt-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageCircleQuestion className="h-6 w-6 text-primary" aria-hidden />
          问问我的收藏
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          只在你的收藏里找依据：每条结论都带可点击的引用，找不到就老实说不知道，不瞎猜。
        </p>
      </header>

      {statusState === 'unauthorized' ? (
        <section
          aria-label="请先登录"
          className="rounded-xl border bg-card p-6 text-center"
        >
          <LogIn className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm">问问我的收藏只对登录用户开放，匿名访客的收藏不在服务端。</p>
          <Button asChild className="mt-4 min-h-[44px]">
            <Link href="/auth/signin">去登录</Link>
          </Button>
        </section>
      ) : null}

      {statusState === 'error' ? (
        <section aria-label="状态加载失败" className="rounded-xl border bg-card p-4 text-sm">
          收藏状态暂时取不到，请检查网络后
          <Button variant="link" className="min-h-[44px] px-1" onClick={loadStatus}>
            重试
          </Button>
        </section>
      ) : null}

      {statusState === 'ready' && status && !canAsk ? (
        <section
          aria-label="收藏还不够"
          className="mb-4 rounded-xl border bg-card p-4 text-sm text-muted-foreground"
        >
          你的收藏只有 {status.favoritesCount} 条，攒够 5 条才能提问——收藏越多，问得越准。
          <span className="mt-2 flex flex-wrap gap-3">
            <Link href="/" className="inline-flex min-h-[44px] items-center text-primary hover:underline">
              去逛逛
            </Link>
            <Link
              href="/import"
              className="inline-flex min-h-[44px] items-center text-primary hover:underline"
            >
              去导入
            </Link>
          </span>
        </section>
      ) : null}

      {statusState === 'ready' && examples.length > 0 && canAsk ? (
        <section aria-label="试试问" className="mb-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden /> 试试问
          </p>
          <div className="flex flex-wrap gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={asking}
                onClick={() => {
                  setQuestion(ex)
                  void ask(ex)
                }}
                className="min-h-[44px] rounded-full border bg-card px-3 py-2 text-sm hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {asking && stage ? (
        <p aria-live="polite" className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {stage}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {error}
        </p>
      ) : null}

      {result && result.ok !== false ? (
        <section aria-label="回答" className="mb-6 space-y-4">
          {result.degraded === 'unconfigured' ? (
            <p className="rounded-xl border bg-card p-4 text-sm">
              {result.message ?? 'AI 还没配好，先看看下面这些相关的收藏。'}
            </p>
          ) : null}
          {result.degraded === 'quota' ? (
            <p className="rounded-xl border bg-card p-4 text-sm">
              {result.message ?? '今天的 AI 提问额度用完了。'}
              {result.quota ? `（今日已用 ${result.quota.used}/${result.quota.limit} 次）` : ''}
            </p>
          ) : null}
          {result.degraded === 'error' ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p role="alert">
                {result.message ?? '收藏检索这会儿有点忙，没能帮你翻目录，等会儿再问我一次。'}
              </p>
              <Button
                variant="outline"
                className="mt-3 min-h-[44px]"
                disabled={asking}
                onClick={() => {
                  void ask(question)
                }}
              >
                再试一次
              </Button>
            </div>
          ) : null}
          {result.answer?.map((seg, i) => (
            <p key={i} className="text-base leading-relaxed">
              {seg.text}{' '}
              {seg.citations.map((siteId) => {
                const idx = citations.findIndex((c) => c.siteId === siteId)
                if (idx < 0) return null
                return (
                  <button
                    key={siteId}
                    type="button"
                    onClick={() => scrollToCitation(siteId)}
                    aria-label={`查看引用 ${citations[idx]?.title ?? siteId}`}
                    className="mx-0.5 inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded bg-primary/10 px-1 align-super text-xs font-semibold text-primary hover:bg-primary/20"
                  >
                    [{idx + 1}]
                  </button>
                )
              })}
            </p>
          ))}
          {result.unknown ? (
            <p className="text-xs text-muted-foreground">下面这些最接近的收藏仅供参考，不是答案依据。</p>
          ) : null}
          {citations.length > 0 ? (
            <div className="space-y-3">
              {citations.map((card, i) => (
                <CitationCard
                  key={card.siteId}
                  card={card}
                  index={i}
                  highlighted={highlightedId === card.siteId}
                  cardRef={(el) => {
                    if (el) cardRefs.current.set(card.siteId, el)
                    else cardRefs.current.delete(card.siteId)
                  }}
                />
              ))}
            </div>
          ) : null}
          {result.suggestions && result.suggestions.length > 0 ? (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">换个问法：</p>
              <div className="flex flex-wrap gap-2">
                {result.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={asking}
                    onClick={() => {
                      setQuestion(s)
                      void ask(s)
                    }}
                    className="min-h-[44px] rounded-full border bg-card px-3 py-2 text-sm hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {result && result.ok === false ? (
        <section aria-label="回答失败" className="mb-6 space-y-4">
          <p role="alert" className="rounded-xl border bg-card p-4 text-sm">
            {result.error ?? '这次没能整理出答案。'}
          </p>
          {citations.length > 0 ? (
            <div className="space-y-3">
              {citations.map((card, i) => (
                <CitationCard key={card.siteId} card={card} index={i} highlighted={false} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {history.length > 0 ? (
        <section aria-label="本机问答历史" className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <BookOpen className="h-4 w-4" aria-hidden /> 本机问答历史
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px] text-xs"
              onClick={() => {
                clearAskHistory()
                setHistory([])
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> 清空
            </Button>
          </div>
          <ul className="space-y-2">
            {history.map((entry) => (
              <li key={`${entry.at}-${entry.question}`}>
                <button
                  type="button"
                  disabled={asking}
                  onClick={() => {
                    setQuestion(entry.question)
                    void ask(entry.question)
                  }}
                  className="w-full rounded-xl border bg-card p-3 text-left hover:border-primary disabled:opacity-50"
                >
                  <span className="block text-sm font-medium">{entry.question}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {entry.summary}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        className="sticky bottom-0 z-10 border-t border-border bg-background/95 py-3 backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(question)
        }}
      >
        <div className="flex gap-2">
          <label htmlFor="ask-question" className="sr-only">
            问问我的收藏
          </label>
          <input
            id="ask-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              canAsk ? '在你的收藏里问点什么…' : '收藏够 5 条后才能提问'
            }
            disabled={!canAsk || asking}
            maxLength={500}
            autoComplete="off"
            className="min-h-[44px] flex-1 rounded-xl border bg-card px-4 text-base outline-none placeholder:text-muted-foreground focus:border-primary disabled:opacity-50"
          />
          <Button
            type="submit"
            disabled={!canAsk || asking || !question.trim()}
            className="min-h-[44px] min-w-[44px] shrink-0"
          >
            {asking ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Search className="h-4 w-4" aria-hidden />
            )}
            <span className="ml-1.5">{asking ? '问着呢' : '提问'}</span>
          </Button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {ASK_PRIVACY_NOTE}
        </p>
      </form>
    </Container>
  )
}
