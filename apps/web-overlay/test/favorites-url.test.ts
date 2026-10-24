/**
 * 收藏页筛选条件的 URL 往返。
 *
 * 真实缺陷：搜索词 / 收藏夹 / 排序只在组件 state 里，点开站点再返回就全部复位。
 * 这里锁住纯函数的往返与边界（默认值不落参数、超长截断、非法排序回退），
 * 另加源码守卫确保页面真的接上了 URL 同步。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildFavoritesSearch,
  parseFavoritesFilters,
  FAVORITES_DEFAULT_FILTERS,
} from "../src/lib/favorites-url";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.includes("web-overlay") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("收藏筛选 URL 往返", () => {
  it("默认筛选不产生任何参数（地址栏保持干净）", () => {
    expect(buildFavoritesSearch(FAVORITES_DEFAULT_FILTERS)).toBe("");
  });

  it("三个条件都能往返", () => {
    const filters = { q: "react 教程", folder: "folder-1", sort: "title" as const };
    const parsed = parseFavoritesFilters(buildFavoritesSearch(filters));
    expect(parsed).toEqual(filters);
  });

  it("超长关键词截断到 100，空白关键词不落参数", () => {
    expect(parseFavoritesFilters("?q=" + "a".repeat(150)).q).toHaveLength(100);
    expect(buildFavoritesSearch({ q: "   ", folder: "all", sort: "created" })).toBe("");
  });

  it("非法排序回退 created，folder=all 视为默认", () => {
    const parsed = parseFavoritesFilters("?sort=whatever&folder=all");
    expect(parsed.sort).toBe("created");
    expect(parsed.folder).toBe("all");
  });

  it("页面接线：收藏页与榜单页都同步地址栏", () => {
    expect(overlaySource("src/app/favorites/page.tsx")).toContain("buildFavoritesSearch");
    expect(overlaySource("src/app/hot/hot-view.tsx")).toContain("params.set('tab', 'new')");
  });
});
