"use client";

import { RouteError } from "@/components/route-error";

/**
 * 局部错误边界：只替换出错的内容区，保留站内外壳。
 * 文案与全局 error.tsx 共用 lib/error-report 的判定，不会出现两套口径。
 * 覆盖 /category/[slug] 与分页 /category/[slug]/p/[n]（父级 category/error.tsx
 * 只管总览本页，这里按「标签详情/专题详情」同款口径给详情面独立 scope）。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} scope="分类详情" />;
}
