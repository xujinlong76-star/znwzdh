'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { chapterStartSec, type NavigationSubItem, type VideoChapter, type VideoMirrorSource } from '@/types/navigation'
import { toast } from 'sonner'

/**
 * 视频播放器重库（Bundle 瘦身第三刀 b）：failover、playback-storage、
 * ai-summary 3 个 lib（registry 经 failover 间接进入）合计约 19KB 代码，
 * 只在开播/切镜像/写播放头时才需要，平时不进 `/` 初始 chunk。
 * context 壳仍静态挂载于 providers，4 lib 改 `await import()` 按需加载；
 * import 结果由浏览器模块缓存 + 下面的单例 promise 保证只加载一次。
 * registry 不在 context 里单独改：它随 failover 一起走 `await import()`。
 */
type FailoverModule = typeof import('@/lib/video-failover')
type PlaybackStorageModule = typeof import('@/lib/video-playback-storage')
type AiSummaryModule = typeof import('@/lib/video-ai-summary')

let failoverPromise: Promise<FailoverModule> | null = null
let playbackStoragePromise: Promise<PlaybackStorageModule> | null = null
let aiSummaryPromise: Promise<AiSummaryModule> | null = null

const loadVideoFailover = () => (failoverPromise ??= import('@/lib/video-failover'))
const loadPlaybackStorage = () =>
  (playbackStoragePromise ??= import('@/lib/video-playback-storage'))
const loadVideoAiSummary = () => (aiSummaryPromise ??= import('@/lib/video-ai-summary'))

interface VideoPlayerContextType {
  activeVideo: NavigationSubItem | null
  isPlaying: boolean
  isMiniPlayerOpen: boolean
  isPipActive: boolean
  playheadSec: number
  activeMirror: VideoMirrorSource | null
  availableMirrors: VideoMirrorSource[]
  chapters: VideoChapter[]
  activeChapterId: string | null
  openVideo: (item: NavigationSubItem, startSec?: number) => void
  closePlayer: () => void
  minimizeToFloat: () => void
  restorePlayer: () => void
  togglePlayPause: () => void
  setPlayheadSec: (sec: number) => void
  switchMirror: (sourceId: string) => void
  seekToChapter: (chapter: VideoChapter) => void
  requestDocumentPiP: () => Promise<boolean>
}

const VideoPlayerContext = createContext<VideoPlayerContextType | null>(null)

