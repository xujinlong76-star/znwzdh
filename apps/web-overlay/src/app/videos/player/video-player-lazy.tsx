'use client'

import dynamic from 'next/dynamic'
import type { NavigationData } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'

/**
 * /videos/player 首屏预算超 28 KB：VideoPlayerPage（1692 行，静态拉入播放器
 * 侧栏 / 控制条 / 播放列表树，以及字幕、弹幕、测验、思维导图、QoE 等十余个
 * lib 模块）是本页唯一的重型客户端岛。
 *
 * 动态边界必须落在这个 'use client' 包装里（`next/dynamic` 写在 Server
 * Component 里不会切 chunk，且 `ssr: false` 在 Server Component 里是构建
 * 错误）；不设 `ssr: false`，服务端仍渲染出播放器首帧 HTML，hydration 用
 * 的 JS 走异步 chunk。
 */
const VideoPlayerPage = dynamic(
  () => import('@/components/video-player-page').then((m) => m.VideoPlayerPage),
  {
    loading: () => (
      <div className="mx-auto w-full max-w-5xl px-4 py-8" aria-busy="true" aria-label="正在加载播放器">
        <div className="aspect-video w-full animate-pulse rounded-xl bg-muted/60" />
        <div className="mt-4 h-6 w-72 animate-pulse rounded-lg bg-muted" />
      </div>
    ),
  },
)

export function VideoPlayerPageLazy({
  navigationData,
  siteData,
}: {
  navigationData: NavigationData
  siteData: SiteConfig
}) {
  return <VideoPlayerPage navigationData={navigationData} siteData={siteData} />
}
