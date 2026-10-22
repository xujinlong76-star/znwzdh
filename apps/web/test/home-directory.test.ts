import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * F1：首页站内目录带（2026-10-22）。
 *
 * 背景：改版前首页 HTML 里 0 条 `/category` 链接，分类 hub 只能靠 sitemap
 * 被发现。修复形态：服务端挑达标分类（>= MIN_SITES_FOR_INDEX）下发给导航岛，
 * 岛内 SSR 直出分类链接，并常驻 /category、/sites、/tags 三个总览入口。
 *
 * 不变量：
 *   1. 分类数据在服务端取，客户端不再发请求；
 *   2. 薄分类不链（分类页对 < 5 站的分类直接 404）；
 *   3. 中枢失败（categories/counts 为 null）不得让三个总览入口一起消失。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("首页站内目录带（F1）", () => {
  it("服务端取分类与计数，按达标数降序取前 8", () => {
    const src = overlayFile("src/app/page.tsx");
    expect(src).toContain("loadCategories(3600)");
    expect(src).toContain("loadActiveCategoryCounts(3600)");
    expect(src).toContain("MIN_SITES_FOR_INDEX");
    expect(src).toMatch(/counts\.get\(c\.id\) \?\? 0\) >= MIN_SITES_FOR_INDEX/);
    expect(src).toContain("DIRECTORY_CATEGORY_LINKS = 8");
    expect(src).toContain("directoryLinks={directoryLinks}");
  });

  it("取数失败返回空数组，不影响页面其余部分", () => {
    const src = overlayFile("src/app/page.tsx");
    expect(src).toMatch(/if \(!categories \|\| !counts\) return \[\]/);
  });

  it("导航岛渲染目录带：三个总览入口 + 分类链接", () => {
    const src = overlayFile("src/components/navigation-content.tsx");
    expect(src).toContain('aria-labelledby="home-directory-title"');
    expect(src).toContain('href="/category"');
    expect(src).toContain('href="/sites"');
    expect(src).toContain('href="/tags"');
    expect(src).toContain("href={`/category/${encodeURIComponent(link.id)}`}");
  });
});
