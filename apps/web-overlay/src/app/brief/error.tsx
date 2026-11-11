"use client";

import { RouteError } from "@/components/route-error";

/** 局部错误边界：只替换出错的内容区，保留站内外壳 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} scope="每日简报" />;
}
