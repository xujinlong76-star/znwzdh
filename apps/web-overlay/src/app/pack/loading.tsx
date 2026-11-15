import { RouteSkeleton } from '@/components/route-skeleton'

/**
 * 路由级骨架屏：链接包接收页是单列清单（标题卡片 + 站点行），用 list 形态占位。
 * 骨架体系唯一：loading.tsx 只许引用 RouteSkeleton，不手写骨架
 * （门禁见 test/route-state-coverage.test.ts）。
 */
export default function Loading() {
  return <RouteSkeleton variant="list" count={6} />
}
