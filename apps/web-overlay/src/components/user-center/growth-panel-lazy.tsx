'use client'

import dynamic from 'next/dynamic'

/**
 * /me 首屏预算超 11 KB（CI b0c6f0e1 实测 891 KB > 预算 880 KB）：
 * GrowthPanel 连同成长子面板（growth-season-panel / growth-tasks /
 * homepage-guide / growth-heatmap）与 growth-season 是本页唯一的
 * /me 专属重型客户端岛，源码约 43 KB；lib/growth 反而不在此列——
 * 它已被根布局的 growth-tracker / homepage-banner 静态拉进共享 chunk，
 * 拆 GrowthPanel 省不到它。
 *
 * 动态边界必须落在这个 'use client' 包装里（`next/dynamic` 写在 Server
 * Component 里不会切 chunk）；不关闭服务端渲染，服务端仍渲染出成长面板
 * 首帧，hydration 用的 JS 走异步 chunk（预算口径按 react-loadable-manifest
 * 扣除）。成长面板的挂载副作用（赛季到访打点、新手链、growth_card_view）
 * 只是随异步 chunk 晚一点触发，行为不变。
 */
const GrowthPanel = dynamic(
  () => import('./growth-panel').then((mod) => mod.GrowthPanel),
  {
    loading: () => (
      <section
        className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5"
        aria-label="我的成长"
        aria-busy="true"
      >
        <div className="h-5 w-24 animate-pulse rounded-lg bg-muted" />
        <div className="mt-3 h-24 animate-pulse rounded-xl bg-muted/60" />
      </section>
    ),
  },
)

export function GrowthPanelLazy() {
  return <GrowthPanel />
}
