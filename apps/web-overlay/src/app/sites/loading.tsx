import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 形状与真实页面同构（见 components/route-skeleton.tsx）——
 * 站点目录是站点卡片墙，取 grid 形态。
 * 覆盖 /sites 与分页 /sites/p/[n] 的加载占位。
 */
export default function Loading() {
  return <RouteSkeleton variant="grid" count={12} />;
}
