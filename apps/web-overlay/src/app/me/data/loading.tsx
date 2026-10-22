/**
 * 路由级骨架屏（N5）：形状与 `me/data/page.tsx` 一致（页头 + 导出 / 说明 / 危险区），
 * 容器宽度与页面 `Container` 对齐，避免切换瞬间横向抖动。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-(--breakpoint-2xl) space-y-6 px-3 pt-3 pb-8 sm:px-6 sm:pt-4 sm:pb-10 md:px-8 lg:px-10 xl:px-12"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">正在加载数据与隐私</span>

      <div className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="h-3 w-14 animate-pulse rounded bg-muted" />
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-80 max-w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>

      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-border/70 bg-card/50 p-4 sm:p-5">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
