'use client'

import { RouteError } from '@/components/route-error'

/** /similar 局部错误边界：崩溃留在页内，不踢出外壳（route-state-coverage）。 */
export default function SimilarError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} scope="similar" />
}
