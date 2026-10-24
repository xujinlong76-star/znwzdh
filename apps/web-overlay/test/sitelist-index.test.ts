/**
 * /admin/sitelist 的归属索引与筛选（性能改造 + 语义回归）。
 *
 * 改造前的实测问题：三个 `getSite*` 查找函数各自遍历「分类 × 子分类 × items」，
 * 且每行渲染被调用 4 次。500 站点 / 20 分类 / 每分类 30 项的规模下，单次渲染就是
 * 百万级比较，搜索框每敲一个字符都重算——输入卡顿，而 UI 上看不出任何异常。
 *
 * 本文件锁两件事：
 *   1. **语义等价**（尤其是缺省值）：原查找函数找不到时返回空串，所以
 *      「未归类站点」会被 `none` 子分类筛选命中。这条最容易在抽索引时丢掉。
 *   2. **接线**：页面必须真的用索引，而不是把线性查找留在原地。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildSiteCategoryIndex,
  filterSitesByIndex,
  siteCategoryInfo,
  type SiteCategoryLike,
} from "../src/lib/admin/sitelist-index";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const CATEGORIES: SiteCategoryLike[] = [
  {
    id: "cat-ai",
    title: "AI 工具",
    items: [{ id: "site-root-ai" }],
    subCategories: [
      { id: "sub-chat", title: "对话", items: [{ id: "site-chat" }] },
      { id: "sub-image", title: "绘图", items: [{ id: "site-image" }] },
    ],
  },
  {
    id: "cat-dev",
    title: "开发",
    items: [{ id: "site-dev-root" }],
  },
];

const SITES = [
  { id: "site-root-ai", name: "RootAI", url: "https://root-ai.example.com", description: "挂在主分类" },
  { id: "site-chat", name: "ChatBot", url: "https://chat.example.com", description: "对话工具" },
  { id: "site-image", name: "DrawBot", url: "https://draw.example.com", description: undefined },
  { id: "site-dev-root", name: "DevKit", url: "https://dev.example.com", description: "开发工具" },
  // 完全不属于任何分类
  { id: "site-orphan", name: "Orphan", url: "https://orphan.example.com", description: "未归类" },
];

describe("buildSiteCategoryIndex", () => {
  const index = buildSiteCategoryIndex(CATEGORIES);

  it("主分类 item 归属父分类且子分类为空串", () => {
    expect(index.categoryOf.get("site-root-ai")).toBe("cat-ai");
    expect(index.subCategoryOf.get("site-root-ai")).toBe("");
    expect(siteCategoryInfo(index, "site-root-ai")).toEqual({
      categoryName: "AI 工具",
      subCategoryName: "",
    });
  });

  it("子分类 item 归属父分类并记录子分类名称", () => {
    expect(index.categoryOf.get("site-chat")).toBe("cat-ai");
    expect(index.subCategoryOf.get("site-chat")).toBe("sub-chat");
    expect(siteCategoryInfo(index, "site-chat")).toEqual({
      categoryName: "AI 工具",
      subCategoryName: "对话",
    });
  });

  it("未命中回落空值而不是抛错", () => {
    expect(index.categoryOf.get("nope")).toBeUndefined();
    expect(siteCategoryInfo(index, "nope")).toEqual({ categoryName: "", subCategoryName: "" });
  });

  it("同一站点出现在多处时先出现的胜出（与原「找到就 return」一致）", () => {
    const dup = buildSiteCategoryIndex([
      { id: "cat-a", title: "A", items: [{ id: "dup" }] },
      { id: "cat-b", title: "B", items: [{ id: "dup" }] },
    ]);
    expect(dup.categoryOf.get("dup")).toBe("cat-a");
    expect(siteCategoryInfo(dup, "dup").categoryName).toBe("A");
  });

  it("空分类树得到空索引（不抛错）", () => {
    const empty = buildSiteCategoryIndex([]);
    expect(empty.categoryOf.size).toBe(0);
    expect(empty.infoOf.size).toBe(0);
  });
});

describe("filterSitesByIndex", () => {
  const index = buildSiteCategoryIndex(CATEGORIES);
  const all = { query: "", categoryFilter: "all", subCategoryFilter: "all" };

  it("空条件返回全部（含未归类站点）", () => {
    expect(filterSitesByIndex(SITES, all, index)).toHaveLength(SITES.length);
  });

  it("搜索命中名称 / URL / 描述，大小写不敏感", () => {
    const byName = filterSitesByIndex(SITES, { ...all, query: "chatbot" }, index);
    expect(byName.map((s) => s.id)).toEqual(["site-chat"]);

    const byUrl = filterSitesByIndex(SITES, { ...all, query: "draw.example" }, index);
    expect(byUrl.map((s) => s.id)).toEqual(["site-image"]);

    const byDesc = filterSitesByIndex(SITES, { ...all, query: "未归类" }, index);
    expect(byDesc.map((s) => s.id)).toEqual(["site-orphan"]);
  });

  it("搜索词首尾空格被忽略", () => {
    const hit = filterSitesByIndex(SITES, { ...all, query: "  DevKit  " }, index);
    expect(hit.map((s) => s.id)).toEqual(["site-dev-root"]);
  });

  it("关键词不命中时返回空数组（不是全部）", () => {
    expect(filterSitesByIndex(SITES, { ...all, query: "zzz-not-exist" }, index)).toEqual([]);
  });

  it("分类筛选按父分类归并子分类站点", () => {
    const ai = filterSitesByIndex(SITES, { ...all, categoryFilter: "cat-ai" }, index);
    expect(ai.map((s) => s.id).sort()).toEqual(["site-chat", "site-image", "site-root-ai"].sort());
  });

  it("子分类筛选精确匹配", () => {
    const chat = filterSitesByIndex(SITES, { ...all, subCategoryFilter: "sub-chat" }, index);
    expect(chat.map((s) => s.id)).toEqual(["site-chat"]);
  });

  it("`none` 命中「挂在主分类下」与「完全未归类」两类（原实现缺省为空串的等价语义）", () => {
    const none = filterSitesByIndex(SITES, { ...all, subCategoryFilter: "none" }, index);
    expect(none.map((s) => s.id).sort()).toEqual(["site-dev-root", "site-orphan", "site-root-ai"].sort());
  });

  it("多条件叠加是 AND", () => {
    const hit = filterSitesByIndex(
      SITES,
      { query: "bot", categoryFilter: "cat-ai", subCategoryFilter: "sub-image" },
      index,
    );
    expect(hit.map((s) => s.id)).toEqual(["site-image"]);
  });
});

describe("/admin/sitelist 接线（防止退回线性查找）", () => {
  it("页面用索引与纯函数筛选，且不再保留按站点遍历分类的循环", () => {
    const source = overlaySource("src/app/admin/sitelist/page.tsx");
    expect(source).toContain("buildSiteCategoryIndex");
    expect(source).toContain("filterSitesByIndex");
    expect(source).toContain("siteCategoryInfo");
    // 旧实现的特征：在 getSite* 里 for...of + some()。抽索引后不应再出现
    expect(source).not.toMatch(/const getSiteCategory = \(siteId: string\): string => \{\s*for \(const category of navigationData\)/);
    expect(source).not.toMatch(/const getSiteSubCategory = \(siteId: string\): string => \{\s*for \(const category of navigationData\)/);
  });
});
