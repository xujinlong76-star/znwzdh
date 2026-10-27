'use client'

import { useEffect, useState, useCallback } from 'react'
import type { NavigationSubItem } from '@/types/navigation'
import {
  savePlaybackPosition,
  getResumePosition,
  getPlaybackHistory,
  type PlaybackHistoryItem
} from '@/lib/video-playback-storage'

interface UseVideoPlayerStateOptions {
  video: NavigationSubItem | null
  categoryTitle?: string
  onNextVideo?: () => void
  onPrevVideo?: () => void
}

export function useVideoPlayerState({
  video,
  categoryTitle = '视频教程',
  onNextVideo,
  onPrevVideo
}: UseVideoPlayerStateOptions) {
  const [isPlaying, setIsPlaying] = useState(true)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [resumePrompt, setResumePrompt] = useState<{ timestamp: number; formatted: string } | null>(null)
  const [historyList, setHistoryList] = useState<PlaybackHistoryItem[]>([])
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)

  // 刷新历史
  const refreshHistory = useCallback(() => {
    setHistoryList(getPlaybackHistory())
  }, [])

  // 1. 初始化检查断点续播
  useEffect(() => {
    if (!video) {
      setResumePrompt(null)
      return
    }

    refreshHistory()
    const resumeSec = getResumePosition(video.id)
    if (resumeSec > 10) {
      const minutes = Math.floor(resumeSec / 60)
      const seconds = resumeSec % 60
      setResumePrompt({
        timestamp: resumeSec,
        formatted: `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
      })
    } else {
      setResumePrompt(null)
    }

    // 默认上报一次访问
    savePlaybackPosition({
      videoId: video.id,
      title: video.title,
      author: video.videoConfig?.author,
      cover: video.icon,
      platform: (video.videoConfig?.type as 'bilibili' | 'youtube') || 'other',
      timestampSec: resumeSec > 0 ? resumeSec : 0,
      durationSec: video.videoConfig?.durationSec || 600
    })
  }, [video, refreshHistory])

  // 2. 注册系统级 MediaSession 协议
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !video) return

    const config = video.videoConfig
    const author = config?.author || 'NavHub 开发者'
    const artwork = video.icon
      ? [{ src: video.icon, sizes: '512x512', type: 'image/jpeg' }]
      : []

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: video.title,
        artist: author,
        album: categoryTitle,
        artwork
      })

      if (onNextVideo) {
        navigator.mediaSession.setActionHandler('nexttrack', onNextVideo)
      }
      if (onPrevVideo) {
        navigator.mediaSession.setActionHandler('previoustrack', onPrevVideo)
      }
    } catch {
      // 某些浏览器实现可能不支持特定动作
    }

    return () => {
      try {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.setActionHandler('nexttrack', null)
          navigator.mediaSession.setActionHandler('previoustrack', null)
        }
      } catch {
        // 清理 mediaSession 动作处理器：浏览器不支持或已卸载时无影响
      }
    }
  }, [video, categoryTitle, onNextVideo, onPrevVideo])

  // 3. 全局播放器快捷键调度
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框中打字时误触快捷键
      const target = e.target as HTMLElement
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      switch (e.key) {
        case '?':
          e.preventDefault()
          setShowShortcutHelp(prev => !prev)
          break
        case 'f':
        case 'F': {
          e.preventDefault()
          if (!document.fullscreenElement) {
            // 全屏可能被浏览器策略拒绝（非用户手势/iframe），失败即保持原状态
            document.documentElement.requestFullscreen?.().catch(() => { /* 见上 */ })
          } else {
            document.exitFullscreen?.().catch(() => { /* 退出全屏失败说明本就不在全屏，忽略 */ })
          }
          break
        }
        case ']':
          if (onNextVideo) {
            e.preventDefault()
            onNextVideo()
          }
          break
        case '[':
          if (onPrevVideo) {
            e.preventDefault()
            onPrevVideo()
          }
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNextVideo, onPrevVideo])

  return {
    isPlaying,
    setIsPlaying,
    currentTimeSec,
    setCurrentTimeSec,
    resumePrompt,
    dismissResumePrompt: () => setResumePrompt(null),
    historyList,
    refreshHistory,
    showShortcutHelp,
    setShowShortcutHelp
  }
}
