/**
 * 路由级骨架屏（N5）。
 *
 * `/me` 是 `force-dynamic` 的服务端壳：从点击导航到首字节返回之间没有任何输出。
 * 骨架与 `me-view.tsx` 的首屏结构对齐（页头 + 身份条 + 6 张统计卡 + 双栏面板），
 * 形状不一致的骨架比没有骨架更糟——切换瞬间会「跳一下」。
 * 容器宽度/内边距与页面里的 `Container` 完全一致，否则骨架会横向抖一下。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-(--breakpoint-2xl) space-y-6 px-3 pt-3 pb-8 sm:px-6 sm:pt-4 sm:pb-10 md:px-8 lg:px-10 xl:px-12"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">正在加载用户中心</span>

      {/* 页头：标题 + 一句说明 + 右侧动作 */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="h-9 w-full animate-pulse rounded-md bg-muted sm:w-24" />
        </div>
      </div>

      {/* 身份条：头像 + 名称 + 状态胶囊 */}
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-48 max-w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 w-24 animate-pulse rounded-full bg-muted" />
          ))}
        </div>
      </div>

      {/* 统计卡：与 STAT_ITEMS 的 6 项、2/3 列断点一致 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-border/70 bg-card/50 p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-6 w-12 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* 双栏面板：个性化（7/12）+ 最近操作（5/12） */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card/50 p-4 sm:p-5 lg:col-span-7">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card/50 p-4 sm:p-5 lg:col-span-5">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      </div>

      {/* 管理入口 */}
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card/50 p-4 sm:p-5">
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      </div>
    </div>
  )
}
