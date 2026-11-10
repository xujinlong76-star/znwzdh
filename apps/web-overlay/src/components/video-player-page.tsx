'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { safeHref } from '@/lib/safe-url'
import { jsonLdScript } from '@/lib/seo/json-ld'
import { buildVideoEmbedUrlForSeo } from '@/lib/video-seo'
import { VIDEO_PLATFORM_REGISTRY } from '@/lib/video-platform-registry'
import {
  chapterStartSec,
  type NavigationData,
  type NavigationSubItem,
  type VideoChapter,
  type VideoMirrorSource,
  type VideoDanmakuItem,
  type VideoTranscriptItem,
} from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { ModeToggle } from '@/components/mode-toggle'
import {
  ChevronRight,
  PlayCircle,
  Home,
  LayoutGrid,
  List,
  History,
  RotateCcw,
  Keyboard,
  X,
  Code,
  Copy,
  PictureInPicture,
  Sparkles,
  Camera,
  MessageSquare,
  AlertTriangle,
  Send,
  Download,
  Volume2,
  Users,
  Sliders,
  Wand2,
  GraduationCap,
  Radio,
  Eye,
  Trophy,
  Bug,
  Presentation,
  Hand,
  Box,
} from 'lucide-react'
import { Button } from "@/registry/new-york/ui/button"
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/registry/new-york/ui/scroll-area'
import { formatDuration } from '@/lib/video-format'
import { useVideoPlayerState } from '@/hooks/useVideoPlayerState'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { resolveAvailableMirrors, selectBestMirror, recordMirrorFailover } from '@/lib/video-failover'
import { getVideoAISummary, type VideoAISummary } from '@/lib/video-ai-summary'
import { isInWatchLater, toggleWatchLater, PLAYLIST_UPDATE_EVENT } from '@/lib/user-playlists'
import { getRelatedVideos } from '@/lib/video-recommendation'
import { useVideoPlayer } from '@/contexts/VideoPlayerContext'
import { parseWebVTT, searchTranscript, exportTranscriptAsMarkdown } from '@/lib/video-transcript-sync'
import { saveStudyNote, listStudyNotes, exportNotesAsMarkdown, type VideoStudyNote } from '@/lib/video-frame-clipper'
import { getStoredDanmaku, saveDanmakuItem } from '@/lib/video-danmaku-engine'
// 未使用但不可删：这是 p2p-stream-loader 在 src 内的唯一引用点，删掉即触发
// check-dead-modules 判红（测试引用不计入 src 图）；实测删除还会让 Turbopack
// 的 chunk 切分变差，/videos/player 从 882 KB 涨回 884 KB。
import { getP2PStreamCoordinator } from '@/lib/p2p-stream-loader'
// 语音指示器是辅助可视化：动态导入，不占播放器首屏包体积（预算紧）。
const VideoVoiceIndicator = dynamic(() => import('@/components/video-voice-indicator').then(m => m.VideoVoiceIndicator), { ssr: false })
import { VideoNetworkSentinel } from '@/components/video-network-sentinel'
// 涂鸦层与 PiP 渲染层只在对应模式开启时才用到：动态导入，不占播放器首屏包体积。
const VideoTelestratorCanvas = dynamic(() => import('@/components/video-telestrator-canvas').then(m => m.VideoTelestratorCanvas), { ssr: false })
const VideoPipWindowRenderer = dynamic(() => import('@/components/video-pip-window-renderer').then(m => m.VideoPipWindowRenderer), { ssr: false })
// 手势 HUD 只在手势模式下显示：动态导入补足播放器页最后一点预算缺口。
const VideoGestureHudOverlay = dynamic(() => import('@/components/video-gesture-hud-overlay').then(m => m.VideoGestureHudOverlay), { ssr: false })
import { SessionActivityRecorder } from '@/lib/video-session-recorder'
import { type SilenceDetectorConfig, type SilenceDetectorState } from '@/lib/video-silence-detector'
// 只留类型（编译期擦除）：generateSvgFilterMarkup 在本页从未被调用，而它会
// 把 @/lib/video-a11y-sight-guard 整个模块钉进本页首屏图。该模块仍被
// video-a11y-settings-dialog（dynamic 组件）引用，故不会变成零引用死模块。
import { type A11ySightGuardSettings } from '@/lib/video-a11y-sight-guard'
import { extractCodeMilestones, type CodeMilestone } from '@/lib/video-code-diff'
import { type AudioEnhancerOptions } from '@/lib/video-audio-enhancer'
import { joinCoWatchRoom, type CoWatchSession, type CoWatchState } from '@/lib/video-crdt-room'
import { generateVideoQuizzes, type VideoQuizQuestion } from '@/lib/video-quiz-generator'
import { generateVideoMindMap, type MindMapNode } from '@/lib/video-mindmap-generator'
import { generateVideoObjectSchema } from '@/lib/video-seo'
import { createQoETracker, type QoEMetrics } from '@/lib/video-qoe-telemetry'
// 同上：calculatePrefetchQueue 未被调用，但它与 p2p-stream-loader 都是各自模块在
// src 内的唯一引用点，删掉即触发 check-dead-modules 判红（测试引用不计入 src 图）。
import { calculatePrefetchQueue } from '@/lib/video-cache-manager'
import { generateFlashcardsFromNotes, generateFlashcardsFromQuizzes, type FlashcardItem } from '@/lib/video-spaced-repetition'
import { type VoiceCommandIntent } from '@/lib/video-voice-commander'
import { copyText } from '@/lib/clipboard'
import { VideoPlayerSidePanel, type VideoPlayerTab } from '@/components/video-player-side-panel'
import { VideoPlayerControlBar } from '@/components/video-player-control-bar'
import { VideoPlaylistTree } from '@/components/video-playlist-tree'

/**
 * 按需加载面：这些组件只在对应 tab 激活或弹窗 open 后才真正渲染，
 * 静态 import 会把整棵播放器 UI 树塞进首屏 chunk（实测 +200KB / 预算红线）。
 * ssr:false 对纯客户端面板无副作用；首帧它们本来就是「关闭/未激活」。
 */
const VideoCodeSandbox = dynamic(() => import('@/components/video-code-sandbox').then(m => m.VideoCodeSandbox), { ssr: false })
const VideoQuizDialog = dynamic(() => import('@/components/video-quiz-dialog').then(m => m.VideoQuizDialog), { ssr: false })
const VideoSharePosterDialog = dynamic(() => import('@/components/video-share-poster-dialog').then(m => m.VideoSharePosterDialog), { ssr: false })
const VideoFlashcardDeck = dynamic(() => import('@/components/video-flashcard-deck').then(m => m.VideoFlashcardDeck), { ssr: false })
const VideoCertificateDialog = dynamic(() => import('@/components/video-certificate-dialog').then(m => m.VideoCertificateDialog), { ssr: false })
const VideoOfflineManager = dynamic(() => import('@/components/video-offline-manager').then(m => m.VideoOfflineManager), { ssr: false })
const VideoSmartSpeedDialog = dynamic(() => import('@/components/video-smart-speed-controls').then(m => m.VideoSmartSpeedDialog), { ssr: false })
const VideoFrameOcrDialog = dynamic(() => import('@/components/video-frame-ocr-overlay').then(m => m.VideoFrameOcrDialog), { ssr: false })
const VideoA11ySettingsDialog = dynamic(() => import('@/components/video-a11y-settings-dialog').then(m => m.VideoA11ySettingsDialog), { ssr: false })
const VideoSkillTreeDialog = dynamic(() => import('@/components/video-skill-tree-dialog').then(m => m.VideoSkillTreeDialog), { ssr: false })
const VideoWorkspaceExportDialog = dynamic(() => import('@/components/video-workspace-export-dialog').then(m => m.VideoWorkspaceExportDialog), { ssr: false })
const VideoBilingualSubtitlesDialog = dynamic(() => import('@/components/video-bilingual-subtitles-dialog').then(m => m.VideoBilingualSubtitlesDialog), { ssr: false })
const VideoSessionReplayDialog = dynamic(() => import('@/components/video-session-replay-dialog').then(m => m.VideoSessionReplayDialog), { ssr: false })
const VideoClipMakerDialog = dynamic(() => import('@/components/video-clip-maker-dialog').then(m => m.VideoClipMakerDialog), { ssr: false })
const VideoPomodoroDialog = dynamic(() => import('@/components/video-pomodoro-overlay').then(m => m.VideoPomodoroDialog), { ssr: false })
const VideoAdaptiveRemedyDialog = dynamic(() => import('@/components/video-adaptive-remedy-dialog').then(m => m.VideoAdaptiveRemedyDialog), { ssr: false })
const VideoAutoHarvestDialog = dynamic(() => import('@/components/video-auto-harvest-dialog').then(m => m.VideoAutoHarvestDialog), { ssr: false })
const VideoAutonomousHarvestConsole = dynamic(() => import('@/components/video-autonomous-harvest-console').then(m => m.VideoAutonomousHarvestConsole), { ssr: false })
const VideoMultisourceWebhookDialog = dynamic(() => import('@/components/video-multisource-webhook-dialog').then(m => m.VideoMultisourceWebhookDialog), { ssr: false })
const VideoOcrCodeExtractorDialog = dynamic(() => import('@/components/video-ocr-code-extractor-dialog').then(m => m.VideoOcrCodeExtractorDialog), { ssr: false })
const VideoBilingualTtsDialog = dynamic(() => import('@/components/video-bilingual-tts-dialog').then(m => m.VideoBilingualTtsDialog), { ssr: false })
const VideoConceptGraphDialog = dynamic(() => import('@/components/video-concept-graph-dialog').then(m => m.VideoConceptGraphDialog), { ssr: false })
const VideoCrdtStudyRoomDialog = dynamic(() => import('@/components/video-crdt-study-room-dialog').then(m => m.VideoCrdtStudyRoomDialog), { ssr: false })
// 播放器只在 bilibili 分支挂载、字幕只在有转写稿时挂载：这两块移出首屏图
const VideoBilibiliHdPlayer = dynamic(() => import('@/components/video-bilibili-hd-player').then(m => m.VideoBilibiliHdPlayer), { ssr: false })
const VideoKaraokeSubtitles = dynamic(() => import('@/components/video-karaoke-subtitles').then(m => m.VideoKaraokeSubtitles), { ssr: false })

