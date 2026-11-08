"use client";

import { RouteError } from "@/components/route-error";

/**
 * 偏好设置局部错误边界（低频工具页收口，2026-11-08）。
 * 统一走 components/route-error.tsx：文案与全局 error.tsx 共用 lib/error-report
 * 的判定，不会出现两套口径（见 docs/ROUTE-STATE-CONVENTIONS.md §2）。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} scope="偏好设置" />;
}
