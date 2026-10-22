import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏（N5）：`/me/data` 是「导出 + 数据说明 + 删除」两块面板，
 * 用 list 变体（标题 + 4 块）近似即可。
 */
export default function Loading() {
  return <RouteSkeleton variant="list" count={3} />;
}
