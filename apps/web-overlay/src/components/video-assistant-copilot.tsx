'use client'

import React, { useState, useMemo } from 'react'
import {
  VideoLocalRagStore,
  type RagSearchResult,
} from '@/lib/video-local-rag-search'
import type { VideoTranscriptItem } from '@/types/navigation'
import { Button } from '@/registry/new-york/ui/button'
import { Sparkles, Search, PlayCircle, MessageSquareQuote, Loader2, Zap } from 'lucide-react'
import { formatDuration } from '@/lib/video-format'

interface VideoAssistantCopilotProps {
  transcripts: VideoTranscriptItem[]
  onSeek: (sec: number) => void
}

export function VideoAssistantCopilot({
  transcripts,
  onSeek,
}: VideoAssistantCopilotProps) {
  const [query, setQuery] = useState<string>('')
  const [results, setResults] = useState<RagSearchResult[]>([])
  const [searched, setSearched] = useState<boolean>(false)
  const [aiLoading, setAiLoading] = useState<boolean>(false)
  const [aiResponse, setAiResponse] = useState<{
    answer: string
    keyPoints: Array<{ startSec: number; point: string }>
  } | null>(null)

  const ragStore = useMemo(() => {
    const store = new VideoLocalRagStore()
    store.indexTranscripts(transcripts)
    return store
  }, [transcripts])

  const callVideoAi = async (mode: 'qa' | 'summary', qText: string, chunksToUse: Array<{ startSec: number; text: string }>) => {
    if (chunksToUse.length === 0) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/hub/videos/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          question: qText,
          chunks: chunksToUse,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.answer) {
          setAiResponse({
            answer: data.answer,
            keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : [],
          })
        }
      }
    } catch {
      // 容错降级：保持本地 RAG 切片结果可用
    } finally {
      setAiLoading(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    const res = ragStore.search(query, 4)
    setResults(res)
    setSearched(true)
    const targetChunks =
      res.length > 0
        ? res.map((r) => ({ startSec: r.chunk.startSec, text: r.chunk.text }))
        : transcripts.slice(0, 8).map((t) => ({ startSec: t.startSec, text: t.text }))
    void callVideoAi('qa', query.trim(), targetChunks)
  }

  const handleQuickSummary = () => {
    const sampled = transcripts.slice(0, 14).map((t) => ({ startSec: t.startSec, text: t.text }))
    void callVideoAi('summary', '全片核心要点总结', sampled)
  }

  return (
    <div className="space-y-3 p-3 rounded-lg border bg-card text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>端侧 RAG 语义索引与智能伴学 Copilot</span>
        </div>
        {transcripts.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={aiLoading}
            onClick={handleQuickSummary}
            className="h-6.5 px-2 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
          >
            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            <span>⚡ AI 全片要点速览</span>
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        基于内存轻量余弦向量空间模型与 Agnes 3.0 Flash，输入任何疑问或点击要点速览，秒级提炼干货并定位讲师对应讲解时间点。
      </p>

      {/* Query Input */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input aria-label="向伴学助手提问"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="提问或搜概念，如: 这节课核心架构是什么、Docker 镜像..."
          className="flex-1 px-3 py-1.5 text-xs rounded-md bg-muted border border-border/50 focus:outline-none"
        />
        <Button size="sm" type="submit" disabled={aiLoading} className="gap-1 text-xs">
          {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          <span>AI 伴学提问</span>
        </Button>
      </form>

      {/* AI 提炼结论与时间戳直达 */}
      {aiResponse && (
        <div className="p-2.5 rounded-lg border border-primary/25 bg-primary/5 space-y-2">
          <div className="text-xs text-foreground leading-relaxed">
            <span className="font-semibold text-primary">✨ AI 伴学解答：</span>
            {aiResponse.answer}
          </div>
          {aiResponse.keyPoints.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border/40">
              {aiResponse.keyPoints.map((kp, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-muted-foreground truncate flex-1">• {kp.point}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5.5 px-1.5 text-[10px] font-mono text-primary gap-1 shrink-0"
                    onClick={() => onSeek(kp.startSec)}
                  >
                    <PlayCircle className="w-3 h-3" />
                    <span>{formatDuration(kp.startSec)}</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results View */}
      {searched && (
        <div className="space-y-2 pt-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase">
            相关上下文切片 ({results.length})
          </div>

          {results.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-xs">未找到高相似度段落</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {results.map(({ chunk, similarity, explanation }) => (
                <div
                  key={chunk.id}
                  className="p-2.5 rounded-lg border bg-muted/30 space-y-1.5 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-primary font-bold text-[10px]">
                      ⏱️ {formatDuration(chunk.startSec)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono text-[9px]">
                      相关度: {Math.round(similarity * 100)}%
                    </span>
                  </div>
                  <p className="text-foreground text-xs leading-relaxed font-medium">
                    {chunk.text}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px]">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <MessageSquareQuote className="w-3 h-3 text-emerald-500" />
                      {explanation}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2 text-primary gap-1"
                      onClick={() => onSeek(chunk.startSec)}
                    >
                      <PlayCircle className="w-3 h-3" /> 定位播放
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
