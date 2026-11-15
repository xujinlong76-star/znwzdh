'use client'

import { RouteError } from '@/components/route-error'

/**
 * 局部错误边界：只替换出错的内容区，保留站内外壳。
 * 文案与全局 error.tsx 共用 lib/error-report 的判定，不会出现两套口径。
 * （Batch 4 Phase 2 P2-4 落地时补：route-state-coverage 门禁要求每条路由
 * 有 error.tsx 或显式豁免，/compare 此前两样都没有。）
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError error={error} reset={reset} scope="横向对比" />
}
