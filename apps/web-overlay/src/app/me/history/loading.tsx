/**
 * 路由级骨架屏（N5）：形状与 `me/history/page.tsx` 一致（页头 + 4 行列表），
 * 容器宽度与页面 `Container` 对齐，避免切换瞬间横向抖动。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-(--breakpoint-2xl) space-y-6 px-3 pt-3 pb-8 sm:px-6 sm:pt-4 sm:pb-10 md:px-8 lg:px-10 xl:px-12"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">正在加载搜索历史</span>

      <div className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="h-3 w-14 animate-pulse rounded bg-muted" />
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 max-w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="h-9 w-full animate-pulse rounded-md bg-muted sm:w-24" />
        </div>
      </div>

      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card/50">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-40 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
