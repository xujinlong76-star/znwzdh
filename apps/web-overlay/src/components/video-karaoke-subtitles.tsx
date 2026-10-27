'use client'

import React, { useState, useMemo } from 'react'
import type { VideoTranscriptItem } from '@/types/navigation'
import {
  buildAlignedBilingualCues,
  findActiveBilingualCue,
  findActiveKaraokeToken,
  lookupTechnicalTerm,
  type TechnicalTermDefinition,
} from '@/lib/video-bilingual-transcriber'
import { Popover, PopoverContent, PopoverTrigger } from '@/registry/new-york/ui/popover'
import { Sparkles, Globe, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoKaraokeSubtitlesProps {
  transcript: VideoTranscriptItem[]
  currentSec: number
  mode?: 'bilingual' | 'source-only' | 'target-only'
  className?: string
}

export function VideoKaraokeSubtitles({
  transcript,
  currentSec,
  mode = 'bilingual',
  className,
}: VideoKaraokeSubtitlesProps) {
  const [activeGlossaryTerm, setActiveGlossaryTerm] = useState<TechnicalTermDefinition | null>(null)

  const cues = useMemo(() => {
    return buildAlignedBilingualCues(transcript)
  }, [transcript])

  const activeCue = useMemo(() => {
    return findActiveBilingualCue(cues, currentSec)
  }, [cues, currentSec])

  const activeToken = useMemo(() => {
    if (!activeCue) return null
    return findActiveKaraokeToken(activeCue, currentSec)
  }, [activeCue, currentSec])

  if (!activeCue) {
    return null
  }

  return (
    <div
      className={cn(
        "px-4 py-2 rounded-xl bg-zinc-950/85 backdrop-blur border border-zinc-800/80 shadow-2xl text-center space-y-1 select-none pointer-events-auto",
        className
      )}
    >
      {/* Source Text with Karaoke glow and Technical Term Tooltip */}
      {(mode === 'bilingual' || mode === 'source-only') && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs md:text-sm font-medium leading-relaxed">
          {activeCue.tokens.map((tok, idx) => {
            const isHighlight = activeToken?.index === idx
            const termDef = tok.isTerm ? lookupTechnicalTerm(tok.word) : null

            if (termDef) {
              return (
                <Popover key={`tok-${idx}`}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "transition-all duration-150 px-1 py-0.5 rounded underline decoration-emerald-500/60 decoration-dashed underline-offset-4 cursor-pointer hover:bg-emerald-500/20",
                        isHighlight
                          ? "text-emerald-300 font-bold scale-105 bg-emerald-500/20 shadow-sm"
                          : "text-zinc-200"
                      )}
                    >
                      {tok.word}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    className="w-72 p-3 bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 shadow-2xl space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-400 flex items-center gap-1">
                        <BookOpen className="w-3.5 h-3.5" />
                        {termDef.term}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono">
                        {termDef.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300 font-medium">
                      {termDef.chineseName}
                    </p>
                    <p className="text-[10px] text-zinc-400 leading-snug">
                      {termDef.summary}
                    </p>
                    <div className="pt-1 border-t border-zinc-800 text-[10px] text-amber-400/90 leading-tight">
                      💡 生产准则: {termDef.bestPractice}
                    </div>
                  </PopoverContent>
                </Popover>
              )
            }

            return (
              <span
                key={`tok-${idx}`}
                className={cn(
                  "transition-all duration-150 px-0.5 rounded",
                  isHighlight
                    ? "text-emerald-400 font-bold scale-105 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                    : "text-zinc-300"
                )}
              >
                {tok.word}
              </span>
            )
          })}
        </div>
      )}

      {/* Target (Chinese) Translation Line */}
      {(mode === 'bilingual' || mode === 'target-only') && (
        <p className="text-[11px] md:text-xs text-zinc-400/90 tracking-wide font-normal">
          {activeCue.targetText}
        </p>
      )}
    </div>
  )
}
