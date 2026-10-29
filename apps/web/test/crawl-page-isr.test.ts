import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 爬虫面动态段 ISR 守卫（2026-10-22）。
 *
 * Next 16 里动态段只写 `revalidate` 不会进入 ISR——必须同时存在
 * `generateStaticParams`（允许返回空数组）。漏掉它时页面仍逐请求渲染，
 * 响应头是 `Cache-Control: no-store`，爬虫重复抓取会持续打穿中枢。
 *
 * 分类页 `[id]` 不在此列：它读取 `searchParams.page` 做分页，属于动态 API，
 * 要 ISR 得先重构分页（拆路由或改客户端分页），不在本守卫范围内。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const CRAWL_PAGES = ["src/app/tags/[slug]/page.tsx", "src/app/collections/[slug]/page.tsx"];

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("爬虫面动态段 ISR", () => {
  for (const rel of CRAWL_PAGES) {
    it(`${rel} 开启 60s ISR 且提供空 generateStaticParams`, () => {
      const page = overlayFile(rel);
      expect(page).toContain("export const revalidate = 60");
      expect(page).toMatch(/export async function generateStaticParams\(\)\s*\{\s*return \[\]/);
    });
  }

  it("标签页与合集页都直出站内详情内链（ISR 不能退化成空壳）", () => {
    expect(overlayFile("src/app/tags/[slug]/page.tsx")).toContain("TagResultsBoard");
    expect(overlayFile("src/app/collections/[slug]/page.tsx")).toContain(
      "initialCollection={collection}",
    );
  });
});

/**
 * 根布局挂在所有静态页的渲染树里：里面任何一次 no-store 取数都会让整棵树
 * 在运行时被判成动态（实测 /category/[slug]/p/[n] 500 "Page changed from
 * static to dynamic"，见 2026-10-29 的 ISR 抽查）。品牌配置因此必须走
 * 带标签的 Data Cache，「保存后刷新即见新值」由写侧 revalidateTag 保证。
 */
describe("根布局取数不得把静态页拖成动态", () => {
  it("品牌配置走缓存读（getFileContentWithStatus），不引入 readStorageFresh", () => {
    const source = overlayFile("src/lib/site-config-source.ts");
    expect(source).toContain("getFileContentWithStatus(SITE_CONTENT_PATH)");
    expect(source).not.toMatch(/import\s*\{[^}]*readStorageFresh[^}]*\}\s*from/);
  });

  it("读侧挂 HUB_CACHE_TAG，站点配置写成功后按同一标签失效", () => {
    expect(overlayFile("src/lib/github.ts")).toContain("tags: [HUB_CACHE_TAG]");
    expect(overlayFile("src/app/api/site/route.ts")).toContain("revalidateTag(HUB_CACHE_TAG, 'max')");
  });
});
