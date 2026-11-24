import { RouteSkeleton } from '@/components/route-skeleton'

/** /similar 加载骨架：与全站骨架体系一致（route-state-coverage：每条路由有 loading 或显式豁免）。 */
export default function Loading() {
  return <RouteSkeleton />
}
