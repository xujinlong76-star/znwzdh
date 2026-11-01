import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 形状与真实页面同构（见 components/route-skeleton.tsx）——
 * 搜索结果是站点卡片墙，取 grid 形态。
 * /search 是 force-dynamic，服务端渲染期正是白屏窗口，骨架收益最大。
 */
export default function Loading() {
  return <RouteSkeleton variant="grid" count={8} />;
}
