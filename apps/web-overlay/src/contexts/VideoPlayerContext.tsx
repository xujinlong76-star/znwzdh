'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { NavigationSubItem, VideoChapter, VideoMirrorSource } from '@/types/navigation'
import { resolveAvailableMirrors, selectBestMirror, recordMirrorFailover } from '@/lib/video-failover'
import { savePlaybackPosition, getResumePosition } from '@/lib/video-playback-storage'
import { getVideoAISummary } from '@/lib/video-ai-summary'

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
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)

  const pipWindowRef = useRef<any>(null)

  // Open video
  const openVideo = useCallback((item: NavigationSubItem, startSec?: number) => {
    setActiveVideo(item)
    setIsPlaying(true)

    // Resolve mirrors
    if (item.videoConfig) {
      const mirrors = resolveAvailableMirrors(item.videoConfig)
      setAvailableMirrors(mirrors)
      const best = selectBestMirror(mirrors)
      setActiveMirror(best)

      // Initial playhead: parameter > saved position > 0
      const initialPos = typeof startSec === 'number'
        ? startSec
        : getResumePosition(item.id) || 0
      setPlayheadSecState(initialPos)

      // Load or extract chapters
      if (item.videoConfig.chapters && item.videoConfig.chapters.length > 0) {
        setChapters(item.videoConfig.chapters)
      } else {
        // Fetch or heuristic extract
        getVideoAISummary({
          videoId: item.id,
          title: item.title,
          description: item.description,
          durationSec: item.videoConfig.durationSec || 600,
        }).then(res => {
          if (res?.chapters && res.chapters.length > 0) {
            setChapters(res.chapters)
          }
        }).catch(() => {
          // ignore
        })
      }
    }
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
    setActiveChapterId(null)
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
  const setPlayheadSec = useCallback((sec: number) => {
    setPlayheadSecState(sec)
    if (activeVideo && activeVideo.videoConfig) {
      savePlaybackPosition({
        videoId: activeVideo.id,
        title: activeVideo.title,
        author: activeVideo.videoConfig.author,
        cover: activeVideo.icon,
        platform: activeVideo.videoConfig.type,
        timestampSec: sec,
        durationSec: activeVideo.videoConfig.durationSec || 600,
      })
    }
  }, [activeVideo])

  // Track active chapter based on playhead
  useEffect(() => {
    if (!chapters || chapters.length === 0) return
    const current = chapters.find(ch => {
      const end = ch.endTime || Infinity
      return playheadSec >= ch.startTime && playheadSec < end
    })
    if (current && current.id !== activeChapterId) {
      setActiveChapterId(current.id)
    }
  }, [playheadSec, chapters, activeChapterId])

  // Switch mirror manually or failover
  const switchMirror = useCallback((sourceId: string) => {
    const target = availableMirrors.find(m => m.id === sourceId)
    if (target && activeVideo) {
      if (activeMirror) {
        recordMirrorFailover(
          activeVideo.id,
          activeMirror.id,
          target.id,
          'User manual switch or auto failover'
        )
      }
      setActiveMirror(target)
    }
  }, [availableMirrors, activeVideo, activeMirror])

  // Seek to specific chapter
  const seekToChapter = useCallback((chapter: VideoChapter) => {
    setPlayheadSec(chapter.startTime)
    setActiveChapterId(chapter.id)
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
