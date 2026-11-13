import { RouteSkeleton } from "@/components/route-skeleton";

/** 路由级骨架屏：考试日历是倒计时卡片网格，用 grid 形态占位 */
export default function Loading() {
  return <RouteSkeleton variant="grid" count={4} />;
}
