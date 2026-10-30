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

/** 有搜索入口的页面（首页 + 404 + 站点列表页），搜索面板就在页面源码里 */
const PAGES_WITH_SEARCH = [
  "src/components/navigation-toolbar.tsx",
  "src/app/not-found.tsx",
  // 分类 hub：翻页有深度上限，搜索是长尾站点的唯一出口
  "src/app/category/[slug]/category-board.tsx",
];

/**
 * RSC 化后站点列表页都是「服务端壳 + 客户端岛」：页面源码里不再出现
 * SearchPalette，改由岛渲染。守卫因此拆两半——壳必须挂岛（否则 SSR 首帧
 * 连搜索入口都没有，正是本测试要防的退化），岛必须渲染面板。
 */
const ISLAND_SEARCH_PAGES = [
  { page: "src/app/tags/[slug]/page.tsx", island: "src/components/tag-results-board.tsx", marker: "<TagResultsBoard" },
  { page: "src/app/hot/page.tsx", island: "src/app/hot/hot-view.tsx", marker: "<HotView" },
  {
    page: "src/app/collections/[slug]/page.tsx",
    island: "src/app/collections/[slug]/collection-detail-view.tsx",
    marker: "<CollectionDetailView",
  },
];

/** 这一批是站点列表页，提示文案必须点明「全部站点」（RSC 化后都在岛里）。 */
const SITE_LIST_PAGES = [
  "src/app/hot/hot-view.tsx",
  "src/app/category/[slug]/category-board.tsx",
  "src/components/tag-results-board.tsx",
  "src/app/collections/[slug]/collection-detail-view.tsx",
];

describe("站点列表页必须有搜索入口", () => {
  it.each(PAGES_WITH_SEARCH)("%s 渲染 SearchPalette", (rel) => {
    const src = overlaySource(rel);
    // 允许按需加载（not-found 边界在每条路由的初始树里，见 not-found.test.ts）
    expect(src).toMatch(
      /import\('@\/components\/search-palette'\)|import \{ SearchPalette \} from '@\/components\/search-palette'/,
    );
    expect(src).toMatch(/<SearchPalette/);
  });

  it.each(ISLAND_SEARCH_PAGES)("$page 经客户端岛 $island 提供搜索", ({ page, island, marker }) => {
    const shell = overlaySource(page);
    const board = overlaySource(island);
    expect(shell).toContain(marker);
    expect(board).toContain("import { SearchPalette } from '@/components/search-palette'");
    expect(board).toMatch(/<SearchPalette/);
  });

  it.each(SITE_LIST_PAGES)("%s 的提示文案要说清「搜的是全部站点」", (rel) => {
    const src = overlaySource(rel);
    // 用户在榜单/标签/专题页看到搜索框时，最自然的误解是「只搜当前范围」
    expect(src).toMatch(/<SearchPalette placeholder="[^"]*全部站点/);
  });

  it("搜索面板放在列表之前（列表为空时它仍然可见）", () => {
    const src = overlaySource("src/app/collections/[slug]/collection-detail-view.tsx");
    const palette = src.indexOf("<SearchPalette");
    const empty = src.indexOf("该专题暂时没有站点");
    const grid = src.indexOf("sites.map((site)");
    expect(palette).toBeGreaterThan(-1);
    expect(palette).toBeLessThan(empty);
    expect(palette).toBeLessThan(grid);
  });

  it("标签页被 100 条上限截断时，给出去 /search?tag= 的分页出口（不是回目录绕路）", () => {
    const board = overlaySource("src/components/tag-results-board.tsx");
    // 截断提示里必须是真能翻到剩余站点的通道：/sites 目录需要用户自己再按标签找回来
    expect(board).toContain("查看该标签下的全部站点");
    expect(board).toContain("/search?tag=${encodeURIComponent(slug)}");
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
