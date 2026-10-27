'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { safeHref } from '@/lib/safe-url'
import type {
  NavigationData,
  NavigationItem,
  NavigationSubItem,
  VideoChapter,
  VideoMirrorSource,
  VideoDanmakuItem,
  VideoTranscriptItem,
} from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { ModeToggle } from '@/components/mode-toggle'
import {
  ChevronDown,
  ChevronRight,
  PlayCircle,
  Play,
  Home,
  LayoutGrid,
  List,
  History,
  RotateCcw,
  Keyboard,
  SkipBack,
  SkipForward,
  X,
  ListCollapse,
  Code,
  Copy,
  Check,
  Clock,
  Layers,
  PictureInPicture,
  Sparkles,
  Camera,
  MessageSquare,
  AlertTriangle,
  FileText,
  Send,
  Download,
  Code2,
  Terminal,
  Volume2,
  GitCompare,
  HelpCircle,
  FolderTree,
  Users,
  Sliders,
  Wand2,
  Share2,
  Award,
  GraduationCap,
  Brain,
  Radio,
  PenTool,
  DownloadCloud,
  Zap,
  ScanText,
  Eye,
  Trophy,
  Activity,
  FolderArchive,
  Languages,
  RotateCw,
  Cpu,
  Bug,
  Scissors,
  Timer,
  Network,
  Presentation,
  SlidersHorizontal,
  Hand,
  Flame,
  BrainCircuit,
  Webhook,
  Box,
} from 'lucide-react'
import { Button } from "@/registry/new-york/ui/button"
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/registry/new-york/ui/scroll-area'
import { formatDuration } from '@/lib/video-format'
import { useVideoPlayerState } from '@/hooks/useVideoPlayerState'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { resolveAvailableMirrors, selectBestMirror, recordMirrorFailover } from '@/lib/video-failover'
import { getVideoAISummary, type VideoAISummary } from '@/lib/video-ai-summary'
import { isInWatchLater, toggleWatchLater, PLAYLIST_UPDATE_EVENT } from '@/lib/user-playlists'
import { getRelatedVideos } from '@/lib/video-recommendation'
import { useVideoPlayer } from '@/contexts/VideoPlayerContext'
import { VideoCodeSandbox } from '@/components/video-code-sandbox'
import { parseWebVTT, searchTranscript, exportTranscriptAsMarkdown } from '@/lib/video-transcript-sync'
import { saveStudyNote, listStudyNotes, exportNotesAsMarkdown, type VideoStudyNote } from '@/lib/video-frame-clipper'
import { getStoredDanmaku, saveDanmakuItem } from '@/lib/video-danmaku-engine'
import { getP2PStreamCoordinator } from '@/lib/p2p-stream-loader'
import { VideoCodeDiffViewer } from '@/components/video-code-diff-viewer'
import { VideoQuizDialog } from '@/components/video-quiz-dialog'
import { VideoMindmapView } from '@/components/video-mindmap-view'
import { VideoHeatmapTimeline } from '@/components/video-heatmap-timeline'
import { VideoKaraokeSubtitles } from '@/components/video-karaoke-subtitles'
import { VideoTerminalPlayer } from '@/components/video-terminal-player'
import { VideoNetworkSentinel } from '@/components/video-network-sentinel'
import { VideoSharePosterDialog } from '@/components/video-share-poster-dialog'
import { VideoShaderFilterDialog } from '@/components/video-shader-filter'
import { VideoVoiceIndicator } from '@/components/video-voice-indicator'
import { VideoWasmTerminalPane } from '@/components/video-wasm-terminal-pane'
import { VideoFlashcardDeck } from '@/components/video-flashcard-deck'
import { VideoConfusionRadar } from '@/components/video-confusion-radar'
import { VideoCertificateDialog } from '@/components/video-certificate-dialog'
import { VideoTelestratorCanvas } from '@/components/video-telestrator-canvas'
import { VideoOfflineManager } from '@/components/video-offline-manager'
import { VideoSmartSpeedDialog } from '@/components/video-smart-speed-controls'
import { VideoFrameOcrDialog } from '@/components/video-frame-ocr-overlay'
import { VideoA11ySettingsDialog } from '@/components/video-a11y-settings-dialog'
import { VideoSkillTreeDialog } from '@/components/video-skill-tree-dialog'
import { VideoSpectrogramDialog } from '@/components/video-spectrogram-canvas'
import { VideoWorkspaceExportDialog } from '@/components/video-workspace-export-dialog'
import { VideoBilingualSubtitlesDialog } from '@/components/video-bilingual-subtitles-dialog'
import { VideoPipWindowRenderer } from '@/components/video-pip-window-renderer'
import { VideoSessionReplayDialog } from '@/components/video-session-replay-dialog'
import { VideoScrubberPreview } from '@/components/video-scrubber-preview'
import { generateFilmstripSequence, type FilmstripThumbnail } from '@/lib/video-filmstrip-generator'
import { SessionActivityRecorder } from '@/lib/video-session-recorder'
import { type SilenceDetectorConfig, type SilenceDetectorState } from '@/lib/video-silence-detector'
import { type A11ySightGuardSettings, generateSvgFilterMarkup } from '@/lib/video-a11y-sight-guard'
import { extractCodeMilestones, type CodeMilestone } from '@/lib/video-code-diff'
import { type AudioEnhancerOptions } from '@/lib/video-audio-enhancer'
import { joinCoWatchRoom, type CoWatchSession, type CoWatchState } from '@/lib/video-crdt-room'
import { generateVideoQuizzes, type VideoQuizQuestion } from '@/lib/video-quiz-generator'
import { generateVideoMindMap, type MindMapNode } from '@/lib/video-mindmap-generator'
import { generateVideoObjectSchema } from '@/lib/video-seo'
import { createQoETracker, type QoEMetrics } from '@/lib/video-qoe-telemetry'
import { calculatePrefetchQueue } from '@/lib/video-cache-manager'
import { generateFlashcardsFromNotes, generateFlashcardsFromQuizzes, type FlashcardItem } from '@/lib/video-spaced-repetition'
import { type SharpenerOptions } from '@/lib/video-webgpu-sharpener'
import { type VoiceCommandIntent } from '@/lib/video-voice-commander'
import { VideoNeuralAudioControls } from '@/components/video-neural-audio-controls'
import { VideoDebuggerStepperPane } from '@/components/video-debugger-stepper-pane'
import { VideoDanmakuMeshMonitor } from '@/components/video-danmaku-mesh-monitor'
import { VideoAssistantCopilot } from '@/components/video-assistant-copilot'
import { VideoClipMakerDialog } from '@/components/video-clip-maker-dialog'
import { VideoPomodoroDialog } from '@/components/video-pomodoro-overlay'
import { type NeuralDenoiserConfig } from '@/lib/video-neural-denoiser'
import { VideoSlideDeckViewer } from '@/components/video-slide-deck-viewer'
import { VideoAudioStemMixerDialog } from '@/components/video-audio-stem-mixer-dialog'
import { VideoP2PSwarmHud } from '@/components/video-p2p-swarm-hud'
import { VideoGestureHudOverlay } from '@/components/video-gesture-hud-overlay'
import { VideoLiveTestPane } from '@/components/video-live-test-pane'
import { VideoAdaptiveRemedyDialog } from '@/components/video-adaptive-remedy-dialog'
import { VideoAutoHarvestDialog } from '@/components/video-auto-harvest-dialog'
import { VideoAutonomousHarvestConsole } from '@/components/video-autonomous-harvest-console'
import { VideoMultisourceWebhookDialog } from '@/components/video-multisource-webhook-dialog'
import { VideoOcrCodeExtractorDialog } from '@/components/video-ocr-code-extractor-dialog'
import { VideoBilingualTtsDialog } from '@/components/video-bilingual-tts-dialog'
import { VideoConceptGraphDialog } from '@/components/video-concept-graph-dialog'
import { VideoSandboxRunnerPane } from '@/components/video-sandbox-runner-pane'
import { VideoCrdtStudyRoomDialog } from '@/components/video-crdt-study-room-dialog'
import { copyText } from '@/lib/clipboard'

