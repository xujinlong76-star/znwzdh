'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  History,
  RotateCcw,
  Keyboard,
  X,
  PictureInPicture,
  Sparkles,
  Camera,
  MessageSquare,
  Send,
} from 'lucide-react'
import { Button } from "@/registry/new-york/ui/button"
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/registry/new-york/ui/scroll-area'
import { formatDuration } from '@/lib/video-format'
import {
  NEXT_VIDEO_PROGRESS_HIGH,
  buildNextVideoCandidates,
  getSharedRoutePrefetchSession,
  isRoutePrefetchNetworkAllowed,
  progressRatio,
  tryClaimRoutePrefetch,
  type PrefetchConnectionLike,
} from '@/lib/route-prefetch'
import { useVideoPlayerState } from '@/hooks/useVideoPlayerState'
import { useHandoffCloudSync } from '@/hooks/use-handoff-cloud-sync'
import { getResumePosition, savePlaybackPosition } from '@/lib/video-playback-storage'
import {
  createPlaybackSaveThrottle,
  markPlaybackSaved,
  seedPlaybackSaveThrottle,
  shouldSavePlaybackPosition,
  type PlaybackSaveThrottle,
} from '@/lib/video-playback-throttle'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { resolveAvailableMirrors, selectBestMirror, recordMirrorFailover } from '@/lib/video-failover'
import { getVideoAISummary, type VideoAISummary } from '@/lib/video-ai-summary'
import { isInWatchLater, toggleWatchLater, PLAYLIST_UPDATE_EVENT } from '@/lib/user-playlists'
import { getRelatedVideos } from '@/lib/video-recommendation'
import { useVideoPlayer } from '@/contexts/VideoPlayerContext'
import { searchTranscript, exportTranscriptAsMarkdown } from '@/lib/video-transcript-sync'
import {
  deleteCaptionEntry,
  getCaptionEntry,
  resolveVideoCaptions,
  saveCaptionEntry,
  type CaptionSource,
} from '@/lib/video-caption-store'
import { saveStudyNote, listStudyNotes, exportNotesAsMarkdown, type VideoStudyNote } from '@/lib/video-frame-clipper'
import { getStoredDanmaku, saveDanmakuItem } from '@/lib/video-danmaku-engine'
// 语音指示器是辅助可视化：动态导入，不占播放器首屏包体积（预算紧）。
const VideoVoiceIndicator = dynamic(() => import('@/components/video-voice-indicator').then(m => m.VideoVoiceIndicator), { ssr: false })
import { VideoNetworkSentinel } from '@/components/video-network-sentinel'
// 涂鸦层与 PiP 渲染层只在对应模式开启时才用到：动态导入，不占播放器首屏包体积。
const VideoTelestratorCanvas = dynamic(() => import('@/components/video-telestrator-canvas').then(m => m.VideoTelestratorCanvas), { ssr: false })
const VideoPipWindowRenderer = dynamic(() => import('@/components/video-pip-window-renderer').then(m => m.VideoPipWindowRenderer), { ssr: false })
import { extractCodeMilestones, type CodeMilestone } from '@/lib/video-code-diff'
import { generateVideoMindMap, type MindMapNode } from '@/lib/video-mindmap-generator'
import { generateVideoObjectSchema } from '@/lib/video-seo'
import { createQoETracker, type QoEMetrics } from '@/lib/video-qoe-telemetry'
import { generateFlashcardsFromNotes, type FlashcardItem } from '@/lib/video-spaced-repetition'
import { type VoiceCommandIntent } from '@/lib/video-voice-commander'
import {
  dispatchVoiceCommand,
  type PlayerCommandResult,
  type VideoVoiceExecutor,
  type VoiceCommandResult,
  type VoicePlatformKind,
} from '@/lib/video-voice-dispatch'
import { isDocumentPipSupported } from '@/lib/video-document-pip'
import type { VideoBilibiliHdPlayerHandle as BiliPlayerHandle } from '@/components/video-bilibili-hd-player'
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
const VideoSharePosterDialog = dynamic(() => import('@/components/video-share-poster-dialog').then(m => m.VideoSharePosterDialog), { ssr: false })
const VideoAiLearningDialog = dynamic(() => import('@/components/video-ai-learning-dialog').then(m => m.VideoAiLearningDialog), { ssr: false })
const VideoOfflineManager = dynamic(() => import('@/components/video-offline-manager').then(m => m.VideoOfflineManager), { ssr: false })
const VideoWorkspaceExportDialog = dynamic(() => import('@/components/video-workspace-export-dialog').then(m => m.VideoWorkspaceExportDialog), { ssr: false })
const VideoBilingualSubtitlesDialog = dynamic(() => import('@/components/video-bilingual-subtitles-dialog').then(m => m.VideoBilingualSubtitlesDialog), { ssr: false })
const VideoClipMakerDialog = dynamic(() => import('@/components/video-clip-maker-dialog').then(m => m.VideoClipMakerDialog), { ssr: false })
const VideoPomodoroDialog = dynamic(() => import('@/components/video-pomodoro-overlay').then(m => m.VideoPomodoroDialog), { ssr: false })
const VideoAutoHarvestDialog = dynamic(() => import('@/components/video-auto-harvest-dialog').then(m => m.VideoAutoHarvestDialog), { ssr: false })
const VideoMultisourceWebhookDialog = dynamic(() => import('@/components/video-multisource-webhook-dialog').then(m => m.VideoMultisourceWebhookDialog), { ssr: false })
const VideoBilingualTtsDialog = dynamic(() => import('@/components/video-bilingual-tts-dialog').then(m => m.VideoBilingualTtsDialog), { ssr: false })
// 字幕导入只在用户点「导入字幕」时才挂载，不占播放器首屏包体积。
const VideoCaptionImportDialog = dynamic(() => import('@/components/video-caption-import-dialog').then(m => m.VideoCaptionImportDialog), { ssr: false })
// 播放器只在 bilibili 分支挂载、字幕只在有转写稿时挂载：这两块移出首屏图
const VideoBilibiliHdPlayer = dynamic(() => import('@/components/video-bilibili-hd-player').then(m => m.VideoBilibiliHdPlayer), { ssr: false })
const VideoKaraokeSubtitles = dynamic(() => import('@/components/video-karaoke-subtitles').then(m => m.VideoKaraokeSubtitles), { ssr: false })

