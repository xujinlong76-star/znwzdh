'use client'

/**
 * 迷你播放器的挂载闸门。
 *
 * 为什么要这一层：根布局此前静态 import VideoMiniPlayer，而 VideoMiniPlayer 自己在
 * 「没有活跃播放」时 return null —— 于是每一条路由的首屏都背着迷你播放器
 * （连带它静态引入的 B站高清播放器）的代码，却一个像素都不渲染。把「到底有没有播放」
 * 提前到挂载条件里，闸门关闭时这个模块根本不进浏览器图，用户真的开始播放后
 * 异步 chunk 才去取。
 *
 * 判据与 VideoMiniPlayer 内部的早退条件逐字一致，不留两套口径。
 */

import dynamic from 'next/dynamic'
import { useVideoPlayer } from '@/contexts/VideoPlayerContext'

const VideoMiniPlayer = dynamic(
  () => import('@/components/video-mini-player').then((mod) => mod.VideoMiniPlayer),
  { ssr: false },
)

export function VideoMiniPlayerSlot() {
  const { isMiniPlayerOpen, activeVideo } = useVideoPlayer()

  if (!isMiniPlayerOpen || !activeVideo || !activeVideo.videoConfig) {
    return null
  }

  return <VideoMiniPlayer />
}