interface VideoPlayerPageProps {
    navigationData: NavigationData
    siteData: SiteConfig
}

export function VideoPlayerPage({ navigationData }: VideoPlayerPageProps) {
    const [selectedVideo, setSelectedVideo] = useState<NavigationSubItem | null>(null)
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
    const [expandedSubCategories, setExpandedSubCategories] = useState<Set<string>>(new Set())
    const [activeTab, setActiveTab] = useState<'playlist' | 'chapters' | 'slides' | 'mindmap' | 'diff' | 'debugger' | 'testrunner' | 'sandbox' | 'terminal' | 'wasm' | 'radar' | 'transcript' | 'copilot' | 'notes' | 'history'>('playlist')
    const [chapters, setChapters] = useState<VideoChapter[]>([])
    const [aiSummary, setAiSummary] = useState<VideoAISummary | null>(null)
    const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false)
    const [activeMirror, setActiveMirror] = useState<VideoMirrorSource | null>(null)
    const [availableMirrors, setAvailableMirrors] = useState<VideoMirrorSource[]>([])
    const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null)
    const [inWatchLater, setInWatchLater] = useState(false)
    const [chapterSeekSec, setChapterSeekSec] = useState<number | null>(null)
    const [showPosterDialog, setShowPosterDialog] = useState<boolean>(false)

    // WebGPU 画质超分辨率与锐化
    const [showShaderDialog, setShowShaderDialog] = useState<boolean>(false)
    const [sharpenerOptions, setSharpenerOptions] = useState<SharpenerOptions>({
        enabled: false,
        intensity: 1.0,
        algorithm: 'cas',
        preserveContrast: true,
    })

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

    // 扩展前沿：频谱分析、工程包导出、双语字幕、会话时空漫游、逐帧缩略图
    const [showSpectrogramDialog, setShowSpectrogramDialog] = useState<boolean>(false)
    const [showWorkspaceExportDialog, setShowWorkspaceExportDialog] = useState<boolean>(false)
    const [showBilingualSubtitlesDialog, setShowBilingualSubtitlesDialog] = useState<boolean>(false)
    const [showSessionReplayDialog, setShowSessionReplayDialog] = useState<boolean>(false)
    const [filmstripThumbnails, setFilmstripThumbnails] = useState<FilmstripThumbnail[]>([])
    const sessionRecorderRef = useRef<SessionActivityRecorder>(new SessionActivityRecorder('init'))

    // WebGPU 神经网络音频降噪、微知识点切片、深度专注番茄钟、P2P 弹幕信标网格
    const [showNeuralDenoiseDialog, setShowNeuralDenoiseDialog] = useState<boolean>(false)
    const [neuralDenoiseConfig, setNeuralDenoiseConfig] = useState<NeuralDenoiserConfig>({
        enabled: false,
        denoiseIntensity: 0.75,
        noiseGateThresholdDb: -45,
        voiceClarityGain: 1.25,
        overSubtractionFactor: 1.5,
    })
    const [showClipMakerDialog, setShowClipMakerDialog] = useState<boolean>(false)
    const [showPomodoroDialog, setShowPomodoroDialog] = useState<boolean>(false)
    const [showDanmakuMeshDialog, setShowDanmakuMeshDialog] = useState<boolean>(false)

    // 演进模块：多轨解耦调音台、P2P 蜂群 HUD、空间手势、自适应弱项诊断、全网热点自动采集
    const [showStemMixerDialog, setShowStemMixerDialog] = useState<boolean>(false)
    const [showP2PSwarmHud, setShowP2PSwarmHud] = useState<boolean>(false)
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
        if (!selectedVideo) return []
        return generateVideoQuizzes(selectedVideo.id, chapters, selectedVideo.title)
    }, [selectedVideo, chapters])

    // 4. WebAudio 信号处理实验室
    const [showAudioDialog, setShowAudioDialog] = useState<boolean>(false)
    const [audioOptions, setAudioOptions] = useState<AudioEnhancerOptions>({
        voiceClarity: false,
        loudnessNormalization: false,
        volumeBoost: 1.0,
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

    const handleNextVideo = () => {
        if (currentIndex >= 0 && currentIndex < allVideos.length - 1) {
            setSelectedVideo(allVideos[currentIndex + 1])
        }
    }

    const handlePrevVideo = () => {
        if (currentIndex > 0) {
            setSelectedVideo(allVideos[currentIndex - 1])
        }
    }

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
    }, [handleNextVideo, handlePrevVideo])

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
        setFilmstripThumbnails(
            generateFilmstripSequence(
                selectedVideo.videoConfig.durationSec || 600,
                selectedVideo.videoConfig.chapters || []
            )
        )

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
                setTranscriptList([
                    { id: 't1', startSec: 0, endSec: 60, text: `${selectedVideo.title}：技术背景与核心架构导读` },
                    { id: 't2', startSec: 60, endSec: 300, text: '进入实战模块与配置文件编写演示' },
                    { id: 't3', startSec: 300, endSec: selectedVideo.videoConfig.durationSec || 600, text: '生产级高可用部署与性能优化总结' },
                ])
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
        setChapterSeekSec(chapter.startTime)
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
            timeSec: chapterSeekSec || 0,
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
            timeSec: chapterSeekSec || 0,
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
            const queryParams: string[] = ['isOutside=true', 'p=1', 'autoplay=1']
            if (sourceId.startsWith('BV') || sourceId.startsWith('bv')) {
                queryParams.push(`bvid=${sourceId}`)
            } else if (/^\d+$/.test(sourceId)) {
                queryParams.push(`aid=${sourceId}`)
            } else {
                queryParams.push(`bvid=${sourceId}`)
            }
            if (chapterSeekSec !== null && chapterSeekSec > 0) {
                queryParams.push(`t=${chapterSeekSec}`)
            }
            const src = `//player.bilibili.com/player.html?${queryParams.join('&')}`

            return (
                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                    <iframe
                        key={`${selectedVideo.id}-${activeMirror?.id || 'primary'}-${chapterSeekSec || 0}`}
                        src={src}
                        scrolling="no"
                        frameBorder="0"
                        allowFullScreen={true}
                        className="w-full h-full border-0"
                    ></iframe>
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

        if (platform === 'custom') {
            return (
                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                    <iframe
                        key={`${selectedVideo.id}-${activeMirror?.id || 'custom'}`}
                        className="w-full h-full"
                        src={sourceId}
                        title={selectedVideo.title}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    ></iframe>
                </div>
            )
        }

        return null
    }

    const renderVideoItem = (item: NavigationSubItem) => {
        const isSelected = selectedVideo?.id === item.id
        const hasVideoConfig = !!item.videoConfig

        return (
            <button
                key={item.id}
                onClick={() => hasVideoConfig && setSelectedVideo(item)}
                disabled={!hasVideoConfig}
                className={cn(
                    "w-full text-left px-3 py-2 rounded-lg transition-all duration-200 flex items-start gap-2",
                    "hover:bg-accent/50",
                    isSelected && "bg-primary/10 text-primary border-l-2 border-primary",
                    !hasVideoConfig && "opacity-50 cursor-not-allowed"
                )}
            >
                <PlayCircle className={cn(
                    "w-4 h-4 mt-0.5 flex-shrink-0",
                    isSelected ? "text-primary" : "text-muted-foreground"
                )} />
                <span className="text-sm line-clamp-2">{item.title}</span>
            </button>
        )
    }

    const renderSubCategory = (sub: NavigationCategory) => {
        const isExpanded = expandedSubCategories.has(sub.id)
        const videoItems = (sub.items || []).filter(item => item.enabled !== false)

        if (videoItems.length === 0) return null

        return (
            <div key={sub.id} className="ml-2">
                <button
                    onClick={() => toggleSubCategory(sub.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/30 rounded-md transition-colors"
                >
                    {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                    ) : (
                        <ChevronRight className="w-4 h-4" />
                    )}
                    <span>{sub.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground/60">{videoItems.length}</span>
                </button>
                {isExpanded && (
                    <div className="ml-4 mt-1 space-y-0.5">
                        {videoItems.map(item => renderVideoItem(item))}
                    </div>
                )}
            </div>
        )
    }

    const renderCategory = (category: NavigationItem) => {
        const isExpanded = expandedCategories.has(category.id)
        const hasSubCategories = category.subCategories && category.subCategories.length > 0
        const directItems = (category.items || []).filter(item => item.enabled !== false)
        const totalItems = hasSubCategories
            ? category.subCategories!.reduce((sum, sub) => sum + (sub.items?.length || 0), 0)
            : directItems.length

        if (totalItems === 0) return null

        return (
            <div key={category.id} className="mb-2">
                <button
                    onClick={() => toggleCategory(category.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 font-medium hover:bg-accent/50 rounded-lg transition-colors"
                >
                    {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-primary" />
                    ) : (
                        <ChevronRight className="w-5 h-5" />
                    )}
                    <span>{category.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {totalItems}
                    </span>
                </button>
                {isExpanded && (
                    <div className="mt-1 space-y-1">
                        {hasSubCategories ? (
                            category.subCategories!.map(sub => renderSubCategory(sub))
                        ) : (
                            <div className="ml-4 space-y-0.5">
                                {directItems.map(item => renderVideoItem(item))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Schema.org VideoObject 搜索引擎结构化数据 */}
            {videoSchema && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(videoSchema) }}
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
                            title="4K / 超分辨率着色器 (CAS 锐化)"
                            onClick={() => setShowShaderDialog(true)}
                        >
                            <Sparkles className={cn("w-4 h-4", sharpenerOptions.enabled ? "text-amber-400" : "text-muted-foreground")} />
                        </Button>
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

                        {/* 客户端热力波形时间轴 */}
                        <VideoHeatmapTimeline
                            durationSec={selectedVideo?.videoConfig?.durationSec || 600}
                            currentSec={chapterSeekSec || 0}
                            chapters={chapters}
                            danmaku={danmakuList}
                            onSeek={(sec) => setChapterSeekSec(sec)}
                        />

                        {/* 双语卡拉OK逐字字幕与术语释义 */}
                        {transcriptList.length > 0 && (
                            <VideoKaraokeSubtitles
                                transcript={transcriptList}
                                currentSec={chapterSeekSec || 0}
                                mode="bilingual"
                            />
                        )}

                        {/* 上下一集连播快捷条 */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/40">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    disabled={currentIndex <= 0}
                                    onClick={handlePrevVideo}
                                    title="上一部视频 ( [ 键 )"
                                >
                                    <SkipBack className="w-3.5 h-3.5" />
                                    上一部
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    disabled={currentIndex < 0 || currentIndex >= allVideos.length - 1}
                                    onClick={handleNextVideo}
                                    title="下一部视频 ( ] 键 )"
                                >
                                    下一部
                                    <SkipForward className="w-3.5 h-3.5" />
                                </Button>

                                {/* 多线路镜像源切换 */}
                                {availableMirrors.length > 0 && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                                                <Layers className="w-3.5 h-3.5 text-primary" />
                                                <span>{activeMirror?.label || '线路切换'}</span>
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" className="w-48 text-xs">
                                            {availableMirrors.map(m => (
                                                <DropdownMenuItem
                                                    key={m.id}
                                                    onClick={() => handleSwitchMirror(m.id)}
                                                    className="flex items-center justify-between cursor-pointer"
                                                >
                                                    <span>{m.label}</span>
                                                    {activeMirror?.id === m.id && <Check className="w-3.5 h-3.5 text-primary ml-2 shrink-0" />}
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}

                                {/* 稍后再看 */}
                                <Button
                                    variant={inWatchLater ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={handleToggleWatchLater}
                                    title="加入/移出稍后再看"
                                >
                                    {inWatchLater ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                                    <span>{inWatchLater ? '已在稍后再看' : '稍后再看'}</span>
                                </Button>

                                {/* 章节大纲快捷入口 */}
                                <Button
                                    variant={activeTab === 'chapters' ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setActiveTab('chapters')}
                                >
                                    <ListCollapse className="w-3.5 h-3.5 text-primary" />
                                    <span>AI 章节 ({chapters.length})</span>
                                </Button>

                                {/* 演练沙箱入口 */}
                                <Button
                                    variant={showSandbox ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowSandbox(prev => !prev)}
                                    title="代码演练沙箱"
                                >
                                    <Code2 className="w-3.5 h-3.5" />
                                    <span>{showSandbox ? '收起沙箱' : '演练沙箱'}</span>
                                </Button>

                                {/* 学习笔记 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowNoteDialog(true)}
                                    title="记录时间戳笔记"
                                >
                                    <Camera className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>记笔记</span>
                                </Button>

                                {/* 代码演进 */}
                                {codeMilestones.length > 0 && (
                                    <Button
                                        variant={activeTab === 'diff' ? 'secondary' : 'outline'}
                                        size="sm"
                                        className="h-8 gap-1.5 text-xs"
                                        onClick={() => setActiveTab('diff')}
                                        title="代码演进与前后对比"
                                    >
                                        <GitCompare className="w-3.5 h-3.5 text-blue-500" />
                                        <span>代码演进 ({codeMilestones.length})</span>
                                    </Button>
                                )}

                                {/* 知识脑图 */}
                                <Button
                                    variant={activeTab === 'mindmap' ? 'secondary' : 'outline'}
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setActiveTab('mindmap')}
                                    title="AI 知识图谱与脑图"
                                >
                                    <FolderTree className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>知识脑图</span>
                                </Button>

                                {/* 课后测验 */}
                                {quizQuestions.length > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1.5 text-xs"
                                        onClick={() => setShowQuizDialog(true)}
                                        title="章节通关与课后自测"
                                    >
                                        <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
                                        <span>自测 ({quizQuestions.length}题)</span>
                                    </Button>
                                )}

                                {/* 终端会话回放 */}
                                <Button
                                    variant={activeTab === 'terminal' ? 'secondary' : 'outline'}
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setActiveTab('terminal')}
                                    title="终端命令行实战会话回放"
                                >
                                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>终端回放</span>
                                </Button>

                                {/* 分享海报 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowPosterDialog(true)}
                                    title="生成精美时间戳分享卡片"
                                >
                                    <Share2 className="w-3.5 h-3.5 text-pink-500" />
                                    <span>分享海报</span>
                                </Button>

                                {/* 艾宾浩斯抽认卡 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowFlashcardsDialog(true)}
                                    title="艾宾浩斯遗忘曲线抽认卡与复习日程"
                                >
                                    <Brain className="w-3.5 h-3.5 text-indigo-500" />
                                    <span>抽认卡 ({flashcards.length})</span>
                                </Button>

                                {/* 结业微证书 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowCertDialog(true)}
                                    title="全套课程通关与可验证结业微证书"
                                >
                                    <Award className="w-3.5 h-3.5 text-yellow-500" />
                                    <span>结业证书</span>
                                </Button>

                                {/* 屏幕涂鸦白板 */}
                                <Button
                                    variant={showTelestrator ? 'secondary' : 'outline'}
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowTelestrator(prev => !prev)}
                                    title="同屏白板涂鸦与时间戳画笔"
                                >
                                    <PenTool className="w-3.5 h-3.5 text-sky-400" />
                                    <span>{showTelestrator ? '收起涂鸦' : '屏幕涂鸦'}</span>
                                </Button>

                                {/* 画面代码提取 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowOcrDialog(true)}
                                    title="端侧提取当前画面中的代码与终端命令"
                                >
                                    <ScanText className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>画面提取</span>
                                </Button>

                                {/* 智能静音加速 */}
                                <Button
                                    variant={smartSpeedConfig.enabled ? 'secondary' : 'outline'}
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowSmartSpeedDialog(true)}
                                    title="自适应静音跳跃与倍速调节"
                                >
                                    <Zap className={cn("w-3.5 h-3.5", smartSpeedConfig.enabled ? "text-amber-500 fill-amber-500" : "text-amber-500")} />
                                    <span>智能加速</span>
                                </Button>

                                {/* 离线下载缓存 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowOfflineDialog(true)}
                                    title="PWA 本地加密缓存与断网播放"
                                >
                                    <DownloadCloud className="w-3.5 h-3.5 text-blue-400" />
                                    <span>离线缓存</span>
                                </Button>

                                {/* 桌面画中画伴学悬浮窗 */}
                                <VideoPipWindowRenderer
                                    videoTitle={selectedVideo?.title || '技术课程'}
                                    currentSubtitle={transcriptList[0]?.text}
                                    lastCodeCommand={codeMilestones[0]?.code.split('\n')[0]}
                                />

                                {/* 双语字幕 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowBilingualSubtitlesDialog(true)}
                                    title="双语字幕实时对齐与 SRT/WebVTT 导出"
                                >
                                    <Languages className="w-3.5 h-3.5 text-indigo-400" />
                                    <span>双语字幕</span>
                                </Button>

                                {/* 声波谱图 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowSpectrogramDialog(true)}
                                    title="实时音频波形频谱与共振峰分析"
                                >
                                    <Activity className="w-3.5 h-3.5 text-rose-400" />
                                    <span>声波谱图</span>
                                </Button>

                                {/* 工程导出 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowWorkspaceExportDialog(true)}
                                    title="一键打包生成完整 Git 工程与 Gist"
                                >
                                    <FolderArchive className="w-3.5 h-3.5 text-amber-400" />
                                    <span>工程导出</span>
                                </Button>

                                {/* 时空漫游复盘 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowSessionReplayDialog(true)}
                                    title="学习会话时空漫游与认知负荷复盘"
                                >
                                    <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>会话复盘</span>
                                </Button>

                                {/* WebGPU 神经网络音频降噪 */}
                                <Button
                                    variant={neuralDenoiseConfig.enabled ? 'secondary' : 'outline'}
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowNeuralDenoiseDialog(true)}
                                    title="WebGPU 神经网络音频实时降噪与人声增强"
                                >
                                    <Cpu className={cn("w-3.5 h-3.5", neuralDenoiseConfig.enabled ? "text-emerald-400" : "text-muted-foreground")} />
                                    <span>AI 降噪</span>
                                </Button>

                                {/* 视频微知识点一键切片 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowClipMakerDialog(true)}
                                    title="精细微知识点切片与 WebM/GIF 动图导出"
                                >
                                    <Scissors className="w-3.5 h-3.5 text-amber-400" />
                                    <span>微切片</span>
                                </Button>

                                {/* 深度沉浸番茄钟 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowPomodoroDialog(true)}
                                    title="深度沉浸学习番茄钟与粉红噪音白噪音"
                                >
                                    <Timer className="w-3.5 h-3.5 text-rose-400" />
                                    <span>专注番茄</span>
                                </Button>

                                {/* 分布式 WebRTC P2P 弹幕信标网格 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowDanmakuMeshDialog(true)}
                                    title="分布式 WebRTC P2P 弹幕信标网格监控"
                                >
                                    <Network className="w-3.5 h-3.5 text-sky-400" />
                                    <span>P2P 网格</span>
                                </Button>

                                {/* 多轨解耦调音台 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowStemMixerDialog(true)}
                                    title="人声/伴奏/杂音独立分轨推子混音台"
                                >
                                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                                    <span>分轨调音</span>
                                </Button>

                                {/* P2P 视频分片蜂群 HUD */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowP2PSwarmHud(true)}
                                    title="WebRTC 视频切片 P2P-CDN 蜂群位图遥测"
                                >
                                    <Network className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>P2P 蜂群</span>
                                </Button>

                                {/* 贝叶斯自适应弱项诊断 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs"
                                    onClick={() => setShowRemedyDialog(true)}
                                    title="贝叶斯自适应知识追踪与薄弱点诊断"
                                >
                                    <Brain className="w-3.5 h-3.5 text-purple-400" />
                                    <span>弱项诊断</span>
                                </Button>

                                {/* 全网热点自动采集 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                                    onClick={() => setShowAutoHarvestDialog(true)}
                                    title="一键启动全网多源开发者技术热点视频采集"
                                >
                                    <Flame className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                                    <span>热点采集</span>
                                </Button>

                                {/* AI 全程自主采集控制台 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10"
                                    onClick={() => setShowAutonomousHarvestConsole(true)}
                                    title="启动 AI 全程无人值守视频采集与大模型审核流水线"
                                >
                                    <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
                                    <span>AI自主采集</span>
                                </Button>

                                {/* 多源 Webhook 调度 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                    onClick={() => setShowWebhookDialog(true)}
                                    title="多源数据流与 Webhook 自动化回调"
                                >
                                    <Webhook className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Webhook</span>
                                </Button>

                                {/* 智能抽帧 OCR */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10"
                                    onClick={() => setShowWasmOcrDialog(true)}
                                    title="Wasm 视频画面代码智能抽帧与 OCR 提取"
                                >
                                    <ScanText className="w-3.5 h-3.5 text-indigo-400" />
                                    <span>智能抽帧</span>
                                </Button>

                                {/* 双语同传与 TTS */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
                                    onClick={() => setShowBilingualTtsDialog(true)}
                                    title="AI 实时双语字幕与语音重译旁白"
                                >
                                    <Languages className="w-3.5 h-3.5 text-cyan-400" />
                                    <span>双语TTS</span>
                                </Button>

                                {/* 概念图谱 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                    onClick={() => setShowConceptGraphDialog(true)}
                                    title="交互式全站概念拓扑图谱与 Dijkstra 最短学习路径"
                                >
                                    <Network className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>概念图谱</span>
                                </Button>

                                {/* 伴学自习室 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 text-xs border-pink-500/40 text-pink-400 hover:bg-pink-500/10"
                                    onClick={() => setShowStudyRoomDialog(true)}
                                    title="WebRTC / CRDT 伴学自习室与多人协同白板"
                                >
                                    <Users className="w-3.5 h-3.5 text-pink-400" />
                                    <span>伴学自习室</span>
                                </Button>
                            </div>
                            <span className="text-xs text-muted-foreground font-mono">
                                {currentIndex >= 0 ? `${currentIndex + 1} / ${allVideos.length}` : ''}
                            </span>
                        </div>

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

                {/* 右侧播放列表与历史切换 */}
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
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'mindmap' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('mindmap')}
                            >
                                脑图
                            </button>
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
                                    activeTab === 'debugger' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('debugger')}
                            >
                                调试器
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'testrunner' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('testrunner')}
                            >
                                TDD测试
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'sandbox' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('sandbox')}
                            >
                                联调沙盒
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'terminal' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('terminal')}
                            >
                                终端
                            </button>
                            <button
                                className={cn(
                                    "flex-1 py-1 px-1.5 rounded-md font-medium transition-all text-center whitespace-nowrap",
                                    activeTab === 'wasm' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('wasm')}
                            >
                                沙箱
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
                                    activeTab === 'copilot' ? "bg-background shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => setActiveTab('copilot')}
                            >
                                AI 伴学
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
                                {navigationData.navigationItems.map(category => renderCategory(category))}
                            </div>
                        )}

                        {activeTab === 'chapters' && (
                            <div className="p-3 space-y-3">
                                {aiSummary?.overview && (
                                    <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground leading-relaxed">
                                        <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
                                            <Sparkles className="w-3.5 h-3.5 text-primary" />
                                            <span>AI 核心摘要</span>
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
                                                    {formatDuration(ch.startTime)}
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
                                                                onClick={() => handleCopyCode(ch.id, ch.codeSnippet!)}
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

                        {activeTab === 'mindmap' && selectedVideo && (
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

                        {activeTab === 'debugger' && (
                            <div className="p-3">
                                <VideoDebuggerStepperPane
                                    initialCode={codeMilestones[0]?.code || '// 交互式断点调试器\nfunction calculateProgress(time, total) {\n  let ratio = time / total;\n  if (ratio > 1) ratio = 1;\n  return Math.round(ratio * 100);\n}\nlet currentProgress = calculateProgress(120, 600);\nconsole.log("Current progress:", currentProgress);'}
                                />
                            </div>
                        )}

                        {activeTab === 'testrunner' && (
                            <div className="p-3">
                                <VideoLiveTestPane
                                    chapterTitle={selectedVideo?.title}
                                />
                            </div>
                        )}

                        {activeTab === 'sandbox' && (
                            <div className="p-3 h-[520px]">
                                <VideoSandboxRunnerPane initialCode={sandboxInitialCode} />
                            </div>
                        )}

                        {activeTab === 'terminal' && (
                            <div className="p-3">
                                <VideoTerminalPlayer
                                    currentSec={chapterSeekSec || 0}
                                    title={selectedVideo?.title}
                                    onSeek={(sec) => setChapterSeekSec(sec)}
                                />
                            </div>
                        )}

                        {activeTab === 'wasm' && (
                            <div className="p-3">
                                <VideoWasmTerminalPane
                                    initialLanguage="bash"
                                    initialCode={`# 在此极速执行命令行或脚本
echo "WebAssembly Linux/POSIX runtime ready!"
uname -a
ls -la /workspace`}
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
                                    <input aria-label="搜索字幕"
                                        type="text"
                                        value={transcriptSearchQuery}
                                        onChange={e => setTranscriptSearchQuery(e.target.value)}
                                        placeholder="搜索字幕与关键词..."
                                        className="flex-1 px-2.5 py-1 text-xs rounded-md bg-card border border-border/50 focus:outline-none"
                                    />
                                    <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={handleExportTranscript}>
                                        <Download className="w-3 h-3" /> 导出
                                    </Button>
                                </div>
                                <div className="space-y-1.5">
                                    {filteredTranscript.length === 0 ? (
                                        <p className="text-xs text-muted-foreground text-center py-10">未找到匹配字幕</p>
                                    ) : (
                                        filteredTranscript.map((t) => (
                                            <button
                                                key={t.id}
                                                onClick={() => handleSeekToChapter({ startTime: t.startSec, id: t.id, title: t.text })}
                                                className="w-full text-left p-2 rounded-lg hover:bg-accent/40 border border-transparent hover:border-border/40 transition-all text-xs space-y-0.5 group"
                                            >
                                                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                                                    <span>{formatDuration(t.startSec)}</span>
                                                </div>
                                                <p className="text-foreground group-hover:text-primary transition-colors leading-relaxed">
                                                    {t.text}
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

                        {activeTab === 'copilot' && (
                            <div className="p-3">
                                <VideoAssistantCopilot
                                    transcripts={transcriptList}
                                    onSeek={(sec) => setChapterSeekSec(sec)}
                                />
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
            </div>

            {/* 移动端底部播放列表 */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur pb-[max(env(safe-area-inset-bottom,0px),0px)]">
                <ScrollArea className="h-48">
                    <div className="p-3 space-y-1">
                        {navigationData.navigationItems.map(category => renderCategory(category))}
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
                                    <span className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
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

            {/* CAS 超分锐化着色器调节弹窗 */}
            <VideoShaderFilterDialog
                open={showShaderDialog}
                onOpenChange={setShowShaderDialog}
                options={sharpenerOptions}
                onChange={setSharpenerOptions}
            />

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
                courseTitle={selectedVideo?.title || '全栈高级工程进阶'}
                quizScore={88}
                notesCount={notesList.length}
                watchDurationSec={selectedVideo?.videoConfig?.durationSec || 1800}
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

            {/* 音频频谱与共振峰可视化弹窗 */}
            <VideoSpectrogramDialog
                open={showSpectrogramDialog}
                onOpenChange={setShowSpectrogramDialog}
            />

            {/* Git 工程与 Gist 导出弹窗 */}
            <VideoWorkspaceExportDialog
                open={showWorkspaceExportDialog}
                onOpenChange={setShowWorkspaceExportDialog}
                courseTitle={selectedVideo?.title || '技术实战'}
                videoId={selectedVideo?.id || 'demo'}
                milestones={codeMilestones}
                notes={notesList}
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

            {/* WebGPU 神经网络音频降噪控制弹窗 */}
            <VideoNeuralAudioControls
                open={showNeuralDenoiseDialog}
                onOpenChange={setShowNeuralDenoiseDialog}
                config={neuralDenoiseConfig}
                onConfigChange={(newCfg) => setNeuralDenoiseConfig(prev => ({ ...prev, ...newCfg }))}
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

            {/* 分布式 WebRTC P2P 弹幕信标网格监控弹窗 */}
            <VideoDanmakuMeshMonitor
                open={showDanmakuMeshDialog}
                onOpenChange={setShowDanmakuMeshDialog}
                videoId={selectedVideo?.id || 'demo'}
            />

            {/* 多轨音频解耦混音台弹窗 */}
            <VideoAudioStemMixerDialog
                open={showStemMixerDialog}
                onOpenChange={setShowStemMixerDialog}
            />

            {/* WebRTC 视频切片 P2P-CDN 蜂群遥测 HUD 弹窗 */}
            <VideoP2PSwarmHud
                open={showP2PSwarmHud}
                onOpenChange={setShowP2PSwarmHud}
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
