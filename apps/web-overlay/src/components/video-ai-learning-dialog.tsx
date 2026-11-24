'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/registry/new-york/ui/dialog'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavigationData, VideoTranscriptItem } from '@/types/navigation'
import type { FlashcardItem } from '@/lib/video-spaced-repetition'

/**
 * AI 学习中心（C 组第 4 簇：AI 学习三件套只合入口，不删）。
 *
 * 原先三个 AI 学习功能各有自己的顶层入口：侧栏「AI 伴学」tab、
 * 控制条「抽认卡」按钮（仅有卡片时出现）、控制条「概念图谱」按钮
 * （仅自带真实章节的视频出现）。现在只有一个「AI 学习」入口，
 * 打开本中心弹窗，里面三个 tab：
 *   - AI伴学：端侧 RAG 语义检索 Copilot（原侧栏 tab，面板原样搬入）
 *   - 概念图谱：Dijkstra 最短学习路径（原独立 Dialog，内容抽成面板）
 *   - 抽认卡：SM-2 间隔复习（原独立 Dialog，内容抽成面板）
 * 三个功能的逻辑、数据与 gating 原样保留：概念图谱 tab 只在
 * conceptAvailable（当前视频自带真实章节）时出现；抽认卡无卡片时
 * 显示空态。脑图（章节结构视图）不在三件套内，保持不动。
 */
const VideoAssistantCopilot = dynamic(
  () => import('@/components/video-assistant-copilot').then(m => m.VideoAssistantCopilot),
  { ssr: false },
)
const VideoConceptGraphPanel = dynamic(
  () => import('@/components/video-concept-graph-dialog').then(m => m.VideoConceptGraphPanel),
  { ssr: false },
)
const VideoFlashcardPanel = dynamic(
  () => import('@/components/video-flashcard-deck').then(m => m.VideoFlashcardPanel),
  { ssr: false },
)

interface VideoAiLearningDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transcripts: VideoTranscriptItem[]
  onSeek: (sec: number) => void
  navigationData: NavigationData
  onJumpToTarget: (target: { bvid: string; seekSec: number }) => void
  cards: FlashcardItem[]
  videoTitle: string
  /** 概念图谱 tab 的原 gating：仅自带真实章节的视频出现 */
  conceptAvailable: boolean
}

type AiLearningTab = 'copilot' | 'concept' | 'flashcards'

export function VideoAiLearningDialog({
  open,
  onOpenChange,
  transcripts,
  onSeek,
  navigationData,
  onJumpToTarget,
  cards,
  videoTitle,
  conceptAvailable,
}: VideoAiLearningDialogProps) {
  const [tab, setTab] = useState<AiLearningTab>('copilot')

  // A-2：标准 ARIA Tabs 键盘交互。照抄 plugin-detail-view.tsx:143-170
  // 骨架 + A-1 的 disabled 跳过（全量列表保下标映射，步进跳 disabled；
  // 三 tab 当前均无 disabled，step() 是防后人加）。无 .click()、无 URL 同步。
  // 概念图谱 tab 只在 conceptAvailable 时渲染：键盘顺序须与 DOM 里的 tab
  // 一致，故先按 conceptAvailable 过滤，否则下标映射会把焦点与选择错位
  // （1322-w8 §0.1 同款错位：未渲染的 tab 不可进顺序表）。
  const AI_LEARNING_TABS: AiLearningTab[] = ['copilot', 'concept', 'flashcards']
  const visibleTabs = AI_LEARNING_TABS.filter((t) => t !== 'concept' || conceptAvailable)
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'tab') return
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    )
    const index = tabs.indexOf(target as HTMLButtonElement)
    if (index < 0) return

    const enabled = tabs.map((t) => !t.disabled)
    if (!enabled.some(Boolean)) return
    const step = (from: number, dir: 1 | -1): number => {
      let i = from
      for (let n = 0; n < tabs.length; n++) {
        i = (i + dir + tabs.length) % tabs.length
        if (enabled[i]) return i
      }
      return from
    }
    const firstEnabled = enabled.findIndex(Boolean)
    const lastEnabled = enabled.lastIndexOf(true)

    let next = index
    if (event.key === 'ArrowRight') next = step(index, 1)
    else if (event.key === 'ArrowLeft') next = step(index, -1)
    else if (event.key === 'Home') next = firstEnabled
    else if (event.key === 'End') next = lastEnabled
    else return

    event.preventDefault()
    setTab(visibleTabs[next])
    tabs[next]?.focus()
  }

  const tabButton = (id: AiLearningTab, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
        tab === id
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background border-border text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-5">
        <DialogHeader className="space-y-1.5 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="w-5 h-5 text-primary" />
            <span>AI 学习中心</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            AI 伴学检索、概念图谱穿梭与抽认卡复习，三件套合在这一个入口里。
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="AI 学习方式" className="flex gap-1 pt-2 shrink-0" onKeyDown={handleTabKeyDown}>
          {tabButton('copilot', 'AI伴学')}
          {conceptAvailable && tabButton('concept', '概念图谱')}
          {tabButton('flashcards', `抽认卡 (${cards.length})`)}
        </div>

        {tab === 'copilot' && (
          <div className="flex-1 overflow-y-auto py-2">
            <VideoAssistantCopilot transcripts={transcripts} onSeek={onSeek} />
          </div>
        )}
        {tab === 'concept' && conceptAvailable && (
          <div className="flex-1 overflow-y-auto py-2 pr-1">
            <VideoConceptGraphPanel
              navigationData={navigationData}
              onJumpToTarget={onJumpToTarget}
              onClose={() => onOpenChange(false)}
            />
          </div>
        )}
        {tab === 'flashcards' && (
          <div className="flex-1 overflow-y-auto py-2 pr-1">
            <VideoFlashcardPanel cards={cards} videoTitle={videoTitle} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
