'use client'

/**
 * 视频播放页右侧多标签面板（列表 / 章节 / 课件 / 脑图 / 演进 /
 * 疑惑雷达 / 逐字稿 / 笔记 / 历史）。
 * AI 伴学 tab 已并入 AI 学习中心（video-ai-learning-dialog 的「AI伴学」
 * tab），不再是侧栏的独立入口。
 *
 * 2026-11-09 A-2 第一步：从 video-player-page.tsx 原样搬出，纯搬家不改行为；
 * 状态仍由父组件持有，这里只做展示与回调上抛。
 */
import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
import { Button } from "@/registry/new-york/ui/button"
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/registry/new-york/ui/scroll-area'
import { formatDuration } from '@/lib/video-format'
import { Camera, Check, Copy, Download, Play, Sparkles, Captions, Upload } from 'lucide-react'
import { highlightCaptionSegments, type CaptionSource } from '@/lib/video-caption-store'
import {
  chapterStartSec,
  type NavigationSubItem,
  type VideoChapter,
  type VideoDanmakuItem,
  type VideoTranscriptItem,
} from '@/types/navigation'
import { type VideoAISummary } from '@/lib/video-ai-summary'
import { type VideoStudyNote } from '@/lib/video-frame-clipper'
import { type CodeMilestone } from '@/lib/video-code-diff'
import { type MindMapNode } from '@/lib/video-mindmap-generator'
import { useVideoPlayerState } from '@/hooks/useVideoPlayerState'

const VideoSlideDeckViewer = dynamic(() => import('@/components/video-slide-deck-viewer').then(m => m.VideoSlideDeckViewer), { ssr: false })
const VideoMindmapView = dynamic(() => import('@/components/video-mindmap-view').then(m => m.VideoMindmapView), { ssr: false })
const VideoCodeDiffViewer = dynamic(() => import('@/components/video-code-diff-viewer').then(m => m.VideoCodeDiffViewer), { ssr: false })
const VideoConfusionRadar = dynamic(() => import('@/components/video-confusion-radar').then(m => m.VideoConfusionRadar), { ssr: false })

export type VideoPlayerTab =
  | 'playlist' | 'chapters' | 'slides' | 'mindmap' | 'diff'
  | 'radar' | 'transcript' | 'notes' | 'history'

interface VideoPlayerSidePanelProps {
  activeTab: VideoPlayerTab
  setActiveTab: (tab: VideoPlayerTab) => void
  /** 「列表」tab 的内容（由 VideoPlaylistTree 渲染，展开状态归父组件） */
  playlist: ReactNode
  allVideos: NavigationSubItem[]
  selectedVideo: NavigationSubItem | null
  setSelectedVideo: (video: NavigationSubItem | null) => void
  chapters: VideoChapter[]
  aiSummary: VideoAISummary | null
  isLoadingAI: boolean
  handleSeekToChapter: (chapter: VideoChapter) => void
  handleCopyCode: (id: string, code: string) => void
  handleOpenSandbox: (code?: string, lang?: string) => void
  copiedCodeId: string | null
  chapterSeekSec: number | null
  setChapterSeekSec: (sec: number) => void
  mindmapRoot: MindMapNode
  codeMilestones: CodeMilestone[]
  danmakuList: VideoDanmakuItem[]
  transcriptList: VideoTranscriptItem[]
  filteredTranscript: VideoTranscriptItem[]
  transcriptSearchQuery: string
  setTranscriptSearchQuery: (query: string) => void
  handleExportTranscript: () => void
  /** 字幕来源：imported（用户导入）/ builtin（视频自带）/ description / none（无字幕）。 */
  captionSource: CaptionSource
  importedCaptionCount: number
  onOpenCaptionImport: () => void
  notesList: VideoStudyNote[]
  handleExportNotes: () => void
  setShowNoteDialog: (open: boolean) => void
  historyList: ReturnType<typeof useVideoPlayerState>['historyList']
}

