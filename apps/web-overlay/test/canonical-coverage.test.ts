import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * canonical 覆盖守卫（2026-10-21）。
 *
 * 收录型页面必须自指 canonical，否则同一个内容会被 query/分页/别名拆成
 * 多个 URL 竞争同一关键词。这里锁住「谁负责写 canonical」与写法：
 *   - 动态页 canonical 必须由**运行时参数**拼出来，不能是写死的字面量；
 *   - 分页页 canonical 自指（第 2 页不回指第 1 页），与 noindex 口径一致；
 *   - canonical 只写相对路径，origin 统一交给 metadataBase（避免硬编码域名）。
 *
 * 首页 canonical 由 /page.tsx 的 generateMetadata 提供（'/'），单独校验。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const SELF_CANONICAL = [
  { file: "src/app/hot/page.tsx", snippet: "canonical: '/hot'" },
  { file: "src/app/category/page.tsx", snippet: "canonical: '/category'" },
  { file: "src/app/collections/layout.tsx", snippet: "canonical: '/collections'" },
  { file: "src/app/tags/page.tsx", snippet: "canonical: '/tags'" },
  { file: "src/app/sites/page.tsx", snippet: "const canonical = sitesPageHref(1)" },
  { file: "src/app/tags/[slug]/page.tsx", snippet: "const canonical = `/tags/${encodeURIComponent(canonicalSlug)}`" },
  {
    file: "src/app/collections/[slug]/page.tsx",
    snippet: "const canonical = `/collections/${encodeURIComponent(safeSlug)}`",
  },
  {
    file: "src/app/category/[slug]/page.tsx",
    snippet: "const canonical = categoryHref(data.category ?? safeRef, 1)",
  },
  {
    file: "src/app/category/[slug]/p/[n]/page.tsx",
    snippet: "const canonical = categoryHref(urlKey, n)",
  },
  {
    file: "src/app/marketplace/page.tsx",
    snippet: "const canonical = `/marketplace${buildMarketplaceQuery(state)}`",
  },
];

describe("收录型页面的 canonical", () => {
  it.each(SELF_CANONICAL)("$file 输出 $snippet", ({ file, snippet }) => {
    const src = overlayFile(file);
    expect(src).toContain(snippet);
    expect(src).toMatch(/alternates:\s*\{\s*canonical/);
  });

  it("canonical 一律相对路径（origin 交给 metadataBase，禁止写死域名）", () => {
    for (const { file } of SELF_CANONICAL) {
      const src = overlayFile(file);
      const matches = src.match(/canonical[^\n]{0,120}/g) ?? [];
      for (const line of matches) {
        expect(line, `${file} 的 canonical 不应包含硬编码域名：${line}`).not.toMatch(/https?:\/\//);
      }
    }
  });

  it("分页 ≥2 页自指 canonical，且与 noindex,follow 同口径", () => {
    // 站点目录分页同样从 `?page=N` 迁到 `/sites/p/{n}`（读 searchParams 会触发
    // DYNAMIC_SERVER_USAGE），第 1 页只保留裸 `/sites` 一个 canonical。
    const sitesPaged = overlayFile("src/app/sites/p/[n]/page.tsx");
    expect(sitesPaged).toContain("robots: { index: false, follow: true }");
    expect(sitesPaged).toContain("const canonical = sitesPageHref(page)");
    // Math.max(2, ...) 是「canonical 不回指第 1 页」的实现保证
    expect(sitesPaged).toMatch(/Math\.max\(2,\s*parsePageSegment\(n\)\s*\?\?\s*2\)/);

    // 分类第 N 页（`/category/{slug}/p/{n}`）：canonical 自指，不是回第 1 页
    const category = overlayFile("src/app/category/[slug]/p/[n]/page.tsx");
    expect(category).toContain("const canonical = categoryHref(urlKey, n)");
    expect(category).toContain("robots: { index: false, follow: true }");
    // 少写第二个参数 = canonical 指回第 1 页，后续页会被判重复内容
    expect(category).not.toMatch(/canonical\s*=\s*categoryHref\([^,)]+\)/);
    // 第 1 页的 canonical 也必须显式写页码 1，不能省略参数留给人猜
    const first = overlayFile("src/app/category/[slug]/page.tsx");
    expect(first).toContain("const canonical = categoryHref(data.category ?? safeRef, 1)");
  });

  it("首页 canonical 为 '/'（唯一允许的根路径）", () => {
    const home = overlayFile("src/app/page.tsx");
    expect(home).toContain("canonical: '/'");
  });
});
