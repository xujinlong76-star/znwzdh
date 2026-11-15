import { RouteSkeleton } from '@/components/route-skeleton'

/**
 * 路由级骨架屏：服务端渲染期间立即出占位，避免切页白屏。
 * 形状与真实页面同构（见 components/route-skeleton.tsx）。
 * （Batch 4 Phase 2 P2-4 落地时补：route-state-coverage 门禁要求每条路由
 * 有 loading.tsx 或显式豁免，/compare 此前两样都没有。）
 */
export default function Loading() {
  return <RouteSkeleton variant="grid" count={4} />
}