export function VideoPlayerProvider({ children }: { children: React.ReactNode }) {
  const [activeVideo, setActiveVideo] = useState<NavigationSubItem | null>(null)
  const [isPlaying, setIsPlaying] = useState<boolean>(true)
  const [isMiniPlayerOpen, setIsMiniPlayerOpen] = useState<boolean>(false)
  const [isPipActive, setIsPipActive] = useState<boolean>(false)
  const [playheadSec, setPlayheadSecState] = useState<number>(0)
  const [activeMirror, setActiveMirror] = useState<VideoMirrorSource | null>(null)
  const [availableMirrors, setAvailableMirrors] = useState<VideoMirrorSource[]>([])
  const [chapters, setChapters] = useState<VideoChapter[]>([])

  /**
   * 当前章节由**播放头推导**，不另存 state。
   *
   * 原先是「state + effect 同步」：effect 里按 playheadSec 找到当前章节再
   * setActiveChapterId。react-hooks/set-state-in-effect 规则把这判为 error
   * （在 effect 里直接 setState）。而它唯一另一个写入点 seekToChapter 本来
   * 就同时把播放头移到该章节起点——两者始终一致，所以直接推导即可，
   * 行为不变，还少一次渲染。
   */
  const activeChapterId = useMemo(() => {
    const current = chapters.find((ch) => {
      const end = ch.endTime || Infinity
      return playheadSec >= chapterStartSec(ch) && playheadSec < end
    })
    return current?.id ?? null
  }, [playheadSec, chapters])

  const pipWindowRef = useRef<any>(null)

  // Open video
  // 异步分段：先同步 setActiveVideo（播放器 UI 立即出现），再 await import()
  // 补镜像/断点/摘要（首次开播多一次约 10–13KB 的 chunk 拉取，本机 <100ms，
  // 慢速网 300–600ms；迷你播放器先用平台/bvid 兜底渲染，镜像就绪后切到
  // 最优镜像）。对外签名仍是同步 void，唯一调用方（点击处理函数）零适配。
  const openVideo = useCallback((item: NavigationSubItem, startSec?: number) => {
    setActiveVideo(item)
    setIsPlaying(true)

    const config = item.videoConfig
    if (!config) return

    // 已配好的章节直接同步进 state，不等重库加载。
    if (config.chapters && config.chapters.length > 0) {
      setChapters(config.chapters)
    }

    void (async () => {
      try {
        const [failover, storage] = await Promise.all([
          loadVideoFailover(),
          loadPlaybackStorage(),
        ])
        // Resolve mirrors
        const mirrors = failover.resolveAvailableMirrors(config)
        setAvailableMirrors(mirrors)
        setActiveMirror(failover.selectBestMirror(mirrors))

        // Initial playhead: parameter > saved position > 0
        const initialPos =
          typeof startSec === 'number' ? startSec : storage.getResumePosition(item.id) || 0
        setPlayheadSecState(initialPos)

        // Fetch or heuristic extract（无现成章节时才走 AI 摘要，fire-and-forget，
        // 摘要失败静默——它只是章节提取，不影响播放；不进外层 catch，不弹 toast）
        if (!config.chapters || config.chapters.length === 0) {
          void loadVideoAiSummary()
            .then((summary) =>
              summary.getVideoAISummary({
                videoId: item.id,
                title: item.title,
                description: item.description,
                durationSec: config.durationSec || 600,
              }),
            )
            .then((res) => {
              if (res?.chapters && res.chapters.length > 0) {
                setChapters(res.chapters)
              }
            })
            .catch(() => {
              // ignore
            })
        }
      } catch {
        // 镜像/断点解析失败：播放器已出现（兜底平台/bvid 渲染），toast 告知重试。
        toast.error('视频资源加载失败，请重试')
      }
    })()
  }, [])

  // Close player completely
  const closePlayer = useCallback(() => {
    if (pipWindowRef.current) {
      pipWindowRef.current.close()
      pipWindowRef.current = null
    }
    setActiveVideo(null)
    setIsPlaying(false)
    setIsMiniPlayerOpen(false)
    setIsPipActive(false)
    setChapters([])
  }, [])

  // Minimize to floating overlay
  const minimizeToFloat = useCallback(() => {
    setIsMiniPlayerOpen(true)
  }, [])

  // Restore from float
  const restorePlayer = useCallback(() => {
    setIsMiniPlayerOpen(false)
  }, [])

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev)
  }, [])

  // Update playhead
  // 断点保存按需加载（fire-and-forget：import 结果由模块缓存保证只加载一次；
  // 保存失败静默——它只是断点记录，不影响播放）。
  const setPlayheadSec = useCallback((sec: number) => {
    setPlayheadSecState(sec)
    if (activeVideo && activeVideo.videoConfig) {
      const payload = {
        videoId: activeVideo.id,
        title: activeVideo.title,
        author: activeVideo.videoConfig.author,
        cover: activeVideo.icon,
        // 播放历史只为 bilibili/youtube/other 建模；VideoConfig.type 现含 12 个平台，
        // 其余平台（含 custom）没有对应的历史条目类型，统一落到 'other'
        // （payload 先抽成 const 再传参，须显式收窄为联合类型，否则会被拓宽成 string）
        platform: (
          activeVideo.videoConfig.type === 'bilibili' || activeVideo.videoConfig.type === 'youtube'
            ? activeVideo.videoConfig.type
            : 'other'
        ) as 'bilibili' | 'youtube' | 'other',
        timestampSec: sec,
        durationSec: activeVideo.videoConfig.durationSec || 600,
      }
      void loadPlaybackStorage()
        .then((storage) => storage.savePlaybackPosition(payload))
        .catch(() => {
          // ignore: 断点保存失败不影响播放
        })
    }
  }, [activeVideo])

  // 当前章节由播放头推导（见 activeChapterId 的 useMemo），无需在这里同步

  // Switch mirror manually or failover
  // 切换记录按需加载（fire-and-forget，不等记录完成就切镜像；记录失败静默）。
  const switchMirror = useCallback((sourceId: string) => {
    const target = availableMirrors.find(m => m.id === sourceId)
    if (target && activeVideo) {
      if (activeMirror) {
        void loadVideoFailover()
          .then((failover) =>
            failover.recordMirrorFailover(
              activeVideo.id,
              activeMirror.id,
              target.id,
              'User manual switch or auto failover'
            )
          )
          .catch(() => {
            // ignore: 切换记录失败不影响切换
          })
      }
      setActiveMirror(target)
    }
  }, [availableMirrors, activeVideo, activeMirror])

  // Seek to specific chapter
  const seekToChapter = useCallback((chapter: VideoChapter) => {
    // 播放头一动，当前章节由推导自动跟上，无需再单独写 state
    setPlayheadSec(chapterStartSec(chapter))
  }, [setPlayheadSec])

  // Native Document PiP
  const requestDocumentPiP = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false

    // Check Chrome / Edge Document Picture-in-Picture API
    if ('documentPictureInPicture' in window && (window as any).documentPictureInPicture) {
      try {
        const pip = await (window as any).documentPictureInPicture.requestWindow({
          width: 520,
          height: 340,
        })
        pipWindowRef.current = pip
        setIsPipActive(true)

        // Copy styles to PiP window
        Array.from(document.styleSheets).forEach(styleSheet => {
          try {
            const cssRules = Array.from(styleSheet.cssRules).map(rule => rule.cssText).join('')
            const style = pip.document.createElement('style')
            style.textContent = cssRules
            pip.document.head.appendChild(style)
          } catch {
            if (styleSheet.href) {
              const link = pip.document.createElement('link')
              link.rel = 'stylesheet'
              link.href = styleSheet.href
              pip.document.head.appendChild(link)
            }
          }
        })

        pip.addEventListener('pagehide', () => {
          setIsPipActive(false)
          pipWindowRef.current = null
        })

        return true
      } catch {
        // Fallback to floating DOM mini player
        setIsMiniPlayerOpen(true)
        return false
      }
    } else {
      // Fallback to floating mini player
      setIsMiniPlayerOpen(true)
      return false
    }
  }, [])

  return (
    <VideoPlayerContext.Provider
      value={{
        activeVideo,
        isPlaying,
        isMiniPlayerOpen,
        isPipActive,
        playheadSec,
        activeMirror,
        availableMirrors,
        chapters,
        activeChapterId,
        openVideo,
        closePlayer,
        minimizeToFloat,
        restorePlayer,
        togglePlayPause,
        setPlayheadSec,
        switchMirror,
        seekToChapter,
        requestDocumentPiP,
      }}
    >
      {children}
    </VideoPlayerContext.Provider>
  )
}

export function useVideoPlayer(): VideoPlayerContextType {
  const context = useContext(VideoPlayerContext)
  if (!context) {
    throw new Error('useVideoPlayer must be used within a VideoPlayerProvider')
  }
  return context
}
