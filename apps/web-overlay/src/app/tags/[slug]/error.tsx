"use client";

import { RouteError } from "@/components/route-error";

/**
 * 局部错误边界：只替换出错的内容区，保留站内外壳。
 * 文案与全局 error.tsx 共用 lib/error-report 的判定，不会出现两套口径。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} scope="标签详情" />;
}
