import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 形状与真实页面同构（见 components/route-skeleton.tsx）——
 * 分类浏览页是分类卡片网格，取 grid 形态。
 * 分类页是服务端页（revalidate=60，服务端取各 kind 实时总数），
 * 慢网下有真实白屏窗口；本级无 notFound，可安全接骨架。
 */
export default function Loading() {
  return <RouteSkeleton variant="grid" count={8} />;
}
