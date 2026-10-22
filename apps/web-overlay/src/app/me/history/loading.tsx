import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏（N5）：形状与 `me/history/page.tsx` 的列表一致（4 行）。
 */
export default function Loading() {
  return <RouteSkeleton variant="list" count={4} />;
}
