'use client'

import React, { useState, useMemo } from 'react'
import {
  VideoLocalRagStore,
  type RagSearchResult,
} from '@/lib/video-local-rag-search'
import type { VideoTranscriptItem } from '@/types/navigation'
import { Button } from '@/registry/new-york/ui/button'
import { Sparkles, Search, PlayCircle, MessageSquareQuote } from 'lucide-react'
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

  const ragStore = useMemo(() => {
    const store = new VideoLocalRagStore()
    store.indexTranscripts(transcripts)
    return store
  }, [transcripts])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    const res = ragStore.search(query, 4)
    setResults(res)
    setSearched(true)
  }

  return (
    <div className="space-y-3 p-3 rounded-lg border bg-card text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <Sparkles className="w-4 h-4 text-primary" />
        <span>端侧 RAG 语义索引与智能伴学 Copilot</span>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        基于内存轻量余弦向量空间模型，输入任何疑问或技术关键词，毫秒级定位讲师对应讲解段落。
      </p>

      {/* Query Input */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input aria-label="向伴学助手提问"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索架构概念，例如: Docker 镜像、K8s 服务、幂等性..."
          className="flex-1 px-3 py-1.5 text-xs rounded-md bg-muted border border-border/50 focus:outline-none"
        />
        <Button size="sm" type="submit" className="gap-1 text-xs">
          <Search className="w-3.5 h-3.5" /> 语义检索
        </Button>
      </form>

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