interface VideoPlayerPageProps {
    navigationData: NavigationData
    siteData: SiteConfig
}

export function VideoPlayerPage({ navigationData }: VideoPlayerPageProps) {
    const [selectedVideo, setSelectedVideo] = useState<NavigationSubItem | null>(null)
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
    const [expandedSubCategories, setExpandedSubCategories] = useState<Set<string>>(new Set())
    const [activeTab, setActiveTab] = useState<VideoPlayerTab>('playlist')
    const [chapters, setChapters] = useState<VideoChapter[]>([])
    const [aiSummary, setAiSummary] = useState<VideoAISummary | null>(null)
    const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false)
    const [activeMirror, setActiveMirror] = useState<VideoMirrorSource | null>(null)
    const [availableMirrors, setAvailableMirrors] = useState<VideoMirrorSource[]>([])
    const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null)
    const [inWatchLater, setInWatchLater] = useState(false)
    const [currentTimeSec, setCurrentTimeSec] = useState<number>(0)
    const [chapterSeekSec, setChapterSeekSec] = useState<number | null>(null)
    const [biliEngine, setBiliEngine] = useState<string>('auto')
    const [showPosterDialog, setShowPosterDialog] = useState<boolean>(false)

    // 艾宾浩斯复习抽认卡与结业证书
    const [showFlashcardsDialog, setShowFlashcardsDialog] = useState<boolean>(false)
    const [showCertDialog, setShowCertDialog] = useState<boolean>(false)

    // 进阶扩展：涂鸦画板、离线缓存、智能加速、画面 OCR、无障碍视力守护、技能树
    const [showTelestrator, setShowTelestrator] = useState<boolean>(false)
    const [showOfflineDialog, setShowOfflineDialog] = useState<boolean>(false)
    const [showSmartSpeedDialog, setShowSmartSpeedDialog] = useState<boolean>(false)
    const [smartSpeedConfig, setSmartSpeedConfig] = useState<SilenceDetectorConfig>({
        enabled: false,
        silenceThresholdDb: -42,
        minSilenceDurationMs: 400,
        baseRate: 1.0,
        skipRate: 2.5,
        smoothingFactor: 0.25,
    })
    const [smartSpeedState, setSmartSpeedState] = useState<SilenceDetectorState>({
        currentLoudnessDb: -100,
        isSilent: false,
        currentDynamicRate: 1.0,
        silenceDurationMs: 0,
        totalTimeSavedSec: 0,
    })
    const [showOcrDialog, setShowOcrDialog] = useState<boolean>(false)
    const [showA11yDialog, setShowA11yDialog] = useState<boolean>(false)
    const [a11ySettings, setA11ySettings] = useState<A11ySightGuardSettings>({
        colorMode: 'normal',
        fontSizeScale: 1.0,
        dyslexicFont: false,
        screenReaderAnnouncements: true,
        keyboardFocusOutline: true,
    })
    const [showSkillTreeDialog, setShowSkillTreeDialog] = useState<boolean>(false)

    // 扩展前沿：工程包导出、双语字幕、会话时空漫游
    const [showWorkspaceExportDialog, setShowWorkspaceExportDialog] = useState<boolean>(false)
    const [showBilingualSubtitlesDialog, setShowBilingualSubtitlesDialog] = useState<boolean>(false)
    const [showSessionReplayDialog, setShowSessionReplayDialog] = useState<boolean>(false)
    const sessionRecorderRef = useRef<SessionActivityRecorder>(new SessionActivityRecorder('init'))

    // 微知识点切片、深度专注番茄钟
    const [showClipMakerDialog, setShowClipMakerDialog] = useState<boolean>(false)
    const [showPomodoroDialog, setShowPomodoroDialog] = useState<boolean>(false)

    // 演进模块：空间手势、自适应弱项诊断、全网热点自动采集
    const [gestureControlEnabled, setGestureControlEnabled] = useState<boolean>(false)
    const [showRemedyDialog, setShowRemedyDialog] = useState<boolean>(false)
    const [showAutoHarvestDialog, setShowAutoHarvestDialog] = useState<boolean>(false)
    const [showAutonomousHarvestConsole, setShowAutonomousHarvestConsole] = useState<boolean>(false)
    const [showWebhookDialog, setShowWebhookDialog] = useState<boolean>(false)
    const [showWasmOcrDialog, setShowWasmOcrDialog] = useState<boolean>(false)
    const [showBilingualTtsDialog, setShowBilingualTtsDialog] = useState<boolean>(false)
    const [showConceptGraphDialog, setShowConceptGraphDialog] = useState<boolean>(false)
    const [showStudyRoomDialog, setShowStudyRoomDialog] = useState<boolean>(false)
    const [sandboxInitialCode, setSandboxInitialCode] = useState<string>('')

    // QoE 传输质量遥测
    const [qoeMetrics, setQoEMetrics] = useState<QoEMetrics>(() => {
        const tracker = createQoETracker(selectedVideo?.id || 'init', activeMirror?.id || 'mirror-1')
        return tracker.getMetrics()
    })

    useEffect(() => {
        if (!selectedVideo) return
        const tracker = createQoETracker(selectedVideo.id, activeMirror?.id || 'mirror-primary')
        setQoEMetrics(tracker.getMetrics())
        const timer = setInterval(() => {
            tracker.recordPlaybackTick(2000)
            setQoEMetrics(tracker.getMetrics())
        }, 3000)
        return () => clearInterval(timer)
    }, [selectedVideo, activeMirror])

    const handleAutoFailover = () => {
        if (availableMirrors.length > 1) {
            const next = availableMirrors.find(m => m.id !== activeMirror?.id)
            if (next) {
                handleSwitchMirror(next.id)
            }
        }
    }

    /**
     * 本视频是否自带真实章节（目录数据，全库 6007 条仅 23 条有）。
     * 没有时 chapters 状态会被 AI 摘要的启发式章节顶上——那是按标题套模板
     * 编的，拿它出测验/脑图/证书等于把编造当课程内容（2026-11-11 审计
     * 第二批「无数据不给入口」）。以下三个派生与对应入口都以此为闸。
     */
    const hasRealChapters = (selectedVideo?.videoConfig?.chapters?.length ?? 0) > 0

    // 1. 代码演进 Milestones
    const codeMilestones = useMemo<CodeMilestone[]>(() => {
        return extractCodeMilestones(chapters)
    }, [chapters])

    // 2. 知识图谱脑图 Root
    const mindmapRoot = useMemo<MindMapNode>(() => {
        if (!selectedVideo) {
            return {
                id: 'empty',
                title: '暂无视频',
                type: 'root',
                children: []
            }
        }
        if (!hasRealChapters) {
            return { id: 'empty', title: selectedVideo.title, type: 'root' as const, children: [] }
        }
        return generateVideoMindMap({
            videoId: selectedVideo.id,
            title: selectedVideo.title,
            chapters,
            tags: [selectedVideo.videoConfig?.type || 'tech']
        })
    }, [selectedVideo, chapters])

    // 3. 互动测验与通关门禁
    const [showQuizDialog, setShowQuizDialog] = useState<boolean>(false)
    const quizQuestions = useMemo<VideoQuizQuestion[]>(() => {
        // 只对自带真实章节的视频出题：题目按章节标题套模板生成，章节本身
        // 若是启发式编的，题目必然与视频内容无关（审计 #106）。
        if (!selectedVideo || !hasRealChapters) return []
        return generateVideoQuizzes(selectedVideo.id, chapters, selectedVideo.title)
    }, [selectedVideo, chapters, hasRealChapters])

    // 4. WebAudio 信号处理实验室
    const [showAudioDialog, setShowAudioDialog] = useState<boolean>(false)
    const [audioOptions, setAudioOptions] = useState<AudioEnhancerOptions>({
        voiceClarity: false,
        loudnessNormalization: false,
        volumeBoost: 1.0,
        noiseSuppression: false,
        lowCut: false,
    })

    // 5. CRDT 协同共赏房间
    const [showCoWatchDialog, setShowCoWatchDialog] = useState<boolean>(false)
    const [coWatchRoomId, setCoWatchRoomId] = useState<string>('')
    const [coWatchSession, setCoWatchSession] = useState<CoWatchSession | null>(null)
    const [coWatchState, setCoWatchState] = useState<CoWatchState | null>(null)

    // 6. Schema.org VideoObject JSON-LD
    const videoSchema = useMemo(() => {
        if (!selectedVideo) return null
        return generateVideoObjectSchema(
            selectedVideo,
            typeof window !== 'undefined' ? window.location.origin : 'https://localhost:3000'
        )
    }, [selectedVideo])

    // 代码演练沙箱与笔记剪藏
    const [showSandbox, setShowSandbox] = useState<boolean>(false)
    const [sandboxCode, setSandboxCode] = useState<string>('// 在此演练代码\nconsole.log("DevOps code sandbox running...");')
    const [sandboxLang, setSandboxLang] = useState<string>('javascript')
    const [notesList, setNotesList] = useState<VideoStudyNote[]>([])
    const [showNoteDialog, setShowNoteDialog] = useState<boolean>(false)
    const [newNoteText, setNewNoteText] = useState<string>('')

    // 弹幕与避坑路标
    const [danmakuList, setDanmakuList] = useState<VideoDanmakuItem[]>([])
    const [newDanmakuText, setNewDanmakuText] = useState<string>('')
    const [isPitfallDanmaku, setIsPitfallDanmaku] = useState<boolean>(false)
    const [isDanmakuOpen, setIsDanmakuOpen] = useState<boolean>(true)

    // 逐字稿音视频字幕
    const [transcriptList, setTranscriptList] = useState<VideoTranscriptItem[]>([])
    const [transcriptSearchQuery, setTranscriptSearchQuery] = useState<string>('')

    const { openVideo: openGlobalVideo, minimizeToFloat, requestDocumentPiP } = useVideoPlayer()

    // 扁平化所有有效视频列表供上一集/下一集与进度连播
    const allVideos = useMemo(() => {
        const list: NavigationSubItem[] = []
        for (const cat of navigationData.navigationItems || []) {
            if (cat.enabled === false) continue
            for (const it of cat.items || []) {
                if (it.videoConfig && it.enabled !== false) list.push(it)
            }
            for (const sub of cat.subCategories || []) {
                if (sub.enabled === false) continue
                for (const it of sub.items || []) {
                    if (it.videoConfig && it.enabled !== false) list.push(it)
                }
            }
        }
        return list
    }, [navigationData])

    const currentIndex = allVideos.findIndex(v => v.id === selectedVideo?.id)

    const handleNextVideo = useCallback(() => {
        if (currentIndex >= 0 && currentIndex < allVideos.length - 1) {
            setSelectedVideo(allVideos[currentIndex + 1])
        }
    }, [currentIndex, allVideos])

    const handlePrevVideo = useCallback(() => {
        if (currentIndex > 0) {
            setSelectedVideo(allVideos[currentIndex - 1])
        }
    }, [currentIndex, allVideos])

    const {
        resumePrompt,
        dismissResumePrompt,
        historyList,
        showShortcutHelp,
        setShowShortcutHelp
    } = useVideoPlayerState({
        video: selectedVideo,
        categoryTitle: '视频中心',
        onNextVideo: handleNextVideo,
        onPrevVideo: handlePrevVideo
    })

    // 艾宾浩斯复习抽认卡集
    const flashcards = useMemo<FlashcardItem[]>(() => {
        const fromNotes = generateFlashcardsFromNotes(notesList)
        const fromQuiz = generateFlashcardsFromQuizzes(quizQuestions)
        return [...fromNotes, ...fromQuiz]
    }, [notesList, quizQuestions])

    // 语音自然语言指令调度器
    const handleVoiceCommand = useCallback((cmd: VoiceCommandIntent) => {
        switch (cmd.action) {
            case 'play':
                break
            case 'pause':
                break
            case 'seek_relative':
                if (cmd.value !== undefined) {
                    setChapterSeekSec(prev => Math.max(0, (prev || 0) + (cmd.value || 0)))
                }
                break
            case 'seek_absolute':
                if (cmd.value !== undefined) {
                    setChapterSeekSec(cmd.value)
                }
                break
            case 'speed':
                break
            case 'mute':
                break
            case 'unmute':
                break
            case 'toggle_danmaku':
                setIsDanmakuOpen(prev => !prev)
                break
            case 'open_tab':
                if (cmd.targetTab) {
                    setActiveTab(cmd.targetTab as any)
                }
                break
            case 'search_transcript':
                if (cmd.searchQuery) {
                    setActiveTab('transcript')
                    setTranscriptSearchQuery(cmd.searchQuery)
                }
                break
            case 'next_video':
                handleNextVideo()
                break
            case 'prev_video':
                handlePrevVideo()
                break
        }
    }, [handleNextVideo, handlePrevVideo, setTranscriptSearchQuery])

    // 默认选择第一个视频
    useEffect(() => {
        if (!selectedVideo) {
            for (const category of navigationData.navigationItems) {
                if (category.items && category.items.length > 0) {
                    const firstVideoItem = category.items.find(item => item.videoConfig)
                    if (firstVideoItem) {
                        setSelectedVideo(firstVideoItem)
                        setExpandedCategories(new Set([category.id]))
                        return
                    }
                }
                if (category.subCategories) {
                    for (const sub of category.subCategories) {
                        if (sub.items && sub.items.length > 0) {
                            const firstVideoItem = sub.items.find(item => item.videoConfig)
                            if (firstVideoItem) {
                                setSelectedVideo(firstVideoItem)
                                setExpandedCategories(new Set([category.id]))
                                setExpandedSubCategories(new Set([sub.id]))
                                return
                            }
                        }
                    }
                }
            }
        }
    }, [navigationData, selectedVideo])

    // 多源镜像切换与 AI 章节/摘要加载
    useEffect(() => {
        if (!selectedVideo || !selectedVideo.videoConfig) return

        setInWatchLater(isInWatchLater(selectedVideo.id))

        const mirrors = resolveAvailableMirrors(selectedVideo.videoConfig)
        setAvailableMirrors(mirrors)
        const best = selectBestMirror(mirrors)
        setActiveMirror(best)
        setChapterSeekSec(null)

        sessionRecorderRef.current = new SessionActivityRecorder(selectedVideo.id)
        sessionRecorderRef.current.recordEvent('play', 0)

        if (selectedVideo.videoConfig.chapters && selectedVideo.videoConfig.chapters.length > 0) {
            setChapters(selectedVideo.videoConfig.chapters)
        } else {
            setIsLoadingAI(true)
            getVideoAISummary({
                videoId: selectedVideo.id,
                title: selectedVideo.title,
                description: selectedVideo.description,
                durationSec: selectedVideo.videoConfig.durationSec || 600,
            }).then(summary => {
                setAiSummary(summary)
                if (summary?.chapters) {
                    setChapters(summary.chapters)
                }
            }).catch(() => {
                // ignore
            }).finally(() => {
                setIsLoadingAI(false)
            })
        }

        // 4. Notes & Danmaku & Transcript
        setNotesList(listStudyNotes(selectedVideo.id))
        const storedDanmaku = getStoredDanmaku(selectedVideo.id)
        setDanmakuList([
            ...(selectedVideo.videoConfig.danmaku || []),
            ...storedDanmaku,
        ])

        if (selectedVideo.videoConfig.transcript && selectedVideo.videoConfig.transcript.length > 0) {
            setTranscriptList(selectedVideo.videoConfig.transcript)
        } else {
            const parsed = parseWebVTT(selectedVideo.description || '')
            if (parsed.length > 0) {
                setTranscriptList(parsed)
            } else {
                // 无字幕就如实无字幕（2026-11-10 审计）：旧实现写死 3 句通用
                // 文案冒充字幕，下游双语/卡拉OK/切片都在消费这份假字幕。
                // 全站仅 11/6007 个视频自带真字幕，其余宁可空着并由 UI
                // 呈现「暂无字幕」，也不编造台词。
                setTranscriptList([])
            }
        }
    }, [selectedVideo])

    useEffect(() => {
        const handlePlaylistUpdate = () => {
            if (selectedVideo) {
                setInWatchLater(isInWatchLater(selectedVideo.id))
            }
        }
        if (typeof window !== 'undefined') {
            window.addEventListener(PLAYLIST_UPDATE_EVENT, handlePlaylistUpdate)
            return () => window.removeEventListener(PLAYLIST_UPDATE_EVENT, handlePlaylistUpdate)
        }
    }, [selectedVideo])

    const currentCategoryContext = useMemo(() => {
        if (!selectedVideo) return { category: null, subCategory: null }
        for (const cat of navigationData.navigationItems || []) {
            if (cat.items?.some(it => it.id === selectedVideo.id)) {
                return { category: cat, subCategory: null }
            }
            for (const sub of cat.subCategories || []) {
                if (sub.items?.some(it => it.id === selectedVideo.id)) {
                    return { category: cat, subCategory: sub }
                }
            }
        }
        return { category: null, subCategory: null }
    }, [navigationData, selectedVideo])

    const relatedVideos = useMemo(() => {
        if (!selectedVideo) return []
        return getRelatedVideos(selectedVideo, allVideos, 4)
    }, [selectedVideo, allVideos])

    const filteredTranscript = useMemo(() => {
        if (!transcriptSearchQuery.trim()) return transcriptList
        return searchTranscript(transcriptList, transcriptSearchQuery).map(r => r.item)
    }, [transcriptList, transcriptSearchQuery])

    const handleSwitchMirror = (mirrorId: string) => {
        const target = availableMirrors.find(m => m.id === mirrorId)
        if (target && selectedVideo) {
            if (activeMirror) {
                recordMirrorFailover(
                    selectedVideo.id,
                    activeMirror.id,
                    target.id,
                    'User manual switch in player'
                )
            }
            setActiveMirror(target)
        }
    }

    const handleCopyCode = (id: string, code: string) => {
        void copyText(code).then((result) => {
            if (!result.ok) return
            setCopiedCodeId(id)
            setTimeout(() => setCopiedCodeId(null), 2000)
        })
    }

    const handleToggleWatchLater = () => {
        if (!selectedVideo) return
        const added = toggleWatchLater(selectedVideo)
        setInWatchLater(added)
    }

    const handleSeekToChapter = (chapter: VideoChapter) => {
        setChapterSeekSec(chapterStartSec(chapter))
    }

    const handleOpenSandbox = (code?: string, lang?: string) => {
        if (code) setSandboxCode(code)
        if (lang) setSandboxLang(lang)
        setShowSandbox(true)
    }

    const handleSaveNote = () => {
        if (!selectedVideo || !newNoteText.trim()) return
        const note: VideoStudyNote = {
            id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            videoId: selectedVideo.id,
            videoTitle: selectedVideo.title,
            timeSec: currentTimeSec || chapterSeekSec || 0,
            userNote: newNoteText.trim(),
            codeSnippet: sandboxCode.includes('DevOps code sandbox running') ? undefined : sandboxCode,
            createdAt: new Date().toISOString(),
        }
        saveStudyNote(note)
        setNotesList(listStudyNotes(selectedVideo.id))
        setNewNoteText('')
        setShowNoteDialog(false)
        setActiveTab('notes')
    }

    const handleSendDanmaku = (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        if (!selectedVideo || !newDanmakuText.trim()) return
        const created = saveDanmakuItem(selectedVideo.id, {
            timeSec: currentTimeSec || chapterSeekSec || 0,
            text: newDanmakuText.trim(),
            isPitfallWarning: isPitfallDanmaku,
            color: isPitfallDanmaku ? '#f97316' : '#ffffff',
            author: '当前用户',
        })
        setDanmakuList(prev => [...prev, created])
        setNewDanmakuText('')
    }

    const handleExportNotes = () => {
        if (!selectedVideo) return
        const md = exportNotesAsMarkdown(notesList, selectedVideo.title)
        const blob = new Blob([md], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${selectedVideo.title}-学习笔记.md`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleExportTranscript = () => {
        if (!selectedVideo) return
        const md = exportTranscriptAsMarkdown(transcriptList, selectedVideo.title)
        const blob = new Blob([md], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${selectedVideo.title}-文字稿.md`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleJoinCoWatch = (targetRoomId: string) => {
        if (!selectedVideo || !targetRoomId.trim()) return
        if (coWatchSession) {
            coWatchSession.leave()
        }
        const session = joinCoWatchRoom({
            roomId: targetRoomId.trim(),
            videoId: selectedVideo.id,
            onStateUpdate: (state) => {
                setCoWatchState(state)
            },
            onNoteUpdate: () => {
                setNotesList(listStudyNotes(selectedVideo.id))
            }
        })
        setCoWatchSession(session)
    }

    const handleLeaveCoWatch = () => {
        if (coWatchSession) {
            coWatchSession.leave()
            setCoWatchSession(null)
            setCoWatchState(null)
        }
    }

    useEffect(() => {
        return () => {
            if (coWatchSession) {
                coWatchSession.leave()
            }
        }
    }, [coWatchSession])

    const toggleCategory = (categoryId: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev)
            if (next.has(categoryId)) {
                next.delete(categoryId)
            } else {
                next.add(categoryId)
            }
            return next
        })
    }

    const toggleSubCategory = (subCategoryId: string) => {
        setExpandedSubCategories(prev => {
            const next = new Set(prev)
            if (next.has(subCategoryId)) {
                next.delete(subCategoryId)
            } else {
                next.add(subCategoryId)
            }
            return next
        })
    }

    const renderVideoPlayer = () => {
        if (!selectedVideo?.videoConfig) {
            return (
                <div className="w-full aspect-video bg-zinc-900 rounded-xl flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                        <PlayCircle className="w-16 h-16 mx-auto mb-4 opacity-30" />
                        <p>请从右侧列表选择视频播放</p>
                    </div>
                </div>
            )
        }

        const platform = activeMirror?.platform || selectedVideo.videoConfig.type
        const sourceId = activeMirror?.sourceId || selectedVideo.videoConfig.bvid || selectedVideo.videoConfig.videoId || ''

        if (platform === 'bilibili') {
            const isAid = /^\d+$/.test(sourceId)
            const resolvedBvid = !isAid ? (sourceId || selectedVideo.videoConfig.bvid) : undefined
            const resolvedAid = isAid ? sourceId : selectedVideo.videoConfig.aid

            return (
                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                    <VideoBilibiliHdPlayer
                        key={`${selectedVideo.id}-${activeMirror?.id || 'primary'}`}
                        bvid={resolvedBvid}
                        aid={resolvedAid}
                        cid={selectedVideo.videoConfig.cid}
                        p={selectedVideo.videoConfig.p || 1}
                        title={selectedVideo.title}
                        poster={selectedVideo.icon}
                        autoPlay={true}
                        seekSec={chapterSeekSec}
                        preferredEngine={biliEngine}
                        onEngineChange={(eng) => setBiliEngine(eng)}
                        onTimeUpdateSec={(curSec) => {
                            setCurrentTimeSec(Math.floor(curSec))
                        }}
                        className="w-full h-full"
                    />
                </div>
            )
        }

        if (platform === 'youtube') {
            let src = `https://www.youtube.com/embed/${sourceId}?autoplay=1`
            if (chapterSeekSec !== null && chapterSeekSec > 0) {
                src += `&start=${chapterSeekSec}`
            }
            return (
                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                    <iframe
                        key={`${selectedVideo.id}-${activeMirror?.id || 'primary'}-${chapterSeekSec || 0}`}
                        className="w-full h-full"
                        src={src}
                        title={selectedVideo.title}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    ></iframe>
                </div>
            )
        }

        const embedUrl =
            buildVideoEmbedUrlForSeo({
                ...selectedVideo.videoConfig,
                type: platform,
                videoId: sourceId,
            }) || (platform === 'custom' ? safeHref(sourceId || selectedVideo.href) : undefined)

        if (embedUrl && /\.(mp4|webm|ogg)(\?.*)?$/i.test(embedUrl)) {
            return (
                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                    <video
                        key={`${selectedVideo.id}-${activeMirror?.id || 'direct'}`}
                        src={embedUrl}
                        poster={selectedVideo.icon}
                        controls
                        autoPlay
                        playsInline
                        className="w-full h-full object-contain"
                        onTimeUpdate={(e) => setCurrentTimeSec(Math.floor(e.currentTarget.currentTime))}
                    />
                </div>
            )
        }

        if (embedUrl) {
            return (
                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                    <iframe
                        key={`${selectedVideo.id}-${activeMirror?.id || platform}`}
                        className="w-full h-full"
                        src={embedUrl}
                        title={selectedVideo.title}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                    ></iframe>
                </div>
            )
        }

        const platformMeta = VIDEO_PLATFORM_REGISTRY[platform] || VIDEO_PLATFORM_REGISTRY.custom
        return (
            <div className="w-full aspect-video bg-slate-950 rounded-xl overflow-hidden shadow-2xl flex flex-col items-center justify-center p-6 text-center space-y-3 border border-border/50">
                <PlayCircle className="w-12 h-12 text-primary/70" />
                <p className="text-sm font-medium text-foreground">{selectedVideo.title}</p>
                <p className="text-xs text-muted-foreground">
                    当前视频来自 {platformMeta.name}，支持跳转至独立 SEO 详情页或原站播放
                </p>
                <div className="flex items-center gap-2 pt-1">
                    {selectedVideo.href && (
                        <a
                            href={safeHref(selectedVideo.href)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                        >
                            前往 {platformMeta.shortName} 观看 ↗
                        </a>
                    )}
                    <Link
                        href={`/videos/v/${encodeURIComponent(selectedVideo.id)}`}
                        className="px-3.5 py-1.5 rounded-lg border border-border text-xs hover:bg-accent"
                    >
                        打开 SEO 收录详情页
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Schema.org VideoObject 搜索引擎结构化数据 */}
            {videoSchema && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: jsonLdScript(videoSchema) }}
                />
            )}

            {/* 顶部导航栏 */}
            <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-[max(env(safe-area-inset-top,0px),0px)]">
                <div className="flex h-14 items-center px-4 gap-4">
                    <Link href="/" className="flex items-center gap-2 font-semibold">
                        <PlayCircle className="w-6 h-6 text-primary" />
                        <span>视频中心</span>
                    </Link>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                        {/* QoE 播放体验网络指示器 */}
                        <VideoNetworkSentinel
                            metrics={qoeMetrics}
                            onFailoverTrigger={handleAutoFailover}
                        />

                        {/* 协同共赏房间 */}
                        <Button
                            variant={coWatchSession ? "secondary" : "ghost"}
                            size="icon"
                            title={coWatchSession ? `协同共赏室 (${coWatchSession.getPeerCount()}人在线)` : "协同共赏房间"}
                            onClick={() => setShowCoWatchDialog(true)}
                        >
                            <Users className={cn("w-4 h-4", coWatchSession ? "text-emerald-500" : "text-muted-foreground")} />
                        </Button>

                        {/* WebAudio 信号处理 */}
                        <Button
                            variant={audioOptions.voiceClarity || audioOptions.volumeBoost > 1 ? "secondary" : "ghost"}
                            size="icon"
                            title="WebAudio 音频实验室 (人声清晰/响度平滑/音量增强)"
                            onClick={() => setShowAudioDialog(true)}
                        >
                            <Volume2 className={cn("w-4 h-4", (audioOptions.voiceClarity || audioOptions.volumeBoost > 1) ? "text-primary" : "text-muted-foreground")} />
                        </Button>

                        <Button
                            variant="ghost"
                            size="icon"
                            title="画中画 / 悬浮小窗"
                            onClick={() => {
                                if (selectedVideo) {
                                    openGlobalVideo(selectedVideo)
                                    requestDocumentPiP()
                                }
                            }}
                        >
                            <PictureInPicture className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            title="快捷键指南 (?)"
                            onClick={() => setShowShortcutHelp(true)}
                        >
                            <Keyboard className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            title="观看历史"
                            onClick={() => setActiveTab(prev => prev === 'history' ? 'playlist' : 'history')}
                            className={activeTab === 'history' ? 'bg-accent text-accent-foreground' : ''}
                        >
                            <History className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button asChild variant="ghost" size="icon">
                            <Link href="/" aria-label="返回主页" title="返回主页">
                                <Home className="w-5 h-5" />
                            </Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon">
                            <Link href="/videos" aria-label="返回视频中心" title="返回视频中心">
                                <LayoutGrid className="w-5 h-5" />
                            </Link>
                        </Button>
                        <VideoVoiceIndicator onCommand={handleVoiceCommand} />
                        <Button
                            variant="ghost"
                            size="icon"
                            title="技能图谱与打卡热力图"
                            onClick={() => setShowSkillTreeDialog(true)}
                        >
                            <Trophy className="w-4 h-4 text-amber-500" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            title="无障碍视力守护与滤镜 (a11y)"
                            onClick={() => setShowA11yDialog(true)}
                        >
                            <Eye className="w-4 h-4 text-primary" />
                        </Button>
                        <ModeToggle />
                    </div>
                </div>
            </header>

            {/* 主内容区域 */}
            <div className="flex h-[calc(100vh-3.5rem)]">
                {/* 左侧播放器区域 */}
                <div className="flex-1 p-4 lg:p-6 overflow-auto pb-52 md:pb-6">
                    <div className="max-w-5xl mx-auto space-y-4">
                        {/* 路径导航面包屑与细分方向一键穿透 */}
                        <nav aria-label="课程路径导航" className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap py-0.5">
                            <Link href="/videos" className="hover:text-foreground flex items-center gap-1 transition-colors">
                                <LayoutGrid className="w-3.5 h-3.5" />
                                <span>视频中心</span>
                            </Link>
                            {currentCategoryContext.category && (
                                <>
                                    <ChevronRight className="w-3.5 h-3.5 opacity-40 shrink-0" />
                                    <Link
                                        href={`/videos?c=${encodeURIComponent(currentCategoryContext.category.id)}`}
                                        className="hover:text-primary transition-colors font-medium text-foreground/80 hover:underline"
                                    >
                                        {currentCategoryContext.category.title}
                                    </Link>
                                </>
                            )}
                            {currentCategoryContext.subCategory && (
                                <>
                                    <ChevronRight className="w-3.5 h-3.5 opacity-40 shrink-0" />
                                    <Link
                                        href={`/videos?c=${encodeURIComponent(currentCategoryContext.category?.id || '')}&sub=${encodeURIComponent(currentCategoryContext.subCategory.id)}`}
                                        className="hover:text-primary transition-colors px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium hover:bg-primary/20 border border-primary/20"
                                        title={`查看 ${currentCategoryContext.subCategory.title} 下的所有实战课程`}
                                    >
                                        {currentCategoryContext.subCategory.title}
                                    </Link>
                                </>
                            )}
                            {selectedVideo && (
                                <>
                                    <ChevronRight className="w-3.5 h-3.5 opacity-40 shrink-0" />
                                    <span className="text-foreground/90 font-medium truncate max-w-[180px] sm:max-w-md">
                                        {selectedVideo.title}
                                    </span>
                                </>
                            )}
                        </nav>

                        {/* 断点续播提示横幅 */}
                        {resumePrompt && (
                            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs animate-in fade-in slide-in-from-top-2">
                                <div className="flex items-center gap-2">
                                    <RotateCcw className="w-4 h-4 text-primary shrink-0" />
                                    <span>检测到您上次观看至 <strong>{resumePrompt.formatted}</strong>，已为您记录续播位置。</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={dismissResumePrompt}>
                                        我知道了
                                    </Button>
                                    <button onClick={dismissResumePrompt} className="text-muted-foreground hover:text-foreground">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 视频播放器与同屏白板涂鸦 */}
                        <div className="relative">
                            {renderVideoPlayer()}
                            <VideoTelestratorCanvas
                                videoId={selectedVideo?.id || 'main'}
                                currentSec={chapterSeekSec || 0}
                                isActive={showTelestrator}
                                onClose={() => setShowTelestrator(false)}
                            />
                        </div>

                        {/* 端侧空间手势控制状态 */}
                        <VideoGestureHudOverlay
                            enabled={gestureControlEnabled}
                            onToggle={() => setGestureControlEnabled(prev => !prev)}
                            onAction={(act) => {
                                if (act === 'seek_back') setChapterSeekSec(prev => Math.max(0, (prev || 0) - 10))
                                if (act === 'seek_forward') setChapterSeekSec(prev => (prev || 0) + 10)
                            }}
                        />

                        {/* 双语卡拉OK逐字字幕与术语释义 */}
                        {transcriptList.length > 0 && (
                            <VideoKaraokeSubtitles
                                transcript={transcriptList}
                                currentSec={chapterSeekSec || 0}
                                mode="bilingual"
                            />
                        )}

                        {/* 播放控制条与学习工具入口 */}
                        <VideoPlayerControlBar
                            currentIndex={currentIndex}
                            totalVideos={allVideos.length}
                            onPrevVideo={handlePrevVideo}
                            onNextVideo={handleNextVideo}
                            availableMirrors={availableMirrors}
                            activeMirror={activeMirror}
                            onSwitchMirror={handleSwitchMirror}
                            biliEngine={biliEngine}
                            onBiliEngineChange={setBiliEngine}
                            inWatchLater={inWatchLater}
                            onToggleWatchLater={handleToggleWatchLater}
                            activeTab={activeTab}
                            onTabChange={setActiveTab}
                            selectedVideo={selectedVideo}
                            chaptersCount={chapters.length}
                            codeMilestonesCount={codeMilestones.length}
                            quizCount={quizQuestions.length}
                            flashcardsCount={flashcards.length}
                            showSandbox={showSandbox}
                            onToggleSandbox={() => setShowSandbox(prev => !prev)}
                            showTelestrator={showTelestrator}
                            onToggleTelestrator={() => setShowTelestrator(prev => !prev)}
                            smartSpeedEnabled={smartSpeedConfig.enabled}
                            mindmapAvailable={mindmapRoot.children.length > 0}
                            pipRenderer={(
                                <VideoPipWindowRenderer
                                    videoTitle={selectedVideo?.title || '技术课程'}
                                    currentSubtitle={transcriptList[0]?.text}
                                    lastCodeCommand={codeMilestones[0]?.afterCode.split('\n')[0]}
                                />
                            )}
                            openers={{
                                note: () => setShowNoteDialog(true),
                                poster: () => setShowPosterDialog(true),
                                // 无数据不给入口（2026-11-11 审计第二批）：抽认卡只在真有
                                // 卡片（用户笔记 / 真章节测验派生）时出现；证书与概念图谱
                                // 只对自带真实章节的视频出现；双语类只在有真实字幕稿时
                                // 出现。频谱 / 神经降噪 / P2P 网格 / 分轨 / P2P 蜂群五个
                                // 入口整体下线——背后没有真实数据管线，组件保留在仓内
                                // （见 scripts/check-dead-modules.mjs 基线登记）。
                                ...(flashcards.length > 0 ? { flashcards: () => setShowFlashcardsDialog(true) } : {}),
                                ...(hasRealChapters ? { certificate: () => setShowCertDialog(true) } : {}),
                                ocr: () => setShowOcrDialog(true),
                                smartSpeed: () => setShowSmartSpeedDialog(true),
                                offline: () => setShowOfflineDialog(true),
                                ...(transcriptList.length > 0 ? { bilingualSubtitles: () => setShowBilingualSubtitlesDialog(true) } : {}),
                                workspaceExport: () => setShowWorkspaceExportDialog(true),
                                sessionReplay: () => setShowSessionReplayDialog(true),
                                clipMaker: () => setShowClipMakerDialog(true),
                                pomodoro: () => setShowPomodoroDialog(true),
                                remedy: () => setShowRemedyDialog(true),
                                autoHarvest: () => setShowAutoHarvestDialog(true),
                                autonomousHarvest: () => setShowAutonomousHarvestConsole(true),
                                webhook: () => setShowWebhookDialog(true),
                                wasmOcr: () => setShowWasmOcrDialog(true),
                                ...(transcriptList.length > 0 ? { bilingualTts: () => setShowBilingualTtsDialog(true) } : {}),
                                ...(hasRealChapters ? { conceptGraph: () => setShowConceptGraphDialog(true) } : {}),
                                studyRoom: () => setShowStudyRoomDialog(true),
                                quiz: () => setShowQuizDialog(true),
                            }}
                        />

                        {/* 弹幕与避坑路标发送条 */}
                        <form onSubmit={handleSendDanmaku} className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border/50 text-xs">
                            <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                            <input aria-label="弹幕内容"
                                type="text"
                                value={newDanmakuText}
                                onChange={e => setNewDanmakuText(e.target.value)}
                                placeholder="发一条弹幕或技术避坑提示..."
                                className="flex-1 bg-transparent border-0 text-xs focus:outline-none placeholder:text-muted-foreground"
                            />
                            <label className="flex items-center gap-1 cursor-pointer select-none text-[11px] text-amber-500 font-medium shrink-0">
                                <input
                                    type="checkbox"
                                    checked={isPitfallDanmaku}
                                    onChange={e => setIsPitfallDanmaku(e.target.checked)}
                                    className="rounded border-border text-amber-500 focus:ring-0"
                                />
                                <span>⚠️ 避坑路标</span>
                            </label>
                            <Button type="submit" size="sm" className="h-7 px-2.5 text-xs gap-1">
                                <Send className="w-3 h-3" />
                                发送
                            </Button>
                        </form>

                        {/* 嵌入式演练沙箱 */}
                        {showSandbox && (
                            <div className="pt-2 animate-in fade-in slide-in-from-top-2">
                                <VideoCodeSandbox
                                    initialCode={sandboxCode}
                                    initialLanguage={sandboxLang}
                                    onClose={() => setShowSandbox(false)}
                                />
                            </div>
                        )}

                        {/* 视频信息 */}
                        {selectedVideo && (
                            <div className="space-y-3">
                                <h1 className="text-xl font-semibold break-words">
                                    {selectedVideo.title}
                                </h1>
                                {selectedVideo.description && (
                                    <p className="text-muted-foreground text-sm">
                                        {selectedVideo.description}
                                    </p>
                                )}
                                {selectedVideo.videoConfig && (
                                    <div className="flex flex-wrap items-center gap-3 text-xs">
                                        <span className={cn(
                                            "px-2 py-0.5 font-medium rounded",
                                            selectedVideo.videoConfig.type === 'bilibili'
                                                ? "bg-pink-500/10 text-pink-500"
                                                : "bg-red-500/10 text-red-500"
                                        )}>
                                            {selectedVideo.videoConfig.type === 'bilibili' ? 'Bilibili' : 'YouTube'}
                                        </span>
                                        {selectedVideo.videoConfig.subCategoryTitle && (
                                            <span className="px-2 py-0.5 font-medium rounded bg-primary/10 text-primary">
                                                {selectedVideo.videoConfig.subCategoryTitle}
                                            </span>
                                        )}
                                        {selectedVideo.videoConfig.tags && selectedVideo.videoConfig.tags.length > 0 && (
                                            selectedVideo.videoConfig.tags.slice(0, 3).map((t, i) => (
                                                <span key={i} className="px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground font-mono text-[11px]">
                                                    #{t}
                                                </span>
                                            ))
                                        )}
                                        {selectedVideo.videoConfig.author && (
                                            <span className="text-muted-foreground">
                                                创作者: <strong className="font-medium text-foreground">{selectedVideo.videoConfig.author}</strong>
                                            </span>
                                        )}
                                        {selectedVideo.videoConfig.durationSec ? (
                                            <span className="text-muted-foreground font-mono">
                                                时长: {formatDuration(selectedVideo.videoConfig.durationSec)}
                                            </span>
                                        ) : null}
                                        {selectedVideo.videoConfig.publishedAt && (
                                            <span className="text-muted-foreground">
                                                发布时间: {new Date(selectedVideo.videoConfig.publishedAt).toLocaleDateString()}
                                            </span>
                                        )}
                                        {selectedVideo.href && (
                                            <a
                                                href={safeHref(selectedVideo.href)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:underline ml-auto"
                                            >
                                                在原站打开 →
                                            </a>
                                        )}
                                    </div>
                                )}

                                {/* 相关视频协同推荐 */}
                                {relatedVideos.length > 0 && (
                                    <div className="pt-4 border-t border-border/40 space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                            <Sparkles className="w-3.5 h-3.5 text-primary" />
                                            <span>相关教程推荐</span>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                            {relatedVideos.map(rel => (
                                                <button
                                                    key={`rel-${rel.id}`}
                                                    onClick={() => setSelectedVideo(rel)}
                                                    className="text-left p-2.5 rounded-lg border border-border/50 bg-card hover:bg-accent/40 transition-all space-y-1.5 group"
                                                >
                                                    <p className="text-xs font-medium line-clamp-2 group-hover:text-primary transition-colors">
                                                        {rel.title}
                                                    </p>
                                                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                                        <span>{rel.videoConfig?.author || '技术导师'}</span>
                                                        {rel.videoConfig?.durationSec && (
                                                            <span className="font-mono">{formatDuration(rel.videoConfig.durationSec)}</span>
                                                        )}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <VideoPlayerSidePanel
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    playlist={
                        <VideoPlaylistTree
                            navigationItems={navigationData.navigationItems}
                            selectedVideo={selectedVideo}
                            onSelectVideo={setSelectedVideo}
                            expandedCategories={expandedCategories}
                            onToggleCategory={toggleCategory}
                            expandedSubCategories={expandedSubCategories}
                            onToggleSubCategory={toggleSubCategory}
                        />
                    }
                    allVideos={allVideos}
                    selectedVideo={selectedVideo}
                    setSelectedVideo={setSelectedVideo}
                    chapters={chapters}
                    aiSummary={aiSummary}
                    isLoadingAI={isLoadingAI}
                    handleSeekToChapter={handleSeekToChapter}
                    handleCopyCode={handleCopyCode}
                    handleOpenSandbox={handleOpenSandbox}
                    copiedCodeId={copiedCodeId}
                    chapterSeekSec={chapterSeekSec}
                    setChapterSeekSec={setChapterSeekSec}
                    mindmapRoot={mindmapRoot}
                    codeMilestones={codeMilestones}
                    sandboxInitialCode={sandboxInitialCode}
                    danmakuList={danmakuList}
                    transcriptList={transcriptList}
                    filteredTranscript={filteredTranscript}
                    transcriptSearchQuery={transcriptSearchQuery}
                    setTranscriptSearchQuery={setTranscriptSearchQuery}
                    handleExportTranscript={handleExportTranscript}
                    notesList={notesList}
                    handleExportNotes={handleExportNotes}
                    setShowNoteDialog={setShowNoteDialog}
                    historyList={historyList}
                />
            </div>

            {/* 移动端底部播放列表 */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur pb-[max(env(safe-area-inset-bottom,0px),0px)]">
                <ScrollArea className="h-48">
                    <div className="p-3 space-y-1">
                        <VideoPlaylistTree
                            navigationItems={navigationData.navigationItems}
                            selectedVideo={selectedVideo}
                            onSelectVideo={setSelectedVideo}
                            expandedCategories={expandedCategories}
                            onToggleCategory={toggleCategory}
                            expandedSubCategories={expandedSubCategories}
                            onToggleSubCategory={toggleSubCategory}
                        />
                    </div>
                </ScrollArea>
            </div>

            {/* 快捷键帮助弹窗 */}
            <Dialog open={showShortcutHelp} onOpenChange={setShowShortcutHelp}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <Keyboard className="w-5 h-5 text-primary" />
                            <span>播放器快捷键指南</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2.5 text-xs pt-2">
                        <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                            <span className="text-muted-foreground">打开 / 关闭快捷键指南</span>
                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono font-bold">?</kbd>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                            <span className="text-muted-foreground">进入 / 退出全屏</span>
                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono font-bold">F</kbd>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                            <span className="text-muted-foreground">切换上一部视频</span>
                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono font-bold">[</kbd>
                        </div>
                        <div className="flex items-center justify-between py-1.5 border-b border-border/40">
                            <span className="text-muted-foreground">切换下一部视频</span>
                            <kbd className="px-2 py-0.5 rounded bg-muted font-mono font-bold">]</kbd>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 记笔记时间戳弹窗 */}
            <Dialog open={showNoteDialog} onOpenChange={setShowNoteDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <Camera className="w-5 h-5 text-primary" />
                            <span>记录学习笔记与时间戳快照</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 pt-2 text-xs">
                        <div className="flex items-center gap-2 text-muted-foreground font-mono">
                            <span>锚定时间戳:</span>
                            <span className="font-bold text-foreground">{formatDuration(chapterSeekSec || 0)}</span>
                        </div>
                        <textarea aria-label="笔记内容"
                            value={newNoteText}
                            onChange={e => setNewNoteText(e.target.value)}
                            placeholder="记录当前视频重点、思考、避坑注意事项..."
                            className="w-full h-24 p-2.5 rounded-lg bg-muted border border-border/50 resize-none text-xs focus:outline-none leading-relaxed"
                        />
                        <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setShowNoteDialog(false)}>
                                取消
                            </Button>
                            <Button size="sm" onClick={handleSaveNote} disabled={!newNoteText.trim()}>
                                保存笔记
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 课后测验弹窗 */}
            <VideoQuizDialog
                open={showQuizDialog}
                onOpenChange={setShowQuizDialog}
                questions={quizQuestions}
                videoTitle={selectedVideo?.title || '技术自测'}
            />

            {/* 音频增强实验室弹窗 */}
            <Dialog open={showAudioDialog} onOpenChange={setShowAudioDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <Volume2 className="w-5 h-5 text-primary" />
                            <span>WebAudio 音频处理实验室</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2 text-xs">
                        <p className="text-muted-foreground text-xs leading-relaxed">
                            基于浏览器原生 AudioContext + BiquadFilterNode + DynamicsCompressorNode 实现客户端无损实时数字信号处理 (DSP)。
                        </p>
                        <div className="space-y-3 border p-3 rounded-lg bg-card">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-medium text-foreground">人声频段清晰度增强</div>
                                    <div className="text-[11px] text-muted-foreground">提升 2.5kHz 语音共振峰，突出讲解人声</div>
                                </div>
                                <input aria-label="人声清晰度增强"
                                    type="checkbox"
                                    checked={audioOptions.voiceClarity}
                                    onChange={(e) => setAudioOptions(prev => ({ ...prev, voiceClarity: e.target.checked }))}
                                    className="rounded border-border text-primary focus:ring-0 w-4 h-4 cursor-pointer"
                                />
                            </div>

                            <div className="flex items-center justify-between border-t border-border/40 pt-2">
                                <div>
                                    <div className="font-medium text-foreground">动态响度平滑 (AGC)</div>
                                    <div className="text-[11px] text-muted-foreground">多频段压缩，防爆音并平衡忽大忽小的音量</div>
                                </div>
                                <input aria-label="响度标准化"
                                    type="checkbox"
                                    checked={audioOptions.loudnessNormalization}
                                    onChange={(e) => setAudioOptions(prev => ({ ...prev, loudnessNormalization: e.target.checked }))}
                                    className="rounded border-border text-primary focus:ring-0 w-4 h-4 cursor-pointer"
                                />
                            </div>

                            <div className="flex items-center justify-between border-t border-border/40 pt-2">
                                <div>
                                    <div className="font-medium text-foreground">低频环境降噪 (Highpass)</div>
                                    <div className="text-[11px] text-muted-foreground">衰减 80Hz 以下电流嗡嗡声与风噪底噪</div>
                                </div>
                                <input aria-label="低切滤波"
                                    type="checkbox"
                                    checked={audioOptions.lowCut}
                                    onChange={(e) => setAudioOptions(prev => ({ ...prev, lowCut: e.target.checked }))}
                                    className="rounded border-border text-primary focus:ring-0 w-4 h-4 cursor-pointer"
                                />
                            </div>

                            <div className="border-t border-border/40 pt-2">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="font-medium text-foreground">音量极限放大倍率</span>
                                    <span className="font-mono text-primary font-bold">{(audioOptions.volumeBoost * 100).toFixed(0)}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {[1.0, 1.25, 1.5, 2.0].map((rate) => (
                                        <button
                                            key={rate}
                                            onClick={() => setAudioOptions(prev => ({ ...prev, volumeBoost: rate }))}
                                            className={cn(
                                                "flex-1 py-1 rounded text-xs border font-mono transition-all",
                                                audioOptions.volumeBoost === rate
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-muted hover:bg-accent"
                                            )}
                                        >
                                            {rate}x
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button size="sm" onClick={() => setShowAudioDialog(false)}>
                                确定
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 协同共赏房间弹窗 */}
            <Dialog open={showCoWatchDialog} onOpenChange={setShowCoWatchDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <Users className="w-5 h-5 text-primary" />
                            <span>P2P 协同共赏房间</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2 text-xs">
                        <p className="text-muted-foreground text-xs leading-relaxed">
                            基于 CRDT 逻辑时钟与跨标签页/设备通道实现毫秒级播放进度对齐与协同学习。
                        </p>

                        {coWatchSession ? (
                            <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        房间已连接: {coWatchSession.roomId}
                                    </span>
                                    <span className="text-[11px] font-mono text-muted-foreground">
                                        在线节点: {coWatchSession.getPeerCount()}
                                    </span>
                                </div>
                                <div className="text-[11px] text-muted-foreground font-mono space-y-1">
                                    <div>本地客户端: {coWatchSession.clientId}</div>
                                    <div>时钟版本号: {coWatchSession.getState().version}</div>
                                    {coWatchState && <div>当前同步进度: {formatDuration(coWatchState.currentSec)}</div>}
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        className="flex-1 text-xs"
                                        onClick={() => {
                                            if (coWatchSession) {
                                                coWatchSession.broadcastPlayback(chapterSeekSec || 0, true)
                                            }
                                        }}
                                    >
                                        向房间广播我当前进度
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-xs text-red-500 hover:text-red-600"
                                        onClick={handleLeaveCoWatch}
                                    >
                                        离开房间
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-medium text-foreground">输入或创建房间号</label>
                                    <div className="flex gap-2">
                                        <input aria-label="一起看房间号"
                                            type="text"
                                            value={coWatchRoomId}
                                            onChange={e => setCoWatchRoomId(e.target.value)}
                                            placeholder={`例如: devops-${selectedVideo?.id || 'live'}`}
                                            className="flex-1 px-3 py-1.5 text-xs rounded-md bg-muted border border-border/50 focus:outline-none"
                                        />
                                        <Button
                                            size="sm"
                                            onClick={() => handleJoinCoWatch(coWatchRoomId || `room-${selectedVideo?.id || 'main'}`)}
                                        >
                                            加入共看
                                        </Button>
                                    </div>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="w-full text-xs"
                                    onClick={() => {
                                        const defaultId = `study-${selectedVideo?.id || 'demo'}`
                                        setCoWatchRoomId(defaultId)
                                        handleJoinCoWatch(defaultId)
                                    }}
                                >
                                    快速创建并加入本教程自习室
                                </Button>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* 动态时间戳分享海报弹窗 */}
            {selectedVideo && (
                <VideoSharePosterDialog
                    open={showPosterDialog}
                    onOpenChange={setShowPosterDialog}
                    videoTitle={selectedVideo.title}
                    videoAuthor={selectedVideo.videoConfig?.author}
                    currentSec={chapterSeekSec || 0}
                    videoId={selectedVideo.id}
                />
            )}

            {/* 艾宾浩斯智能抽认卡复习弹窗 */}
            <VideoFlashcardDeck
                open={showFlashcardsDialog}
                onOpenChange={setShowFlashcardsDialog}
                cards={flashcards}
                videoTitle={selectedVideo?.title || '技术知识点'}
            />

            {/* 结业微证书颁发弹窗 */}
            <VideoCertificateDialog
                open={showCertDialog}
                onOpenChange={setShowCertDialog}
                videoTitle={selectedVideo?.title || '全栈高级工程进阶'}
                notesCount={notesList.length}
                quizScorePercent={88}
            />

            {/* 离线缓存管理弹窗 */}
            <VideoOfflineManager
                open={showOfflineDialog}
                onOpenChange={setShowOfflineDialog}
                currentVideoId={selectedVideo?.id}
                currentVideoTitle={selectedVideo?.title}
            />

            {/* 智能静音跳跃配置弹窗 */}
            <VideoSmartSpeedDialog
                open={showSmartSpeedDialog}
                onOpenChange={setShowSmartSpeedDialog}
                config={smartSpeedConfig}
                state={smartSpeedState}
                onConfigChange={(newCfg) => setSmartSpeedConfig(prev => ({ ...prev, ...newCfg }))}
            />

            {/* 画面 OCR 代码提取弹窗 */}
            <VideoFrameOcrDialog
                open={showOcrDialog}
                onOpenChange={setShowOcrDialog}
                onSendToSandbox={() => {
                    setActiveTab('wasm')
                }}
            />

            {/* 无障碍视力守护配置弹窗 */}
            <VideoA11ySettingsDialog
                open={showA11yDialog}
                onOpenChange={setShowA11yDialog}
                settings={a11ySettings}
                onSettingsChange={setA11ySettings}
            />

            {/* 全周期技能树与连续打卡热力图弹窗 */}
            <VideoSkillTreeDialog
                open={showSkillTreeDialog}
                onOpenChange={setShowSkillTreeDialog}
            />

            {/* Git 工程与 Gist 导出弹窗 */}
            <VideoWorkspaceExportDialog
                open={showWorkspaceExportDialog}
                onOpenChange={setShowWorkspaceExportDialog}
                courseTitle={selectedVideo?.title || '技术实战'}
                videoId={selectedVideo?.id || 'demo'}
                milestones={codeMilestones.map(m => ({ title: m.title, code: m.afterCode, language: m.language }))}
                notes={notesList.map(n => ({ userNote: n.userNote ?? '', codeSnippet: n.codeSnippet }))}
            />

            {/* 双语字幕对齐与导出弹窗 */}
            <VideoBilingualSubtitlesDialog
                open={showBilingualSubtitlesDialog}
                onOpenChange={setShowBilingualSubtitlesDialog}
                transcripts={transcriptList}
                videoTitle={selectedVideo?.title}
            />

            {/* 学习会话时空漫游复盘弹窗 */}
            <VideoSessionReplayDialog
                open={showSessionReplayDialog}
                onOpenChange={setShowSessionReplayDialog}
                recorder={sessionRecorderRef.current}
                onSeekToHotspot={(sec) => setChapterSeekSec(sec)}
            />

            {/* 视频微知识点一键切片生成器弹窗 */}
            <VideoClipMakerDialog
                open={showClipMakerDialog}
                onOpenChange={setShowClipMakerDialog}
                videoTitle={selectedVideo?.title || '技术实战视频'}
                durationSec={selectedVideo?.videoConfig?.durationSec || 600}
                currentSec={chapterSeekSec || 0}
                transcripts={transcriptList}
            />

            {/* 深度沉浸番茄钟弹窗 */}
            <VideoPomodoroDialog
                open={showPomodoroDialog}
                onOpenChange={setShowPomodoroDialog}
            />

            {/* 贝叶斯自适应弱项诊断与补救弹窗 */}
            <VideoAdaptiveRemedyDialog
                open={showRemedyDialog}
                onOpenChange={setShowRemedyDialog}
                onSeekToTimestamp={(sec) => setChapterSeekSec(sec)}
            />

            {/* 全网热点视频自动采集与内容丰富弹窗 */}
            <VideoAutoHarvestDialog
                open={showAutoHarvestDialog}
                onOpenChange={setShowAutoHarvestDialog}
            />

            {/* AI 全程自主视频采集与知识重构控制台 */}
            <VideoAutonomousHarvestConsole
                open={showAutonomousHarvestConsole}
                onOpenChange={setShowAutonomousHarvestConsole}
            />

            {/* 多源数据采集与 Webhook 自动化分发控制台 */}
            <VideoMultisourceWebhookDialog
                open={showWebhookDialog}
                onOpenChange={setShowWebhookDialog}
            />

            {/* Wasm 视频画面代码智能抽帧与 OCR 提取弹窗 */}
            <VideoOcrCodeExtractorDialog
                open={showWasmOcrDialog}
                onOpenChange={setShowWasmOcrDialog}
                onSendToSandbox={(code) => {
                    setSandboxInitialCode(code)
                    setActiveTab('sandbox')
                }}
            />

            {/* AI 多语言双语同传与即时语音重译 (TTS) 弹窗 */}
            <VideoBilingualTtsDialog
                open={showBilingualTtsDialog}
                onOpenChange={setShowBilingualTtsDialog}
                transcripts={selectedVideo?.videoConfig?.transcript}
            />

            {/* 交互式技术概念图谱与 Dijkstra 最优学习路径穿梭机 */}
            <VideoConceptGraphDialog
                open={showConceptGraphDialog}
                onOpenChange={setShowConceptGraphDialog}
                navigationData={navigationData}
                onJumpToTarget={({ bvid, seekSec }) => {
                    const found = allVideos.find(v => v.videoConfig?.bvid === bvid || v.id === bvid)
                    if (found) setSelectedVideo(found)
                    setChapterSeekSec(seekSec)
                }}
            />

            {/* WebRTC / CRDT 伴学自习室与音画协同白板 */}
            <VideoCrdtStudyRoomDialog
                open={showStudyRoomDialog}
                onOpenChange={setShowStudyRoomDialog}
                currentVideoTitle={selectedVideo?.title}
            />
        </div>
    )
}
