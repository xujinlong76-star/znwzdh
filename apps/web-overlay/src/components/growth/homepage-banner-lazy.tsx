'use client'

import dynamic from 'next/dynamic'

/**
 * 首页横幅的动态边界（第 75 轮 growth 常量切割第二小刀）。
 *
 * 横幅在 /sites 等非首页路由恒为 null，却因根 layout 静态 import 进了
 * 全站每路由首屏；改动态导入后横幅本体 + lucide 图标走异步 chunk。
 *
 * 动态边界必须落在这个 'use client' 包装里：`next/dynamic` 写在 Server
 * Component（根 layout）里不会切 chunk，且 `ssr: false` 在 Server
 * Component 里是构建错误（见 me-settings-view-lazy.tsx 同款注释）。
 * 不设 `ssr: false`：服务端仍渲染首帧（横幅初始渲染本就是 null，只在
 * effect 后才出现），水合用的 JS 走异步 chunk。首页横幅晚一个 chunk
 * 出现，与 growth-lazy-guard 的“晚一个 chunk”先例同款。
 */
const HomepageBannerDynamic = dynamic(
  () => import('./homepage-banner').then((m) => m.HomepageBanner),
)

export function HomepageBanner() {
  return <HomepageBannerDynamic />
}
