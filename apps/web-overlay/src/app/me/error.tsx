"use client";

import { RouteError } from "@/components/route-error";

/**
 * 用户中心局部错误边界（2026-11-08 收口：此前 me/* 全部落全局 error.tsx，出错的用户页面会丢掉整个站内外壳）。
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
  return <RouteError error={error} reset={reset} scope="用户中心" />;
}
