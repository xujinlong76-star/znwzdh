/**
 * 搜索面板空查询「我的收藏」提示行崩溃回归（2026-11-17 实况日志两起）。
 *
 * 根因：`emptyPanelFavorites` 是前 8 条原始收藏（不过滤），而
 * `quicklinkBySiteId` 只含 `quicklinkFromFavorite` 返回非 null 的收藏。
 * 收藏里一旦有站点没有 quicklink 条目，`Map.get()` 返回 undefined，
 * 旧过滤 `.filter((e) => e !== null)` 放过 undefined，随后
 * `chips.map((c) => `!${c.quickPrefix}`)` 在 undefined 上读 quickPrefix，
 * 整页崩溃（TypeError: Cannot read properties of undefined）。
 *
 * 本文件分两层锁住：
 * 1. 行为层：用真实 `quicklinkFromFavorite` 走组件同款建表流程，证明旧
 *    谓词会把 undefined 漏进 chips 并崩溃、新谓词只留有 quicklink 的条目；
 * 2. 源码守卫层：组件里 chips 过滤必须是判空谓词（`!= null`），不许回到
 *    只排 null 的旧写法；提示行文案模板不变。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { quicklinkFromFavorite, type QuicklinkEntry } from "@/lib/quicklinks";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

/** 与 search-palette-actions.test.ts 同款样本：gh 有 quicklink，plain 是普通收藏。 */
const MIXED_FAVORITES = [
  {
    siteId: "gh",
    title: "GitHub",
    href: "https://github.com",
    quickPrefix: "gh",
    templateUrl: "https://github.com/search?q={q}",
  },
  { siteId: "plain", title: "普通收藏", href: "https://example.com" },
];

const ALL_QUICKLINKED = [
  {
    siteId: "gh",
    title: "GitHub",
    href: "https://github.com",
    quickPrefix: "gh",
    templateUrl: "https://github.com/search?q={q}",
  },
  {
    siteId: "so",
    title: "Stack Overflow",
    href: "https://stackoverflow.com",
    quickPrefix: "so",
    templateUrl: "https://stackoverflow.com/search?q={q}",
  },
];

/** 组件 1056–1065 行同款建表：先 quicklinkFromFavorite 再按 siteId 建 Map。 */
function buildQuicklinkBySiteId(favorites: typeof MIXED_FAVORITES) {
  const entries = favorites
    .map((fav) => quicklinkFromFavorite(fav))
    .filter((e): e is QuicklinkEntry => e !== null);
  return new Map(entries.map((e) => [e.siteId, e]));
}

describe("search-palette 空面板 chips：无 quicklink 的收藏不能进 chips", () => {
  it("建表事实：普通收藏不在 quicklinkBySiteId 里，.get() 返回 undefined", () => {
    const bySiteId = buildQuicklinkBySiteId(MIXED_FAVORITES);
    expect(bySiteId.get("gh")?.quickPrefix).toBe("gh");
    expect(bySiteId.has("plain")).toBe(false);
    expect(bySiteId.get("plain")).toBeUndefined();
  });

  it("旧谓词 `!== null` 会把 undefined 漏进 chips，随后读 quickPrefix 崩溃", () => {
    const bySiteId = buildQuicklinkBySiteId(MIXED_FAVORITES);
    const chips = MIXED_FAVORITES.map((fav) => bySiteId.get(fav.siteId)).filter(
      (e): e is QuicklinkEntry => e !== null,
    );
    expect(chips).toHaveLength(2);
    expect(chips[1]).toBeUndefined();
    expect(() => chips.map((c) => `!${c.quickPrefix}`).join(" / ")).toThrow(
      /Cannot read properties of undefined/,
    );
  });

  it("新谓词 `!= null` 只留有 quicklink 的条目，提示行只列 !gh", () => {
    const bySiteId = buildQuicklinkBySiteId(MIXED_FAVORITES);
    const chips = MIXED_FAVORITES.map((fav) => bySiteId.get(fav.siteId)).filter(
      (e): e is QuicklinkEntry => e != null,
    );
    expect(chips.map((c) => c.quickPrefix)).toEqual(["gh"]);
    expect(chips.map((c) => `!${c.quickPrefix}`).join(" / ")).toBe("!gh");
  });

  it("全部收藏都有 quicklink 时行为不变：提示行列出全部前缀", () => {
    const bySiteId = buildQuicklinkBySiteId(ALL_QUICKLINKED);
    const chips = ALL_QUICKLINKED.map((fav) => bySiteId.get(fav.siteId)).filter(
      (e): e is QuicklinkEntry => e != null,
    );
    expect(chips.map((c) => c.quickPrefix)).toEqual(["gh", "so"]);
    expect(chips.map((c) => `!${c.quickPrefix}`).join(" / ")).toBe("!gh / !so");
  });
});

describe("search-palette 源码守卫：chips 过滤必须判空", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  it("chips 过滤不许回到只排 null 的旧写法", () => {
    const chipsBlock = src.slice(src.indexOf("const chips = emptyPanelFavorites"));
    expect(chipsBlock.length).toBeGreaterThan(0);
    expect(chipsBlock).not.toContain(".filter((e): e is QuicklinkEntry => e !== null)");
  });

  it("chips 过滤是判空谓词（`!= null`，与同文件 `if (!ql)` 同口径）", () => {
    const chipsBlock = src.slice(src.indexOf("const chips = emptyPanelFavorites"));
    expect(chipsBlock).toContain("e != null");
  });

  it("提示行文案模板不变：`输入 … <关键词> 直达搜索`", () => {
    expect(src).toContain("直达搜索");
    expect(src).toContain("chips.map((c) => `!${c.quickPrefix}`).join(' / ')");
  });
});
