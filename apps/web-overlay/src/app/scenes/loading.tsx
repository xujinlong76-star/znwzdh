import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 场景索引是卡片墙、详情是步骤分组，形状都接近 grid 形态；
 * 本文件同时覆盖 /scenes 与 /scenes/[id]（子路由继承父级骨架）。
 */
export default function Loading() {
  return <RouteSkeleton variant="grid" count={6} />;
}
