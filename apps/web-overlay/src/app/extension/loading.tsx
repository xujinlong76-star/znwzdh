import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 形状与真实页面同构（见 components/route-skeleton.tsx）——
 * 扩展指南页是纵向 4 段（页头展板 + 三卡片 + 安装方法），取 list 形态；
 * 与同款静态指南页 offline/loading.tsx（list, count 4）同口径。
 * 本页无 notFound（纯静态 metadata + 文案），可安全接骨架。
 */
export default function Loading() {
  return <RouteSkeleton variant="list" count={4} />;
}
