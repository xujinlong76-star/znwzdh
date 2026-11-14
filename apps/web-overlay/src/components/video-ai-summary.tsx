'use client'

/**
 * B 站视频「问 AI」摘要（视频详情页的客户端区块）。
 *
 * 资料来源（缺一样就少一样，绝不编造）：
 *  - 站内目录已有的标题、简介、章节、字幕摘录（服务端直出，随 props 进来）；
 *  - 目录简介为空且有 bvid 时，点按后先调站内 /api/videos/bili-parse
 *    刷新简介（星之阁 / 米人引擎，实测可取简介），再把简介带去摘要接口。
 * 评论不在资料之列：B 站评论接口匿名调用实测 -352（需登录态），拿不到。
 *
 * 标注纪律：摘要区永远写明「非全文稿」——它是简介 + 章节 + 字幕摘录的
 * 要点提炼，不是看完全片的总结。模型未就绪时不假装有摘要，改展原文要点。
 */
import { useCallback, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { hubUrl } from '@/lib/navhub-api'

export interface VideoAiSummaryChapter {
  title: string
  startSec: number
}

export interface VideoAiSummaryTranscriptLine {
  startSec: number
  text: string
}

interface VideoAiSummaryProps {
  bvid?: string
  title: string
  description?: string
  chapters?: VideoAiSummaryChapter[]
  transcript?: VideoAiSummaryTranscriptLine[]
}

const SOURCE_LABELS: Record<string, string> = {
  desc: '视频简介',
  chapters: '章节标题',
  transcript: '字幕摘录',
}

interface SummaryResponse {
  ok: boolean
  mode: 'ai' | 'local'
  degraded: 'unconfigured' | 'quota' | 'error' | null
  summary: string | null
  sources: string[]
  note: string
  fallback: { description: string | null; chapters: string[] }
}

type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; data: SummaryResponse }
  | { kind: 'error'; message: string }

export function VideoAiSummary({ bvid, title, description, chapters = [], transcript = [] }: VideoAiSummaryProps) {
  const [state, setState] = useState<PanelState>({ kind: 'idle' })

  const generate = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      let liveDescription = (description || '').trim()
      if (!liveDescription && bvid) {
        // 目录简介缺失时刷新一次：走站内已有的 bili-parse 引擎取简介。
        const parsed = await fetch(`/api/videos/bili-parse?bvid=${encodeURIComponent(bvid)}`, {
          headers: { Accept: 'application/json' },
        }).then((r) => r.json()).catch(() => {
          // 简介刷新失败不阻塞摘要生成：沿用目录自带简介继续走主流程。
          return null
        })
        if (parsed?.ok && typeof parsed.desc === 'string' && parsed.desc.trim()) {
          liveDescription = parsed.desc.trim()
        }
      }
      const res = await fetch(hubUrl('/api/videos/bili-summary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(bvid ? { bvid } : {}),
          title,
          description: liveDescription || undefined,
          chapters: chapters.slice(0, 60),
          transcript: transcript.slice(0, 150),
        }),
      })
      const data = (await res.json().catch(() => {
        // 响应体不是 JSON 时 data 为 null，下方统一走 error 态提示用户重试。
        return null
      })) as SummaryResponse | null
      if (!res.ok || !data || data.ok !== true) {
        setState({
          kind: 'error',
          message: (data as unknown as { message?: string } | null)?.message || '摘要接口暂时不可用，稍后再试',
        })
        return
      }
      setState({ kind: 'done', data })
    } catch {
      setState({ kind: 'error', message: '网络出了点问题，摘要没生成，稍后再试' })
    }
  }, [bvid, title, description, chapters, transcript])

  const materialCount = [description?.trim() ? 1 : 0, chapters.length > 0 ? 1 : 0, transcript.length > 0 ? 1 : 0].reduce((a, b) => a + b, 0)

  return (
    <section aria-labelledby="video-ai-summary-heading" className="space-y-3 pt-4 border-t border-slate-800/80">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="video-ai-summary-heading" className="text-lg font-semibold text-white flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          问 AI · 视频摘要
        </h2>
        {state.kind !== 'loading' && (
          <button
            type="button"
            onClick={() => void generate()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {state.kind === 'done' || state.kind === 'error' ? '重新生成摘要' : '生成 AI 摘要'}
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        基于视频简介与站内资料（章节、字幕摘录）的要点提炼，<strong className="text-slate-200">非全文稿</strong>；原视频内容以原站为准。
        {materialCount === 0 && !bvid ? '这个视频暂无可用来做摘要的资料。' : ''}
      </p>

      {state.kind === 'loading' && (
        <p className="text-sm text-slate-300 flex items-center gap-2" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
          正在按简介与字幕提炼要点…
        </p>
      )}

      {state.kind === 'error' && (
        <p className="text-sm text-rose-300" role="alert">{state.message}</p>
      )}

      {state.kind === 'done' && state.data.mode === 'ai' && state.data.summary && (
        <div className="space-y-2.5">
          <p className="text-sm sm:text-base text-slate-200 leading-relaxed whitespace-pre-line">{state.data.summary}</p>
          <p className="text-xs text-slate-400">
            依据：{state.data.sources.map((s) => SOURCE_LABELS[s] || s).join('、')} · {state.data.note}
          </p>
        </div>
      )}

      {state.kind === 'done' && state.data.mode === 'local' && (
        <div className="space-y-2.5">
          <p className="text-sm text-amber-200/90">AI 摘要暂时不可用，先看原文要点（未经过 AI 整理）：</p>
          {state.data.fallback.description && (
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{state.data.fallback.description}</p>
          )}
          {state.data.fallback.chapters.length > 0 && (
            <ol className="list-decimal list-inside space-y-1 text-sm text-slate-300">
              {state.data.fallback.chapters.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          )}
          <p className="text-xs text-slate-400">{state.data.note}</p>
        </div>
      )}
    </section>
  )
}
