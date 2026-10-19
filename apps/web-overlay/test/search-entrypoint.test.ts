/**
 * 站内搜索入口：**站点列表页不能只能一路点下去**。
 *
 * 真实缺陷（改动前）：`SearchPalette`（带中枢混合检索的命令面板）只挂在首页，
 * 连 ⌘K 也只在首页生效 —— 于是 /hot（榜单）、/tags/[slug]（标签下的站点）、
 * /collections/[slug]（专题下的站点）这三类「一屏站点卡片」的页面**完全没有搜索**：
 * 用户看到榜单里没有想找的东西，只能返回首页重来。
 *
 * 这里锁：
 *   1. 站点列表页必须渲染搜索入口；
 *   2. 提示文案要说清「搜的是全部站点」，否则用户会以为只在本页范围内搜；
 *   3. 两个有意例外（/videos 有自己的视频检索；/favorites 是「我的收藏」）
 *      必须保持原样，别顺手加错。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

/** 有搜索入口的页面（首页 + 404 + 三类站点列表页） */
const PAGES_WITH_SEARCH = [
  "src/components/navigation-toolbar.tsx",
  "src/app/not-found.tsx",
  "src/app/hot/page.tsx",
  "src/app/tags/[slug]/page.tsx",
  "src/app/collections/[slug]/page.tsx",
];

/** 这一批是本 PR 新加的站点列表页，提示文案必须点明「全部站点」 */
const SITE_LIST_PAGES = [
  "src/app/hot/page.tsx",
  "src/app/tags/[slug]/page.tsx",
  "src/app/collections/[slug]/page.tsx",
];

describe("站点列表页必须有搜索入口", () => {
  it.each(PAGES_WITH_SEARCH)("%s 渲染 SearchPalette", (rel) => {
    const src = overlaySource(rel);
    expect(src).toContain("import { SearchPalette } from '@/components/search-palette'");
    expect(src).toMatch(/<SearchPalette/);
  });

  it.each(SITE_LIST_PAGES)("%s 的提示文案要说清「搜的是全部站点」", (rel) => {
    const src = overlaySource(rel);
    // 用户在榜单/标签/专题页看到搜索框时，最自然的误解是「只搜当前范围」
    expect(src).toMatch(/<SearchPalette placeholder="[^"]*全部站点/);
  });

  it("搜索面板放在列表之前（列表为空时它仍然可见）", () => {
    const src = overlaySource("src/app/collections/[slug]/page.tsx");
    const palette = src.indexOf("<SearchPalette");
    const empty = src.indexOf("该专题暂时没有站点");
    const grid = src.indexOf("sites.map((site)");
    expect(palette).toBeGreaterThan(-1);
    expect(palette).toBeLessThan(empty);
    expect(palette).toBeLessThan(grid);
  });
});

describe("有意的例外：不要顺手加错地方", () => {
  it("/videos 保留自己的 SearchBar（视频检索与站点检索不是一回事）", () => {
    const src = overlaySource("src/components/video-content.tsx");
    expect(src).toContain("<SearchBar");
  });

  it("/favorites 不放全站搜索：本页语义是「我的收藏」，全站搜索在首页与列表页", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    expect(src).not.toContain("SearchPalette");
  });
});
