import { RouteSkeleton } from "@/components/route-skeleton";

/**
 * 路由级骨架屏（N5）。
 *
 * `/me` 是 `force-dynamic` 的服务端壳：从点击导航到首字节返回之间没有任何输出。
 * 骨架与 `me-view.tsx` 的首屏结构对齐（身份条 + 6 张统计卡 + 两块面板），
 * 形状不一致的骨架比没有骨架更糟——切换瞬间会「跳一下」。
 */
export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载用户中心</span>

      {/* 身份条：头像 + 名称 + 状态胶囊 */}
      <div className="rounded-xl border bg-card/60 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-48 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 w-24 animate-pulse rounded-full bg-muted" />
          ))}
        </div>
      </div>

      {/* 统计卡：与 STAT_ITEMS 的 6 项一致 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border bg-card/50 p-4 space-y-3">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-6 w-12 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* 两块面板 */}
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl border bg-card/50 p-5 space-y-3">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
