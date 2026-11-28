import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏：天气页是单列详情版面（实况大卡 + 逐小时条 + 7 日列表 + 空气质量卡），用 detail 形态占位。
 */
export default function Loading() {
  return <RouteSkeleton variant="detail" />;
}
