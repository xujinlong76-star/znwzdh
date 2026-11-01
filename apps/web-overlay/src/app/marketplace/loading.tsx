import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 形状与真实页面同构（见 components/route-skeleton.tsx）——
 * 插件市场是插件卡片墙，取 grid 形态、稍多张数。
 * 覆盖 /marketplace 及其子段（[slug]、author、mine 等）的加载占位。
 */
export default function Loading() {
  return <RouteSkeleton variant="grid" count={12} />;
}
