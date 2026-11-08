"use client";

import { RouteError } from "@/components/route-error";

/**
 * 知识图谱局部错误边界（实验性工具页收口，2026-11-08）。该页有客户端取数（站点库拉取），是较真实的抛错面。
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
  return <RouteError error={error} reset={reset} scope="知识图谱" />;
}
