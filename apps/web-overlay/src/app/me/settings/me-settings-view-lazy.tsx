'use client'

import dynamic from 'next/dynamic'

/**
 * /me/settings 首屏预算超 5 KB：MeSettingsView 连同 SettingsPanel（641 行）
 * 与 use-me-settings 是本页唯一的重型客户端岛。
 *
 * 动态边界必须落在这个 'use client' 包装里（`next/dynamic` 写在 Server
 * Component 里不会切 chunk，且 `ssr: false` 在 Server Component 里是构建
 * 错误）；不设 `ssr: false`，服务端仍渲染出设置页首帧，hydration 用的 JS
 * 走异步 chunk。
 */
const MeSettingsView = dynamic(
  () => import('@/components/user-center/me-settings-view').then((m) => m.MeSettingsView),
  {
    loading: () => (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8" aria-busy="true" aria-label="正在加载设置">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-48 animate-pulse rounded-2xl bg-muted/60" />
        <div className="h-48 animate-pulse rounded-2xl bg-muted/60" />
      </div>
    ),
  },
)

export function MeSettingsViewLazy() {
  return <MeSettingsView />
}
