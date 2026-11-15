import { RouteSkeleton } from "@/components/route-skeleton";

/** 路由级骨架屏：问答页是纵向问答版面（页头 + 提问框 + 回答段落），用 list 形态占位 */
export default function Loading() {
  return <RouteSkeleton variant="list" count={6} />;
}