interface VideoPlayerPageProps {
    navigationData: NavigationData
    siteData: SiteConfig
}

/**
 * 断点续播写路径的当前视频快照（Batch 3 第 9 项 A 组）。
 * hasPlayhead 只有收到过真实播放头时才为 true（Bilibili 直连 / mp4 原生
 * <video>）；YouTube 与通用 iframe 取不到播放头，恒为 false，flush 直接
 * 跳过——只记「打开过 + 打开时间」（open 写入负责），不断点秒数。
 */
interface PlaybackSnapshot {
    video: NavigationSubItem
    sec: number
    durationSec: number
    platform: 'bilibili' | 'youtube' | 'other'
    hasPlayhead: boolean
}

/** 播放历史只为 bilibili/youtube/other 建模，其余平台（含 custom）统一落到 'other'。 */
function resolvePlaybackPlatform(video: NavigationSubItem): 'bilibili' | 'youtube' | 'other' {
    const type = video.videoConfig?.type
    return type === 'bilibili' || type === 'youtube' ? type : 'other'
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
    /** 分享海报 / 章节直达链路带进来的 ?t= 跳转秒数：初次选片时一次性交给 chapterSeekSec，之后清零 */
    const pendingSeekSecRef = useRef<number | null>(null)
    const [biliEngine, setBiliEngine] = useState<string>('auto')
    /** B站播放器当前通道（direct / proxy 原生 <video> 可控；iframe 官方内嵌不可控）。
     *  由播放器 onStageChange 上报，语音可控性判断用。 */
    const [biliStage, setBiliStage] = useState<'direct' | 'proxy' | 'iframe'>('direct')
    /** 语音命令总线：B站直连播放器与 mp4 直链 <video> 的命令柄。 */
    const biliPlayerRef = useRef<BiliPlayerHandle | null>(null)
    const mp4VideoRef = useRef<HTMLVideoElement | null>(null)
    const [showPosterDialog, setShowPosterDialog] = useState<boolean>(false)

    // AI 学习中心（AI伴学 / 概念图谱 / 抽认卡三件套合为一个入口）
    const [showAiLearningDialog, setShowAiLearningDialog] = useState<boolean>(false)

    // 进阶扩展：涂鸦画板、离线缓存
    const [showTelestrator, setShowTelestrator] = useState<boolean>(false)
    const [showOfflineDialog, setShowOfflineDialog] = useState<boolean>(false)

    // 扩展前沿：工程包导出、双语字幕、会话时空漫游
    const [showWorkspaceExportDialog, setShowWorkspaceExportDialog] = useState<boolean>(false)
    const [showBilingualSubtitlesDialog, setShowBilingualSubtitlesDialog] = useState<boolean>(false)

    // 微知识点切片、深度专注番茄钟
    const [showClipMakerDialog, setShowClipMakerDialog] = useState<boolean>(false)
    const [showPomodoroDialog, setShowPomodoroDialog] = useState<boolean>(false)

    // 演进模块：全网热点自动采集
    const [showAutoHarvestDialog, setShowAutoHarvestDialog] = useState<boolean>(false)
    const [showWebhookDialog, setShowWebhookDialog] = useState<boolean>(false)
    const [showBilingualTtsDialog, setShowBilingualTtsDialog] = useState<boolean>(false)

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

    // 逐字稿音视频字幕
    const [transcriptList, setTranscriptList] = useState<VideoTranscriptItem[]>([])
    const [transcriptSearchQuery, setTranscriptSearchQuery] = useState<string>('')
    // 字幕来源与导入状态（字幕可搜）：imported 优先于视频自带字幕。
    const [captionSource, setCaptionSource] = useState<CaptionSource>('none')
    const [importedCaptionCount, setImportedCaptionCount] = useState<number>(0)
    const [showCaptionImport, setShowCaptionImport] = useState<boolean>(false)

    const { openVideo: openGlobalVideo, requestDocumentPiP } = useVideoPlayer()

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

    /**
     * F-02：播放器内换片同步 URL 的 ?id=（replaceState，不产生多余历史记录），
     * 刷新 / 分享 / 后退回到当前这部，而不是第一部。全部换片入口都走这里，
     * 不再直接 setSelectedVideo。id 不变时不写 URL（保留 ?t= 直达秒数）；
     * 换片时删掉旧视频的 ?t=，避免刷新后把旧时间戳套到新视频上。
     * 第 83 轮 C 线：换片时同步清零 chapterSeekSec——断点续播 / 章节跳转置
     * 位后若不清理，下一次渲染仍会把旧秒数带给新视频（B站 seekSec、YouTube
     * &start=、mp4 currentTime），笔记 / 弹幕的 timeSec 回退值也会取到过期
     * 值。清零放在 id 变化分支内：id 不变时不清理，保留 ?t= 直达语义；初次
     * 选片带 ?t= 时走 id 不变早退，pendingSeekSecRef 随后在 selectedVideo
     * 副作用里一次性交接，不受影响。
     */
    const handleSelectVideo = useCallback((video: NavigationSubItem | null) => {
        setSelectedVideo(video)
        if (!video || typeof window === 'undefined') return
        const params = new URLSearchParams(window.location.search)
        if (params.get('id') === video.id) return
        // 换片时清零 chapterSeekSec：与 setSelectedVideo 同一批次提交，下一次
        // 渲染新视频即不再带旧秒数；id 不变时早退，不清理（保留 ?t= 直达）。
        setChapterSeekSec(null)
        params.set('id', video.id)
        params.delete('t')
        const query = params.toString()
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    }, [])

    // 注意：这里不再保留 currentTimeSec 的 ref 镜像。语音相对跳转的基数
    // 只在 dispatch 层用注入的 currentTimeSec（可控路由才有真实进度）；
    // iframe 路由没有可读播放头，相对跳转在 dispatch 层直接拒绝，不再
    // 经 ref 走「重载跳转」回退——旧回退用的正是会残留上一条视频的过期值。

    /**
     * 当前视频的播放路由（平台 / 源 id / 内嵌地址 / 是否 mp4 直链）。
     * 原先散在 renderVideoPlayer 各分支里重复算；语音执行器与渲染共用同一份，
     * 避免两处口径漂移（纯函数，可放心提到组件层）。
     */
    const videoRoute = useMemo(() => {
        if (!selectedVideo?.videoConfig) return null
        const platform = activeMirror?.platform || selectedVideo.videoConfig.type
        const sourceId = activeMirror?.sourceId || selectedVideo.videoConfig.bvid || selectedVideo.videoConfig.videoId || ''
        const embedUrl =
            buildVideoEmbedUrlForSeo({
                ...selectedVideo.videoConfig,
                type: platform,
                videoId: sourceId,
            }) || (platform === 'custom' ? safeHref(sourceId || selectedVideo.href) : undefined)
        const isMp4Direct = !!embedUrl && /\.(mp4|webm|ogg)(\?.*)?$/i.test(embedUrl)
        return { platform, sourceId, embedUrl, isMp4Direct }
    }, [selectedVideo, activeMirror])

    /** 语音可控性：只有 B站直连/代理与 mp4 直链能被页面 JS 直接控制；B站官方
     *  内嵌、YouTube、通用 iframe 跨域无控制通道。label 进不支持回执文案。 */
    const voicePlatform = useMemo((): { kind: VoicePlatformKind; label: string } => {
        if (!videoRoute) return { kind: 'iframe', label: '外站播放页' }
        if (videoRoute.platform === 'youtube') return { kind: 'iframe', label: 'YouTube' }
        if (videoRoute.platform === 'bilibili') {
            if (biliStage === 'iframe') return { kind: 'iframe', label: '官方内嵌播放器' }
            return {
                kind: 'controllable',
                label: biliStage === 'proxy' ? 'B站代理播放' : 'B站高清直连',
            }
        }
        if (videoRoute.isMp4Direct) return { kind: 'controllable', label: '直链视频' }
        return { kind: 'iframe', label: '内嵌播放器' }
    }, [videoRoute, biliStage])

    const handleNextVideo = useCallback(() => {
        if (currentIndex >= 0 && currentIndex < allVideos.length - 1) {
            handleSelectVideo(allVideos[currentIndex + 1])
        }
    }, [currentIndex, allVideos, handleSelectVideo])

    const handlePrevVideo = useCallback(() => {
        if (currentIndex > 0) {
            handleSelectVideo(allVideos[currentIndex - 1])
        }
    }, [currentIndex, allVideos, handleSelectVideo])

    const router = useRouter()

    /**
     * A1 视频下一集预取——本文件是唯一允许发「下一集预取」的地方，
     * 不许在 video-card.tsx 里另起一套。
     * 进度 >75% 时预取下一集（high）+ 再下一集（low、最多 1 条）的 RSC；
     * 进度 <75% 且无悬停时不预取。只预取路由与元数据（元数据已在 allVideos
     * 里，不另发请求），不预取 iframe、不预取视频流。
     * 会话 ≤5 条预算与 Provider 共用同一共享会话（getSharedRoutePrefetchSession）。
     */
    useEffect(() => {
        if (!selectedVideo || currentIndex < 0 || currentIndex >= allVideos.length - 1) return
        const ratio = progressRatio(currentTimeSec, selectedVideo.videoConfig?.durationSec)
        if (!(ratio > NEXT_VIDEO_PROGRESS_HIGH)) return
        if (typeof navigator !== 'undefined') {
            const connection = (navigator as Navigator & { connection?: PrefetchConnectionLike }).connection
            if (!isRoutePrefetchNetworkAllowed(connection, navigator.onLine)) return
        }
        const session = getSharedRoutePrefetchSession()
        for (const candidate of buildNextVideoCandidates(allVideos, currentIndex, ratio)) {
            if (tryClaimRoutePrefetch(session, candidate.href)) {
                router.prefetch(candidate.href)
            }
        }
    }, [selectedVideo, currentIndex, currentTimeSec, allVideos, router])

    const {
        // isPlaying 由语音播放/暂停命令经 setIsPlaying 同步（此前是死状态：初始
        // true 且无任何消费方）。读侧仍无消费方，只写不读，故只取 setter。
        setIsPlaying,
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

    // ---- 断点续播写路径（Batch 3 第 9 项 A 组）----
    // 旧状：onTimeUpdate 只更新本地 currentTimeSec，全程不写表；唯一写入点是
    // useVideoPlayerState 打开时 effect，写的是打开那一刻的旧断点。修法：
    // Bilibili 直连与 mp4 两路共用 handlePlaybackTimeUpdate；「何时写」的判定
    // 在 lib/video-playback-throttle.ts（纯函数）；pause / pagehide /
    // visibilitychange(hidden) / 切集 / 关闭时 flushPlaybackPosition 立即写一次。
    // 节流状态以打开时已存断点为基线播种（getResumePosition），15s / 5s 从
    // 该基线算起。仍写同一张本地表，键与结构、95% 看完与 >10s 提示口径全不变。
    //
    // D 组云端接线：每次本机写入的同时（同一节流判定、同一快照），经
    // useHandoffCloudSync 把同一份位置以 UPSERT_VIDEO_PROGRESS 发往云端。
    // 只在已登录时派发（hook 内部把关）；匿名时本机照写、云端不发。
    // dispatch 经 ref 调用：flush / handlePlaybackTimeUpdate 是空依赖的
    // useCallback，identity 变化不能让它们重建（重建会触发切集 effect
    // 的 cleanup 误 flush）。ref 在每次渲染后同步为最新派发函数。
    const handoffCloud = useHandoffCloudSync()
    const cloudDispatchRef = useRef(handoffCloud.dispatchVideoProgress)
    useEffect(() => {
        cloudDispatchRef.current = handoffCloud.dispatchVideoProgress
    }, [handoffCloud.dispatchVideoProgress])

    const playbackSnapshotRef = useRef<PlaybackSnapshot | null>(null)
    const playbackThrottleRef = useRef<PlaybackSaveThrottle>(createPlaybackSaveThrottle())

    const flushPlaybackPosition = useCallback(() => {
        const snapshot = playbackSnapshotRef.current
        // 无真实播放头（YouTube / 通用 iframe）：不写秒数；打开记录已由
        // useVideoPlayerState 的 open 写入负责（只记打开过 + 打开时间）。
        if (!snapshot || !snapshot.hasPlayhead) return
        const nowMs = Date.now()
        if (!shouldSavePlaybackPosition(playbackThrottleRef.current, snapshot.sec, nowMs, { force: true })) return
        savePlaybackPosition({
            videoId: snapshot.video.id,
            title: snapshot.video.title,
            author: snapshot.video.videoConfig?.author,
            cover: snapshot.video.icon,
            platform: snapshot.platform,
            timestampSec: snapshot.sec,
            durationSec: snapshot.durationSec,
        })
        playbackThrottleRef.current = markPlaybackSaved(playbackThrottleRef.current, snapshot.sec, nowMs)
        // D1：与本机写入同一快照、同一时间戳发往云端（已登录才派发）。
        cloudDispatchRef.current({
            videoId: snapshot.video.id,
            title: snapshot.video.title,
            author: snapshot.video.videoConfig?.author,
            cover: snapshot.video.icon,
            platform: snapshot.platform,
            timestampSec: snapshot.sec,
            durationSec: snapshot.durationSec,
            updatedAt: nowMs,
        })
    }, [])

    /** Bilibili 直连与 mp4 两路共用的 onTimeUpdate 入口：只此一处做节流写。 */
    const handlePlaybackTimeUpdate = useCallback((video: NavigationSubItem, currentSec: number, durationSec: number) => {
        const sec = Math.floor(currentSec)
        setCurrentTimeSec(sec)
        const snapshot = playbackSnapshotRef.current
        if (!snapshot || snapshot.video.id !== video.id) return
        const duration = Number.isFinite(durationSec) && durationSec > 0
            ? Math.floor(durationSec)
            : (video.videoConfig?.durationSec || 600)
        snapshot.sec = sec
        snapshot.durationSec = duration
        snapshot.hasPlayhead = true
        const nowMs = Date.now()
        if (!shouldSavePlaybackPosition(playbackThrottleRef.current, sec, nowMs)) return
        savePlaybackPosition({
            videoId: video.id,
            title: video.title,
            author: video.videoConfig?.author,
            cover: video.icon,
            platform: snapshot.platform,
            timestampSec: sec,
            durationSec: duration,
        })
        playbackThrottleRef.current = markPlaybackSaved(playbackThrottleRef.current, sec, nowMs)
        // D1：与本机写入同一快照、同一时间戳发往云端（已登录才派发）。
        cloudDispatchRef.current({
            videoId: video.id,
            title: video.title,
            author: video.videoConfig?.author,
            cover: video.icon,
            platform: snapshot.platform,
            timestampSec: sec,
            durationSec: duration,
            updatedAt: nowMs,
        })
    }, [])

    // 切集 / 关闭时写一次：cleanup 在 selectedVideo 变化或卸载时先跑，此时
    // snapshot 仍指向旧视频；body 再把 snapshot / 节流基线重置为新视频。
    useEffect(() => {
        if (!selectedVideo) {
            playbackSnapshotRef.current = null
            playbackThrottleRef.current = createPlaybackSaveThrottle()
            return
        }
        const resumeSec = getResumePosition(selectedVideo.id)
        playbackSnapshotRef.current = {
            video: selectedVideo,
            sec: resumeSec,
            durationSec: selectedVideo.videoConfig?.durationSec || 600,
            platform: resolvePlaybackPlatform(selectedVideo),
            hasPlayhead: false,
        }
        playbackThrottleRef.current = seedPlaybackSaveThrottle(resumeSec, Date.now())
        return () => {
            flushPlaybackPosition()
        }
    }, [selectedVideo, flushPlaybackPosition])

    // 离开页面 / 切到后台时立即写一次（React 卸载 cleanup 在 pagehide 时不跑）。
    useEffect(() => {
        if (typeof window === 'undefined') return
        const handlePageHide = () => { flushPlaybackPosition() }
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') flushPlaybackPosition()
        }
        window.addEventListener('pagehide', handlePageHide)
        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            window.removeEventListener('pagehide', handlePageHide)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [flushPlaybackPosition])

    // 艾宾浩斯复习抽认卡集（只从用户真实笔记派生；模板自测题已删，不再混入）
    const flashcards = useMemo<FlashcardItem[]>(() => {
        return generateFlashcardsFromNotes(notesList)
    }, [notesList])

    // 语音指令执行器（Batch 3 第 10 项）：把意图落到真实播放器上。
    // 可控路由（B站直连/代理、mp4 直链）走命令总线；iframe 路由的播放类命令
    // 在执行器层即返回 iframe-no-control，跳转则走 chapterSeekSec / &start=
    // 重载路径（B站官方内嵌、YouTube），通用内嵌 iframe 不消费 chapterSeekSec，
    // 跳转也拒绝。执行器自身也设防：biliStage 上报前的窗口期内总线同样会拒绝。
    const voiceExecutor = useMemo<VideoVoiceExecutor>(() => {
        const kind = voicePlatform.kind
        const isBili = videoRoute?.platform === 'bilibili'
        const noMedia: PlayerCommandResult = { ok: false, reason: 'no-media' }
        const noControl: PlayerCommandResult = { ok: false, reason: 'iframe-no-control' }
        const directVideo = (): HTMLVideoElement | null => {
            if (kind === 'iframe') return null
            if (isBili) return null // B站走播放器命令柄，不直接碰元素
            return mp4VideoRef.current
        }
        return {
            play: async () => {
                if (kind === 'iframe') return noControl
                if (isBili) return biliPlayerRef.current?.play() ?? noMedia
                const el = directVideo()
                if (!el) return noMedia
                try {
                    await el.play()
                    return { ok: true }
                } catch {
                    return { ok: false, reason: 'play-blocked' }
                }
            },
            pause: () => {
                if (kind === 'iframe') return noControl
                if (isBili) return biliPlayerRef.current?.pause() ?? noMedia
                const el = directVideo()
                if (!el) return noMedia
                el.pause()
                return { ok: true }
            },
            seekTo: (sec: number) => {
                const target = Math.max(0, sec)
                if (kind === 'controllable') {
                    if (isBili) return biliPlayerRef.current?.seekTo(target) ?? noMedia
                    const el = directVideo()
                    if (!el) return noMedia
                    try {
                        el.currentTime = target
                        return { ok: true }
                    } catch {
                        return noMedia
                    }
                }
                // iframe 路由：只有 B站官方内嵌与 YouTube 消费 chapterSeekSec
                //（B站 iframe 的 key 含 seekSec、YouTube 拼 &start=）；通用内嵌不消费，
                // 置位也无效果，故明确拒绝而不是静默丢弃。
                if (videoRoute?.platform === 'youtube' || isBili) {
                    setChapterSeekSec(target)
                    return { ok: true, reloadsPlayer: true }
                }
                return noControl
            },
            setRate: (rate: number) => {
                if (kind === 'iframe') return noControl
                if (isBili) return biliPlayerRef.current?.setRate(rate) ?? noMedia
                const el = directVideo()
                if (!el) return noMedia
                el.playbackRate = Math.min(2, Math.max(0.5, rate))
                return { ok: true }
            },
            setVolume: (volume01: number) => {
                if (kind === 'iframe') return noControl
                if (isBili) return biliPlayerRef.current?.setVolume(volume01) ?? noMedia
                const el = directVideo()
                if (!el) return noMedia
                el.volume = Math.min(1, Math.max(0, volume01))
                return { ok: true }
            },
            getVolume: () => {
                if (isBili) return biliPlayerRef.current?.getVolume() ?? 1
                return mp4VideoRef.current?.volume ?? 1
            },
            adjustVolume: (delta01: number) => {
                if (kind === 'iframe') return noControl
                const next = Math.min(1, Math.max(0, (isBili
                    ? biliPlayerRef.current?.getVolume() ?? 1
                    : mp4VideoRef.current?.volume ?? 1) + delta01))
                if (isBili) return biliPlayerRef.current?.setVolume(next) ?? noMedia
                const el = directVideo()
                if (!el) return noMedia
                el.volume = next
                return { ok: true }
            },
            setMuted: (muted: boolean) => {
                if (kind === 'iframe') return noControl
                if (isBili) return biliPlayerRef.current?.setMuted(muted) ?? noMedia
                const el = directVideo()
                if (!el) return noMedia
                el.muted = muted
                return { ok: true }
            },
            openTab: (tab) => setActiveTab(tab),
            searchTranscript: (query: string) => {
                setActiveTab('transcript')
                setTranscriptSearchQuery(query)
            },
            nextVideo: () => handleNextVideo(),
            prevVideo: () => handlePrevVideo(),
            requestPip: async () => {
                if (!selectedVideo) return false
                // 先开画中画，成功了再把视频挂到全局播放器；失败时不留任何
                // 全局副作用，回执「打开失败」与实际状态一致。注意：
                // requestDocumentPiP 自身在失败/不支持时还会兜底打开悬浮
                // 迷你播放器（与迷你播放器自己的画中画按钮同一行为），那是
                // 上下文的有意兜底，不归这里管。
                const opened = await requestDocumentPiP()
                if (!opened) return false
                openGlobalVideo(selectedVideo)
                return true
            },
        }
    }, [voicePlatform.kind, videoRoute?.platform, selectedVideo, openGlobalVideo, requestDocumentPiP, handleNextVideo, handlePrevVideo])

    // 语音自然语言指令调度器：抽到 lib/video-voice-dispatch.ts 的纯函数，
    // 这里只组装执行器与上下文（真实进度、真实章节、数据门禁、平台种类）。
    // 返回三态回执给指示器渲染，不再统一 toast「识别指令：X」。
    const handleVoiceCommand = useCallback(async (cmd: VoiceCommandIntent): Promise<VoiceCommandResult> => {
        const result = await dispatchVoiceCommand(cmd, voiceExecutor, {
            currentTimeSec,
            hasRealChapters,
            // 章节跳转查真实章节（videoConfig.chapters）；页面 chapters 状态是
            // AI 摘要启发式章节，不能拿它当课程目录。
            chapters: selectedVideo?.videoConfig?.chapters ?? [],
            // 脑图 tab 的实际门禁是 mindmapRoot.children.length > 0（设计文档说的
            // hasMindmap 并不存在；无真实章节时 mindmapRoot 本就是空的）。
            mindmapAvailable: mindmapRoot.children.length > 0,
            transcriptAvailable: transcriptList.length > 0,
            isDocumentPipSupported: isDocumentPipSupported(),
            platformKind: voicePlatform.kind,
            platformLabel: voicePlatform.label,
        })
        // 播放状态同步：此前 useVideoPlayerState 的 isPlaying 是死状态（初始
        // true、无任何写入方）；只在语音播放/暂停真实执行成功时写。
        if (result.status === 'executed' && (cmd.action === 'play' || cmd.action === 'pause')) {
            setIsPlaying(cmd.action === 'play')
        }
        return result
    }, [voiceExecutor, currentTimeSec, hasRealChapters, selectedVideo, mindmapRoot, transcriptList, voicePlatform, setIsPlaying])

    // 默认选片：分享海报 / 章节直达链路带 ?id=&t= 时优先按 id 选片、按 t 跳转；
    // 无参数或 id 对不上库里任何视频时，落回第一个视频（旧行为）。
    // 此前路由页从不读参数，海报生成的 /videos/player?id=…&t=… 点开永远播第一条。
    useEffect(() => {
        if (selectedVideo) return
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search)
            const requestedId = params.get('id')
            if (requestedId) {
                const target = allVideos.find(v => v.id === requestedId)
                if (target) {
                    const t = Number(params.get('t'))
                    pendingSeekSecRef.current = Number.isFinite(t) && t > 0 ? Math.floor(t) : null
                    handleSelectVideo(target)
                    for (const category of navigationData.navigationItems || []) {
                        if (category.items?.some(it => it.id === target.id)) {
                            setExpandedCategories(new Set([category.id]))
                            return
                        }
                        for (const sub of category.subCategories || []) {
                            if (sub.items?.some(it => it.id === target.id)) {
                                setExpandedCategories(new Set([category.id]))
                                setExpandedSubCategories(new Set([sub.id]))
                                return
                            }
                        }
                    }
                    return
                }
            }
        }
        for (const category of navigationData.navigationItems) {
            if (category.items && category.items.length > 0) {
                const firstVideoItem = category.items.find(item => item.videoConfig)
                if (firstVideoItem) {
                    handleSelectVideo(firstVideoItem)
                    setExpandedCategories(new Set([category.id]))
                    return
                }
            }
            if (category.subCategories) {
                for (const sub of category.subCategories) {
                    if (sub.items && sub.items.length > 0) {
                        const firstVideoItem = sub.items.find(item => item.videoConfig)
                        if (firstVideoItem) {
                            handleSelectVideo(firstVideoItem)
                            setExpandedCategories(new Set([category.id]))
                            setExpandedSubCategories(new Set([sub.id]))
                            return
                        }
                    }
                }
            }
        }
    }, [navigationData, selectedVideo, allVideos, handleSelectVideo])

    // 多源镜像切换与 AI 章节/摘要加载
    useEffect(() => {
        if (!selectedVideo || !selectedVideo.videoConfig) return

        setInWatchLater(isInWatchLater(selectedVideo.id))

        const mirrors = resolveAvailableMirrors(selectedVideo.videoConfig)
        setAvailableMirrors(mirrors)
        const best = selectBestMirror(mirrors)
        setActiveMirror(best)
        // ?t= 带进来的跳转秒数只在初次选片时生效一次；之后清零，换片/章节内跳转仍走 chapterSeekSec 自己的置位
        setChapterSeekSec(pendingSeekSecRef.current)
        pendingSeekSecRef.current = null

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

        // 字幕：用户导入 > 视频自带 > 描述里的 VTT；都没有就如实无字幕
        // （2026-11-10 审计）：旧实现写死 3 句通用文案冒充字幕，下游双语/
        // 卡拉OK/切片都在消费这份假字幕。全站仅 11/6007 个视频自带真字幕，
        // 其余宁可空着并由 UI 呈现「暂无字幕」，也不编造台词。用户可在字幕
        // 栏导入 SRT / WebVTT 补字幕，导入后即刻可搜、可跳转。
        const resolved = resolveVideoCaptions(selectedVideo, getCaptionEntry(selectedVideo.id))
        setTranscriptList(resolved.cues)
        setCaptionSource(resolved.source)
        setImportedCaptionCount(
            resolved.source === 'imported' ? resolved.cues.length : (getCaptionEntry(selectedVideo.id)?.cues.length ?? 0),
        )
    }, [selectedVideo])

    // F-01 补全：mp4 直链 <video> 没有 chapterSeekSec 消费方（B站走 seekSec、
    // YouTube 走 &start= 重载），断点续播与章节跳转在 mp4 上会点下无反应。
    // chapterSeekSec 置位时直接置 mp4VideoRef.currentTime；元数据未就绪时
    // 等一次 loadedmetadata 再跳。B站/YouTube 路由下 mp4VideoRef 为空，直接返回。
    useEffect(() => {
        if (chapterSeekSec === null || chapterSeekSec <= 0) return
        const el = mp4VideoRef.current
        if (!el) return
        if (el.readyState >= 1) {
            el.currentTime = chapterSeekSec
            return
        }
        const onLoadedMetadata = () => {
            el.currentTime = chapterSeekSec
        }
        el.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })
        return () => el.removeEventListener('loadedmetadata', onLoadedMetadata)
    }, [chapterSeekSec])

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

    /** 字幕导入成功：存入本地字幕库并立即让本视频可搜、可跳转。 */
    const handleImportCaptions = (cues: VideoTranscriptItem[], format: 'srt' | 'vtt') => {
        if (!selectedVideo) return
        const saved = saveCaptionEntry(selectedVideo, cues, format)
        if (!saved.ok) return
        setTranscriptList(saved.entry?.cues ?? cues)
        setCaptionSource('imported')
        setImportedCaptionCount(saved.entry?.cues.length ?? cues.length)
        setActiveTab('transcript')
    }

    /** 删除已导入字幕：回落到视频自带字幕（若有），否则恢复「无字幕」。 */
    const handleDeleteImportedCaptions = () => {
        if (!selectedVideo) return
        deleteCaptionEntry(selectedVideo.id)
        const resolved = resolveVideoCaptions(selectedVideo, null)
        setTranscriptList(resolved.cues)
        setCaptionSource(resolved.source)
        setImportedCaptionCount(0)
    }

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
        if (!selectedVideo?.videoConfig || !videoRoute) {
            return (
                <div className="w-full aspect-video bg-zinc-900 rounded-xl flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                        <PlayCircle className="w-16 h-16 mx-auto mb-4 opacity-30" />
                        <p>请从右侧列表选择视频播放</p>
                    </div>
                </div>
            )
        }

        const { platform, sourceId, embedUrl, isMp4Direct } = videoRoute

        if (platform === 'bilibili') {
            const isAid = /^\d+$/.test(sourceId)
            const resolvedBvid = !isAid ? (sourceId || selectedVideo.videoConfig.bvid) : undefined
            const resolvedAid = isAid ? sourceId : selectedVideo.videoConfig.aid

            return (
                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                    <VideoBilibiliHdPlayer
                        key={`${selectedVideo.id}-${activeMirror?.id || 'primary'}`}
                        ref={biliPlayerRef}
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
                        onStageChange={setBiliStage}
                        onTimeUpdateSec={(curSec, durationSec) => {
                            if (selectedVideo) handlePlaybackTimeUpdate(selectedVideo, curSec, durationSec)
                        }}
                        onPauseSec={() => flushPlaybackPosition()}
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

        if (embedUrl && isMp4Direct) {
            return (
                <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative">
                    <video
                        key={`${selectedVideo.id}-${activeMirror?.id || 'direct'}`}
                        ref={mp4VideoRef}
                        src={embedUrl}
                        poster={selectedVideo.icon}
                        controls
                        autoPlay
                        playsInline
                        className="w-full h-full object-contain"
                        onTimeUpdate={(e) => {
                            if (selectedVideo) handlePlaybackTimeUpdate(selectedVideo, e.currentTarget.currentTime, e.currentTarget.duration)
                        }}
                        onPause={() => flushPlaybackPosition()}
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
                            className={activeTab === 'history' ? 'bg-accent text-accent-foreground max-md:hidden' : 'max-md:hidden'}
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
                                    <Button
                                        size="sm"
                                        className="h-6 text-xs px-2"
                                        onClick={() => {
                                            // F-01：断点续播横幅的主动作——按既有章节跳转机制置
                                            // chapterSeekSec（B站走 seekSec、YouTube 走 &start=、
                                            // mp4 走下方 mp4VideoRef effect），再收起横幅。
                                            setChapterSeekSec(resumePrompt.timestamp)
                                            dismissResumePrompt()
                                        }}
                                    >
                                        从 {resumePrompt.formatted} 继续播放
                                    </Button>
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
                            showSandbox={showSandbox}
                            onToggleSandbox={() => setShowSandbox(prev => !prev)}
                            showTelestrator={showTelestrator}
                            onToggleTelestrator={() => setShowTelestrator(prev => !prev)}
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
                                // 无数据不给入口（2026-11-11 审计第二批）：双语类只在
                                // 有真实字幕稿时出现。AI 学习三件套（AI伴学 / 概念图谱 /
                                // 抽认卡）合为 aiLearning 一个入口：概念图谱的「仅真实
                                // 章节」gating 与抽认卡的卡片计数挪进中心弹窗内。
                                // 频谱 / 神经降噪 / P2P 网格 / 分轨 / P2P 蜂群五个
                                // 入口整体下线——背后没有真实数据管线，组件保留在仓内
                                // （见 scripts/check-dead-modules.mjs 基线登记）。
                                aiLearning: () => setShowAiLearningDialog(true),
                                offline: () => setShowOfflineDialog(true),
                                ...(transcriptList.length > 0 ? { bilingualSubtitles: () => setShowBilingualSubtitlesDialog(true) } : {}),
                                workspaceExport: () => setShowWorkspaceExportDialog(true),
                                clipMaker: () => setShowClipMakerDialog(true),
                                pomodoro: () => setShowPomodoroDialog(true),
                                harvest: () => setShowAutoHarvestDialog(true),
                                webhook: () => setShowWebhookDialog(true),
                                ...(transcriptList.length > 0 ? { bilingualTts: () => setShowBilingualTtsDialog(true) } : {}),
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
                                                发布时间: {new Date(selectedVideo.videoConfig.publishedAt).toLocaleDateString(undefined, { timeZone: 'Asia/Shanghai' })}
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
                                                    onClick={() => handleSelectVideo(rel)}
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
                            onSelectVideo={handleSelectVideo}
                            expandedCategories={expandedCategories}
                            onToggleCategory={toggleCategory}
                            expandedSubCategories={expandedSubCategories}
                            onToggleSubCategory={toggleSubCategory}
                        />
                    }
                    allVideos={allVideos}
                    selectedVideo={selectedVideo}
                    setSelectedVideo={handleSelectVideo}
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
                    danmakuList={danmakuList}
                    transcriptList={transcriptList}
                    filteredTranscript={filteredTranscript}
                    transcriptSearchQuery={transcriptSearchQuery}
                    setTranscriptSearchQuery={setTranscriptSearchQuery}
                    handleExportTranscript={handleExportTranscript}
                    captionSource={captionSource}
                    importedCaptionCount={importedCaptionCount}
                    onOpenCaptionImport={() => setShowCaptionImport(true)}
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
                            onSelectVideo={handleSelectVideo}
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
                        <div className="pt-2">
                            <div className="text-[11px] font-semibold text-foreground pb-1">语音指令（点麦克风后说）</div>
                            {['暂停', '快进 30 秒', '两倍速', '下一集', '静音'].map(cmd => (
                                <div key={cmd} className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
                                    <span className="text-muted-foreground">「{cmd}」</span>
                                    <kbd className="px-2 py-0.5 rounded bg-muted font-mono text-[11px]">{cmd}</kbd>
                                </div>
                            ))}
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

            {/* AI 学习中心：AI伴学 / 概念图谱 / 抽认卡三件套合为一个入口 */}
            <VideoAiLearningDialog
                open={showAiLearningDialog}
                onOpenChange={setShowAiLearningDialog}
                transcripts={transcriptList}
                onSeek={(sec) => setChapterSeekSec(sec)}
                navigationData={navigationData}
                onJumpToTarget={({ bvid, seekSec }) => {
                    const found = allVideos.find(v => v.videoConfig?.bvid === bvid || v.id === bvid)
                    if (found) handleSelectVideo(found)
                    setChapterSeekSec(seekSec)
                }}
                cards={flashcards}
                videoTitle={selectedVideo?.title || '技术知识点'}
                conceptAvailable={hasRealChapters}
            />

            {/* 离线缓存管理弹窗 */}
            <VideoOfflineManager
                open={showOfflineDialog}
                onOpenChange={setShowOfflineDialog}
                currentVideoId={selectedVideo?.id}
                currentVideoTitle={selectedVideo?.title}
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

            {/* 视频采集中心：手动采集与 AI 自主巡航合为一个入口（弹窗内两个 tab） */}
            <VideoAutoHarvestDialog
                open={showAutoHarvestDialog}
                onOpenChange={setShowAutoHarvestDialog}
            />

            {/* 多源数据采集与 Webhook 自动化分发控制台 */}
            <VideoMultisourceWebhookDialog
                open={showWebhookDialog}
                onOpenChange={setShowWebhookDialog}
            />

            {/* TTS 朗读弹窗（只朗读原文，不翻译） */}
            <VideoBilingualTtsDialog
                open={showBilingualTtsDialog}
                onOpenChange={setShowBilingualTtsDialog}
                transcripts={selectedVideo?.videoConfig?.transcript}
            />

            {/* 字幕导入：粘贴 / 上传 SRT / WebVTT，导入后本视频的字幕可搜、可跳转 */}
            {selectedVideo && (
                <VideoCaptionImportDialog
                    open={showCaptionImport}
                    onOpenChange={setShowCaptionImport}
                    videoTitle={selectedVideo.title}
                    importedCueCount={importedCaptionCount}
                    onImport={handleImportCaptions}
                    onDeleteImported={handleDeleteImportedCaptions}
                />
            )}
        </div>
    )
}
