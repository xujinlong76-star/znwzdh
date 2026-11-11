import { RouteSkeleton } from "@/components/route-skeleton";

/** 路由级骨架屏：简报是纵向分段版面，用 list 形态占位 */
export default function Loading() {
  return <RouteSkeleton variant="list" count={6} />;
}
