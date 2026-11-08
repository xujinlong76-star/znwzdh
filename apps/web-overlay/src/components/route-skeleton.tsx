/**
 * 路由级骨架屏（Server Component，无客户端 JS）。
 *
 * 为什么统一成一个组件：逐个手写骨架很容易与真实布局不一致 —— 骨架和内容
 * 形状对不上时，切换瞬间会「跳一下」，比没有骨架更糟。这里按三种页面形态
 * 给三个近似布局：
 *
 *   grid   —— 卡片墙（/hot、/tags、/videos、/category、/sites、/marketplace）
 *   detail —— 左文右卡（/algorithms、/graph）
 *   list   —— 单列列表（/preferences、/import、/submit、/custom、/offline）
 *
 * 已接入路由清单（F2：路由级加载骨架补全；门禁见
 * test/route-state-coverage.test.ts，规范见 docs/ROUTE-STATE-CONVENTIONS.md）：
 *
 *   grid   — category/  marketplace/  search/  sites/  tags/
 *   list   — custom/  import/  offline/  submit/
 *
 *   （更早接入：hot/ videos/ preferences/ algorithms/ graph/；me 族与 admin 族
 *     是形状逐块对齐的手写骨架，见门禁 HANDCRAFTED_SKELETONS，冻结不许再增。
 *     每条路由的 loading.tsx 只是「引这里对应形态」，不要在路由里手写骨架。）
 *   （错误面 2026-11-08 收口：admin/ me/ algorithms/ graph/ preferences/ 各自新增
 *     局部 error.tsx，不再落全局边界；加载面口径未变。）
 *   （软 404 回归锁：collections/ 与 site/[id] 不接 loading——骨架屏边界会先
 *     流式刷 200，notFound 就改不了状态码；锁见 collection-detail.test.ts、
 *     site-detail-404.test.ts、site-detail-performance.test.ts。）
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
