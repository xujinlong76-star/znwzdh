import { Skeleton } from "@/components/ui/skeleton";

/**
 * 路由级骨架屏：形状必须与真实页面同构（N11 修掉的双骨架问题）。
 *
 * 此前这里用 `<RouteSkeleton variant="list" count={8} />`（单列列表），
 * 而真实收藏页是「筛选条 + 4 列卡片墙」——骨架和内容形状对不上时，
 * 切换瞬间会「跳一下」，比没有骨架更糟。现在按页面真实布局逐块对齐：
 * 顶部筛选条 + 4 列卡片（图标 + 两行文字 + 一行元信息）。
 */
export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载收藏</span>

      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full max-w-md rounded-xl" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      {/* 卡片墙：与页内 grid 的断点一致 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card/50 p-3.5 space-y-3">
            <div className="flex items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3.5 w-2/3 rounded" />
                <Skeleton className="h-3 w-full rounded" />
              </div>
            </div>
            <Skeleton className="h-3 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
