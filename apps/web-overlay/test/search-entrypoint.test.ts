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
 *
 * 「接入形式」口径（2026-11-11 William 拍板）：SearchPalette 本体约 1,500 行，
 * 静态引入会随首屏下发——实测改回静态引入，/category/[slug]、/hot、专题、
 * 标签四条路由首屏全部破预算（958>913、999>951、981>914、968>913 KB）。
 * 因此合法接入有三种，下面的 searchPaletteAccess 逐一严格识别（必须证明
 * 面板真进了渲染路径，不是提了个名字就算数）：
 *   a. 静态引入：import { SearchPalette } from '@/components/search-palette'；
 *   b. 内联按需加载：dynamic(() => import('@/components/search-palette')…)
 *      （not-found、navigation-toolbar 的范式）；
 *   c. 全站懒加载包装：从 '@/components/search-palette-lazy' 引入
 *      SearchPaletteLazy（可 as 别名），包装本体由本文件单独一条用例钉死
 *      （它必须真按需加载并渲染 SearchPalette 本体，包装若被掏空这里会红）。
 *
 * 特别注意 category-board：它是**服务端组件**（文件头没有 'use client'），
 * Next 硬性禁止在服务端组件里内联 dynamic(..., { ssr: false })，形式 b 对它
 * 不可用；它只能走 c 的客户端包装。这不是偷懒，别再当 bug 改回静态引入。
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

type PaletteAccess = "static" | "inline-dynamic" | "lazy-wrapper";

/**
 * 严格识别一个文件以哪种合法形式接入 SearchPalette（口径见文件头）：
 * 三种形式都要求「引入 + 实际渲染」同时成立，只 import 不渲染、或只在注释
 * 里提名字都不算。返回 null = 没接（正是本守卫要拦的退化）。
 */
function searchPaletteAccess(src: string): PaletteAccess | null {
  const rendersPalette = /<SearchPalette(?=[\s/>])/.test(src);
  // a. 静态引入
  if (/import \{ SearchPalette \} from '@\/components\/search-palette'/.test(src) && rendersPalette) {
    return "static";
  }
  // b. 内联按需加载：必须真是 dynamic(() => import(本体))，裸 import() 不算
  if (
    /dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/search-palette'\)/.test(src) &&
    rendersPalette
  ) {
    return "inline-dynamic";
  }
  // c. 全站懒加载包装：引入 SearchPaletteLazy（可带 as 别名）且渲染该本地名
  const lazyImport = src.match(
    /import \{ SearchPaletteLazy(?: as ([A-Za-z_$][\w$]*))? \} from '@\/components\/search-palette-lazy'/,
  );
  if (lazyImport) {
    const localName = lazyImport[1] ?? "SearchPaletteLazy";
    if (new RegExp(`<${localName}(?=[\\s/>])`).test(src)) return "lazy-wrapper";
  }
  return null;
}

/** 有搜索入口的页面（工具栏 + 404 + 分类 hub），面板接入形式见文件头口径 */
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
    // 接入形式不限（静态 / 内联按需 / 懒加载包装，见文件头），但必须真接进渲染路径
    expect(searchPaletteAccess(src)).not.toBeNull();
  });

  it("懒加载包装 search-palette-lazy 本体是真的：按需加载并渲染 SearchPalette", () => {
    // 形式 c 的前提：包装若哪天被掏空（比如只剩占位 div），所有走包装的页面
    // 会一起丢搜索，所以包装本体单独钉死，不许它变成空壳。
    const src = overlaySource("src/components/search-palette-lazy.tsx");
    expect(src).toContain("'use client'");
    expect(src).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/search-palette'\)\.then\(\(m\) => m\.SearchPalette\)/,
    );
    expect(src).toContain("ssr: false");
    expect(src).toContain("export function SearchPaletteLazy");
    expect(src).toMatch(/<SearchPalette \{\.\.\.props\} \/>/);
  });

  it.each(ISLAND_SEARCH_PAGES)("$page 经客户端岛 $island 提供搜索", ({ page, island, marker }) => {
    const shell = overlaySource(page);
    const board = overlaySource(island);
    expect(shell).toContain(marker);
    // 岛的接入形式同样认三种合法形式（口径见文件头），功能不变、形式不锁死
    expect(searchPaletteAccess(board)).not.toBeNull();
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
    // 列表变量名可能是 filteredSites（分类/关键词筛选后）——钉的是「面板在列表之前」，
    // 不是某一个具体变量名，否则一次无关重命名就会让这条守卫失效。
    const gridMatch = src.match(/\b(?:filteredSites|sites)\.map\(\(site\)/)
    const grid = gridMatch ? (gridMatch.index ?? -1) : -1
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
