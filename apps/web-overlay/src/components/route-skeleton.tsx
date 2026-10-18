/**
 * 路由级骨架屏（Server Component，无客户端 JS）。
 *
 * 为什么统一成一个组件：`app/loading.tsx` 只有全局一份，其余 10 条路由在
 * 服务端渲染期间是**白屏**（尤其是 force-dynamic 的 /site/[id] 与 /hot）。
 * 逐个手写骨架很容易与真实布局不一致 —— 骨架和内容形状对不上时，切换瞬间
 * 会「跳一下」，比没有骨架更糟。这里按三种页面形态给三个近似布局：
 *
 *   grid   —— 卡片墙（/hot、/tags、/collections、/videos）
 *   detail —— 左文右卡（/site/[id]、/collections/[slug]、/tags/[slug]）
 *   list   —— 单列列表（/favorites、/preferences）
 *
 * 说明：骨架只求「占位形状接近」，不追求像素级复刻；真实布局改动后
 * 只需调整这里一处。
 */
import { Skeleton } from "@/components/ui/skeleton";

export type RouteSkeletonVariant = "grid" | "detail" | "list";

export function RouteSkeleton({
  variant = "grid",
  count = 12,
}: {
  variant?: RouteSkeletonVariant;
  count?: number;
}) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载内容</span>

      {/* 标题区：三条路由都有，形状一致 */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-40 rounded-lg" />
        <Skeleton className="h-4 w-72 rounded" />
      </div>

      {variant === "grid" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border bg-card/50 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-3/4 rounded" />
                  <Skeleton className="h-3 w-1/2 rounded" />
                </div>
              </div>
              <Skeleton className="h-8 w-full rounded" />
            </div>
          ))}
        </div>
      )}

      {variant === "detail" && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-2xl" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-6 w-1/2 rounded" />
                <Skeleton className="h-4 w-2/3 rounded" />
              </div>
            </div>
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
      )}

      {variant === "list" && (
        <div className="space-y-3">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl border bg-card/50">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-1/3 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
              </div>
              <Skeleton className="h-8 w-20 rounded" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
