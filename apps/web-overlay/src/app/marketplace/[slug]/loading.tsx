import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 详情页骨架屏（Phase 2 批 E K17）：卡片点击后路由跳转 1–5 秒期间的即时反馈。
 * 父层 /marketplace/loading.tsx 是卡片墙形态，只覆盖列表；详情页用 detail 形态，
 * 与真实详情页同构（头部操作区 + 内容区），避免切页白屏。
 */
export default function Loading() {
  return <RouteSkeleton variant="detail" />;
}