export function VideoPlayerSidePanel(props: VideoPlayerSidePanelProps) {
  const {
    activeTab, setActiveTab, playlist, allVideos, selectedVideo,
    setSelectedVideo, chapters, aiSummary, isLoadingAI, handleSeekToChapter, handleCopyCode,
    handleOpenSandbox, copiedCodeId, chapterSeekSec, setChapterSeekSec, mindmapRoot,
    codeMilestones, danmakuList, transcriptList, filteredTranscript,
    transcriptSearchQuery, setTranscriptSearchQuery, handleExportTranscript, captionSource,
    importedCaptionCount, onOpenCaptionImport, notesList,
    handleExportNotes, setShowNoteDialog, historyList,
  } = props

  // 脑图只在有真实章节派生的数据时才有内容（父组件对无真实章节的视频回空根）：
  // 无数据不给入口——标签与面板一并隐藏（2026-11-11 审计第二批）。
  const hasMindmap = (mindmapRoot?.children?.length ?? 0) > 0

  return (
                <div className="hidden md:block w-80 lg:w-96 border-l bg-muted/30">
                    <div className="sticky top-0 p-3 border-b bg-background/95 backdrop-blur flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg text-[11px] w-full overflow-x-auto">
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'playlist' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('playlist')}
                            >
                                列表 ({allVideos.length})
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'chapters' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('chapters')}
                            >
                                章节 ({chapters.length})
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'slides' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('slides')}
                            >
                                课件
                            </button>
                            {hasMindmap && (
                                <button
                                    className={cn(
                                        "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                        activeTab === 'mindmap' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                    )}
                                    onClick={() => setActiveTab('mindmap')}
                                >
                                    脑图
                                </button>
                            )}
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'diff' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('diff')}
                            >
                                演进 ({codeMilestones.length})
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'radar' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('radar')}
                            >
                                疑惑雷达
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'transcript' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('transcript')}
                            >
                                逐字稿
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'notes' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('notes')}
                            >
                                笔记 ({notesList.length})
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'history' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('history')}
                            >
                                历史
                            </button>
                        </div>
                    </div>
                    <ScrollArea className="h-[calc(100vh-7.5rem)]">
                        {activeTab === 'playlist' && (
                            <div className="p-3 space-y-1">
                                {playlist}
                            </div>
                        )}

                        {activeTab === 'chapters' && (
                            <div className="p-3 space-y-3">
                                {aiSummary?.overview && (
                                    <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground leading-relaxed">
                                        <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
                                            <Sparkles className="w-3.5 h-3.5 text-primary" />
                                            <span>{aiSummary.source === 'ai-gemini' ? 'AI 核心摘要' : '本地启发式摘要'}</span>
                                            {aiSummary.source !== 'ai-gemini' && (
                                                <span className="rounded-full border border-amber-500/40 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                                    非 AI 生成 · 按标题与简介推测，非原片内容
                                                </span>
                                            )}
                                        </p>
                                        <p>{aiSummary.overview}</p>
                                    </div>
                                )}
                                {chapters.length === 0 ? (
                                    <div className="text-center py-10 text-xs text-muted-foreground">
                                        {isLoadingAI ? '正在生成智能章节与代码大纲...' : '暂无章节信息'}
                                    </div>
                                ) : (
                                    chapters.map((ch, idx) => (
                                        <div
                                            key={ch.id || `ch-${idx}`}
                                            className="p-2.5 rounded-lg border border-border/50 bg-card hover:border-primary/30 transition-all space-y-2 text-xs"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <button
                                                    onClick={() => handleSeekToChapter(ch)}
                                                    className="font-medium text-left text-foreground hover:text-primary transition-colors flex-1"
                                                >
                                                    {ch.title}
                                                </button>
                                                <button
                                                    onClick={() => handleSeekToChapter(ch)}
                                                    className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted hover:bg-primary hover:text-primary-foreground transition-colors shrink-0"
                                                >
                                                    {formatDuration(chapterStartSec(ch))}
                                                </button>
                                            </div>
                                            {ch.summary && (
                                                <p className="text-[11px] text-muted-foreground leading-snug">
                                                    {ch.summary}
                                                </p>
                                            )}
                                            {ch.codeSnippet && (
                                                <div className="rounded-md bg-zinc-950 p-2 text-zinc-100 font-mono text-[11px] overflow-x-auto relative group">
                                                    <div className="flex items-center justify-between pb-1 border-b border-zinc-800 text-[10px] text-zinc-400">
                                                        <span>{ch.codeLanguage || 'code'}</span>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => handleOpenSandbox(ch.codeSnippet, ch.codeLanguage)}
                                                                className="hover:text-emerald-400 transition-colors flex items-center gap-0.5"
                                                                title="在沙箱中运行"
                                                            >
                                                                <Play className="w-3 h-3 fill-current" /> 沙箱运行
                                                            </button>
                                                            <button
                                                                onClick={() => handleCopyCode(ch.id ?? `ch-${idx}`, ch.codeSnippet!)}
                                                                className="hover:text-white transition-colors"
                                                                title="复制代码"
                                                            >
                                                                {copiedCodeId === ch.id ? (
                                                                    <span className="text-emerald-400 flex items-center gap-0.5"><Check className="w-3 h-3" /> 已复制</span>
                                                                ) : (
                                                                    <span className="flex items-center gap-0.5"><Copy className="w-3 h-3" /> 复制</span>
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <pre className="pt-1.5 whitespace-pre-wrap">{ch.codeSnippet}</pre>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {activeTab === 'slides' && (
                            <div className="p-3">
                                <VideoSlideDeckViewer
                                    chapters={chapters}
                                    currentSec={chapterSeekSec || 0}
                                    onSeek={(sec) => setChapterSeekSec(sec)}
                                    videoTitle={selectedVideo?.title}
                                />
                            </div>
                        )}

                        {activeTab === 'mindmap' && selectedVideo && hasMindmap && (
                            <div className="p-3">
                                <VideoMindmapView
                                    rootNode={mindmapRoot}
                                    onSeek={(sec) => setChapterSeekSec(sec)}
                                    videoTitle={selectedVideo.title}
                                />
                            </div>
                        )}

                        {activeTab === 'diff' && (
                            <div className="p-3">
                                <VideoCodeDiffViewer
                                    milestones={codeMilestones}
                                    onSeek={(sec) => setChapterSeekSec(sec)}
                                />
                            </div>
                        )}





                        {activeTab === 'radar' && (
                            <div className="p-3">
                                <VideoConfusionRadar
                                    danmaku={danmakuList}
                                    onSeek={(sec) => setChapterSeekSec(sec)}
                                />
                            </div>
                        )}

                        {activeTab === 'transcript' && (
                            <div className="p-3 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" role="status">
                                        <Captions className="w-3.5 h-3.5" />
                                        {transcriptList.length > 0
                                            ? captionSource === 'imported'
                                                ? `已导入字幕 · ${importedCaptionCount} 条可搜`
                                                : captionSource === 'builtin'
                                                    ? `自带字幕 · ${transcriptList.length} 条可搜`
                                                    : `字幕 · ${transcriptList.length} 条可搜`
                                            : '无字幕，不可搜'}
                                    </span>
                                    <Button size="sm" variant="outline" className="min-h-11 text-xs px-2 gap-1" onClick={onOpenCaptionImport}>
                                        <Upload className="w-3 h-3" /> 导入字幕
                                    </Button>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <input aria-label="搜索字幕"
                                        type="text"
                                        value={transcriptSearchQuery}
                                        onChange={e => setTranscriptSearchQuery(e.target.value)}
                                        placeholder="搜索字幕与关键词..."
                                        className="flex-1 px-2.5 py-1 text-xs rounded-md bg-card border border-border/50 focus:outline-none"
                                    />
                                    <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={handleExportTranscript} disabled={transcriptList.length === 0}>
                                        <Download className="w-3 h-3" /> 导出
                                    </Button>
                                </div>
                                <div className="space-y-1.5">
                                    {transcriptList.length === 0 ? (
                                        <div className="text-center py-10 px-2 space-y-2">
                                            <p className="text-xs font-medium">无字幕，不可搜</p>
                                            <p className="text-xs text-muted-foreground leading-relaxed">
                                                这条视频没有自带字幕，也没有导入过字幕，所以搜不到里面说过的话。
                                                不会为它自动生成字幕或做语音转写。
                                            </p>
                                            <Button size="sm" variant="outline" className="min-h-11 text-xs" onClick={onOpenCaptionImport}>
                                                <Upload className="w-3.5 h-3.5 mr-1" /> 粘贴或上传 SRT / WebVTT 字幕
                                            </Button>
                                        </div>
                                    ) : filteredTranscript.length === 0 ? (
                                        <p className="text-xs text-muted-foreground text-center py-10">未找到匹配字幕</p>
                                    ) : (
                                        filteredTranscript.map((t) => (
                                            <button
                                                key={t.id}
                                                onClick={() => handleSeekToChapter({ startTime: t.startSec, id: t.id, title: t.text })}
                                                className="w-full text-left p-2 rounded-lg hover:bg-accent/40 border border-transparent hover:border-border/40 transition-all text-xs space-y-0.5 group min-h-11"
                                            >
                                                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                                                    <span>{formatDuration(t.startSec)}</span>
                                                </div>
                                                <p className="text-foreground group-hover:text-primary transition-colors leading-relaxed">
                                                    {transcriptSearchQuery.trim()
                                                        ? highlightCaptionSegments(t.text, transcriptSearchQuery).map((seg, idx) => (
                                                            seg.hit ? <mark key={idx} className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0">{seg.text}</mark> : <span key={idx}>{seg.text}</span>
                                                        ))
                                                        : t.text}
                                                </p>
                                                {t.translation && (
                                                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                                                        {t.translation}
                                                    </p>
                                                )}
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'notes' && (
                            <div className="p-3 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                        共 {notesList.length} 条笔记
                                    </span>
                                    {notesList.length > 0 && (
                                        <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={handleExportNotes}>
                                            <Download className="w-3 h-3" /> 导出 Markdown
                                        </Button>
                                    )}
                                </div>
                                {notesList.length === 0 ? (
                                    <div className="text-center py-12 text-xs text-muted-foreground space-y-2">
                                        <p>暂无本视频的学习笔记与快照</p>
                                        <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowNoteDialog(true)}>
                                            <Camera className="w-3.5 h-3.5 mr-1" /> 立即记录第一条笔记
                                        </Button>
                                    </div>
                                ) : (
                                    notesList.map((n) => (
                                        <div key={n.id} className="p-2.5 rounded-lg border border-border/50 bg-card space-y-2 text-xs">
                                            <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                                                <button
                                                    onClick={() => handleSeekToChapter({ startTime: n.timeSec, id: n.id, title: n.userNote || '笔记锚点' })}
                                                    className="hover:text-primary transition-colors font-semibold"
                                                >
                                                    ⏱️ {formatDuration(n.timeSec)}
                                                </button>
                                                <span className="text-[10px]">{new Date(n.createdAt).toLocaleDateString()}</span>
                                            </div>
                                            <p className="text-foreground leading-relaxed">{n.userNote}</p>
                                            {n.codeSnippet && (
                                                <pre className="p-2 rounded bg-zinc-950 text-zinc-200 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">
                                                    {n.codeSnippet}
                                                </pre>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {activeTab === 'history' && (
                            <div className="p-3 space-y-2">
                                {historyList.length === 0 ? (
                                    <p className="text-xs text-muted-foreground text-center py-12">暂无观看历史记录</p>
                                ) : (
                                    historyList.map(h => (
                                        <button
                                            key={h.videoId}
                                            onClick={() => {
                                                const target = allVideos.find(v => v.id === h.videoId)
                                                if (target) setSelectedVideo(target)
                                            }}
                                            className="w-full text-left p-2.5 rounded-lg border border-border/50 bg-card hover:bg-accent/50 transition-all text-xs space-y-1.5"
                                        >
                                            <p className="font-medium line-clamp-1 text-foreground">{h.title}</p>
                                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                                <span>{h.author}</span>
                                                <span className="font-mono">{formatDuration(h.timestampSec)} / {formatDuration(h.durationSec)}</span>
                                            </div>
                                            <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                                                <div className="h-full bg-primary" style={{ width: `${h.progressPercent}%` }} />
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </ScrollArea>
                </div>
  )
}
