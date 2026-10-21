/**
 * 「我的收藏」的本地筛选。
 *
 * 真实痛点（改动前）：收藏页把 localStorage 里的收藏**一次性全部铺开**，
 * 没有任何筛选或搜索入口。收藏十几个还看得过来，攒到几十上百个之后，
 * 想找某一个只能靠眼睛在网格里扫 —— 而这一页恰恰是「只想快速点开某个站」的场景。
 *
 * 这里锁三件事：
 *   1. 匹配规则（多词 AND、跨字段、不区分大小写、中文子串）；
 *   2. 空关键词的行为（不过滤 + **引用不变**，别让下游白重渲染）；
 *   3. 接线与诚实：网格渲染筛选结果；「筛选没命中」绝不能显示成「还没有收藏」。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  describeFavoritesFilter,
  favoriteFilterEmptyMessage,
  filterFavorites,
  matchesFavoriteQuery,
  parseFavoriteQuery,
} from "../src/lib/favorites-filter";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const GITHUB = { title: "GitHub", href: "https://github.com", description: "代码托管" };
const REACT = { title: "React 文档", href: "https://react.dev", description: "前端框架" };
const ZW = { title: "中文工具箱", href: "https://example.com/cn", description: "离线优先的排版工具" };

describe("parseFavoriteQuery：把输入拆成可预测的检索词", () => {
  it("空 / 纯空白 → 没有词（= 不过滤）", () => {
    expect(parseFavoriteQuery("")).toEqual([]);
    expect(parseFavoriteQuery("   ")).toEqual([]);
    expect(parseFavoriteQuery("\t\n ")).toEqual([]);
    // 运行时可能收到 undefined（例如上游把字段漏了），不能因此崩掉整页筛选
    expect(parseFavoriteQuery(undefined as unknown as string)).toEqual([]);
  });

  it("按空白拆分、转小写、去重、丢空串", () => {
    expect(parseFavoriteQuery("GitHub  React")).toEqual(["github", "react"]);
    expect(parseFavoriteQuery("  github   GITHUB ")).toEqual(["github"]);
    expect(parseFavoriteQuery("a\tb\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("matchesFavoriteQuery：命中范围与大小写", () => {
  it("标题不区分大小写；中文按子串", () => {
    expect(matchesFavoriteQuery(GITHUB, "github")).toBe(true);
    expect(matchesFavoriteQuery(GITHUB, "GITHUB")).toBe(true);
    expect(matchesFavoriteQuery(ZW, "工具箱")).toBe(true);
  });

  it("链接与描述也参与匹配（用户常常直接粘一段域名）", () => {
    expect(matchesFavoriteQuery(GITHUB, "github.com")).toBe(true);
    expect(matchesFavoriteQuery(REACT, "前端框架")).toBe(true);
    expect(matchesFavoriteQuery(REACT, "vue")).toBe(false);
  });

  it("多个词是 AND，且可以跨字段命中", () => {
    // 「github」在标题，「代码托管」在描述
    expect(matchesFavoriteQuery(GITHUB, "github 代码")).toBe(true);
    expect(matchesFavoriteQuery(GITHUB, "github vue")).toBe(false);
  });

  it("空关键词视为全命中（不能把整页收藏藏起来）", () => {
    expect(matchesFavoriteQuery(GITHUB, "")).toBe(true);
    expect(matchesFavoriteQuery(GITHUB, "   ")).toBe(true);
  });
});

describe("filterFavorites：顺序、引用与不可变性", () => {
  const items = [GITHUB, REACT, ZW];

  it("保序返回命中的子集", () => {
    expect(filterFavorites(items, "github").map((i) => i.title)).toEqual(["GitHub"]);
    expect(filterFavorites(items, "react 文档").map((i) => i.title)).toEqual(["React 文档"]);
  });

  it("全部命中时也返回原数组引用（避免无谓重渲染）", () => {
    // 't' 在三项里都出现（github / react / https）
    expect(filterFavorites(items, "t")).toBe(items);
  });

  it("没有命中 → 空数组；原数组不被修改", () => {
    expect(filterFavorites(items, "不存在的关键词")).toEqual([]);
    expect(items).toHaveLength(3);
  });
});

describe("文案：让用户知道是「被筛掉了」而不是「丢了」", () => {
  it("没有关键词时不显示任何计数", () => {
    expect(describeFavoritesFilter(3, 3, "")).toBeNull();
    expect(describeFavoritesFilter(0, 3, "   ")).toBeNull();
  });

  it("有关键词时同时给出命中数与总数", () => {
    expect(describeFavoritesFilter(1, 12, "github")).toBe("匹配 1 / 12 个收藏");
    expect(describeFavoritesFilter(0, 12, "github")).toBe("匹配 0 / 12 个收藏");
  });

  it("无结果提示带上用户输入的关键词（并去掉首尾空白）", () => {
    expect(favoriteFilterEmptyMessage("  github  ")).toBe("没有收藏匹配「github」");
    expect(favoriteFilterEmptyMessage("")).toBe("没有收藏匹配当前条件");
  });
});

describe("源码守卫：筛选真的接在页面上，且两种「空」不混淆", () => {
  it("网格渲染的是筛选结果（再叠加收藏夹过滤），不是全量收藏", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    const gridAt = src.indexOf("min-[1536px]:grid-cols-5");
    expect(gridAt).toBeGreaterThan(-1);
    const grid = src.slice(gridAt, gridAt + 400);
    // 第二批在筛选结果之上叠加了收藏夹过滤（visibleFavorites），但绝不能直接用全量 items
    expect(grid).toContain("visibleFavorites.map(");
    expect(grid).not.toContain("favorites.items.map(");
    const filteredAt = src.indexOf("const filteredFavorites = useMemo(");
    expect(filteredAt).toBeGreaterThan(-1);
    expect(src.slice(filteredAt, filteredAt + 300)).toContain("filterFavorites(favorites.items, favoriteQuery)");
    const visibleAt = src.indexOf("const visibleFavorites = useMemo(");
    expect(visibleAt).toBeGreaterThan(-1);
    expect(src.slice(visibleAt, visibleAt + 300)).toContain("filteredFavorites");
  });

  it("筛选条只在确实有收藏时出现，并且是受控输入 + 可清除", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    expect(src).toContain("const [favoriteQuery, setFavoriteQuery] = useState('')");
    expect(src).toContain("filterFavorites(favorites.items, favoriteQuery)");
    expect(src).toContain("value={favoriteQuery}");
    expect(src).toContain('aria-label="筛选收藏"');
    expect(src).toContain("setFavoriteQuery('')");
    const inputAt = src.indexOf("value={favoriteQuery}");
    const before = src.slice(Math.max(0, inputAt - 700), inputAt);
    expect(before).toContain("favorites.items.length > 0 && (");
  });

  it("「收藏是空的」与「筛选没命中」必须是两个不同的分支和文案", () => {
    const src = overlaySource("src/app/favorites/page.tsx");
    // 真正的空：引导用户去收藏
    expect(src).toContain("还没有收藏任何站点");
    // 筛选/收藏夹未命中：单独分支，且明确说明数据还在
    expect(src).toContain("visibleFavorites.length === 0 ? (");
    expect(src).toContain("favoriteFilterEmptyMessage(favoriteQuery)");
    expect(src).toContain("收藏并没有丢：共 {favorites.items.length} 个都还在本机");
  });
});
