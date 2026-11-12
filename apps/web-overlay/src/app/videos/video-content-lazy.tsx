'use client'

import dynamic from 'next/dynamic'
import type { NavigationData } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'

/**
 * /videos 首屏预算超 37 KB：VideoContent（1502 行，含 Sidebar / SearchBar /
 * VideoCard、视频搜索索引与推荐库）是本页唯一的重型客户端岛。
 *
 * 注意分工：`next/dynamic` 写在 Server Component 里不会切 chunk（Next 16 的
 * 已知限制：Server Component 动态导入 Client Component 不做自动代码切分，
 * 且 `ssr: false` 在 Server Component 里直接是构建错误），所以动态边界必须
 * 落在这个 'use client' 包装里；不设 `ssr: false`——本页可索引，服务端仍
 * 渲染出真实内容，只是 hydration 用的 JS 走异步 chunk（与
 * check-bundle-budget 的异步 chunk 扣除口径一致）。
 */
const VideoContent = dynamic(
  () => import('@/components/video-content').then((m) => m.VideoContent),
  {
    loading: () => (
      <div className="mx-auto w-full max-w-7xl px-4 py-8" aria-busy="true" aria-label="正在加载视频内容">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      </div>
    ),
  },
)

export function VideoContentLazy({
  navigationData,
  siteData,
}: {
  navigationData: NavigationData
  siteData: SiteConfig
}) {
  return <VideoContent navigationData={navigationData} siteData={siteData} />
}
