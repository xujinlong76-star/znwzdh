"use client";

import { RouteError } from "@/components/route-error";

/**
 * 展示模式变体局部错误边界：与首页共用主体，崩溃时留在壳内可重试，
 * 统一走 components/route-error.tsx（文案与全局 error.tsx 共用一套口径）。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} scope="展示模式变体" />;
}
