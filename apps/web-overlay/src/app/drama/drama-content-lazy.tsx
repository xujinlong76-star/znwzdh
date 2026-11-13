"use client";

import dynamic from "next/dynamic";
import type { DramaSite } from "@/lib/drama-sites";
import type { DramaFeatured } from "@/lib/drama-featured";

/**
 * /drama 也走“客户端岛”：DramaContent 含互动（关注按钮、弹窗菜单），
 * 用 next/dynamic 切出异步 chunk。注意：不要在这里设 ssr: false——
 * 专区页要能被索引，服务端仍渲染真实内容，只是水合走异步 chunk
 * （与 /videos 的 video-content-lazy 同一口径）。
 */
const DramaContent = dynamic(
  () => import("@/components/drama-content").then((m) => m.DramaContent),
  {
    loading: () => (
      <div
        className="mx-auto w-full max-w-7xl px-4 py-8"
        aria-busy="true"
        aria-label="正在加载短剧专区内容"
      >
        <div className="h-10 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      </div>
    ),
  },
);

export function DramaContentLazy({
  sites,
  dramas,
}: {
  sites: DramaSite[];
  dramas: DramaFeatured[];
}) {
  return <DramaContent sites={sites} dramas={dramas} />;
}
