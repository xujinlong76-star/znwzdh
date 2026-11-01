import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 形状与真实页面同构（见 components/route-skeleton.tsx）——
 * 网站投稿是单列表单流（force-dynamic 取类目），取 list 形态。
 */
export default function Loading() {
  return <RouteSkeleton variant="list" count={4} />;
}
