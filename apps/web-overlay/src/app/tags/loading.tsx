import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 形状与真实页面同构（见 components/route-skeleton.tsx）——
 * 标签云/标签卡片密度高，取 grid 形态、稍多张数。
 */
export default function Loading() {
  return <RouteSkeleton variant="grid" count={12} />;
}
