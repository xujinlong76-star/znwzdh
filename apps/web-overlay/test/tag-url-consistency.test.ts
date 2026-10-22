import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 标签 URL 单一形态守卫（2026-10-22）。
 *
 * `/tags/{slug}` 的 slug 必须由 `tagSlug()`（与 store slugify 同构）产出：
 * 直接 encodeURIComponent 原始标签名会留下空格、斜杠、大小写与别名差异，
 * 同一标签被拆成多个 URL —— sitemap、标签云、卡片、分类页各指一处，
 * canonical 再正确也救不回来。
 *
 * 本文件锁三处曾经的漏网点（navigation-card 已由 card-tag-links 覆盖）：
 *   1. 分类详情「相关标签」；
 *   2. 站点详情「话题标签」；
 *   3. 标签页 canonical / 面包屑 / 客户端岛的 slug 统一用 resolve 的规范 slug。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("标签 URL 单一形态", () => {
  it.each([
    "src/app/category/[slug]/category-board.tsx",
    "src/components/site-detail-view.tsx",
    "src/components/navigation-card.tsx",
  ])("%s 的 #tag 链接都经过 tagSlug()", (file) => {
    const src = overlayFile(file);
    expect(src).toContain("tagSlug");
    // 原始标签名直接进 URL 是历史 bug（空格/斜杠/大小写会分叉）
    expect(src).not.toMatch(/href=\{?[`'"]\/tags\/\$\{encodeURIComponent\((?!tagSlug)/);
    expect(src).not.toContain("`/tags/${encodeURIComponent(tag)}`");
  });

  it("标签页 canonical 用 resolve 返回的规范 slug，别名页不自指", () => {
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    expect(src).toContain("const canonicalSlug = tagRes?.tag?.slug ?? safeSlug");
    expect(src).toContain("const canonical = `/tags/${encodeURIComponent(canonicalSlug)}`");
    expect(src).not.toContain("const canonical = `/tags/${encodeURIComponent(safeSlug)}`");
  });

  it("面包屑与客户端岛同用规范 slug（视觉 URL 与 canonical 不分叉）", () => {
    const src = overlayFile("src/app/tags/[slug]/page.tsx");
    expect(src).toContain("path: `/tags/${encodeURIComponent(canonicalSlug)}`");
    expect(src).toContain("slug={canonicalSlug}");
    expect(src).not.toContain("slug={safeSlug}");
  });

  it("sitemap 的标签条目使用服务端返回的 slug，不再二次 slugify", () => {
    const src = overlayFile("src/lib/seo/sitemap-entries.ts");
    expect(src).toContain("`${normOrigin(origin)}/tags/${encodeURIComponent(slug)}`");
  });
});
