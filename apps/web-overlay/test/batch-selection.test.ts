/**
 * 卡片多选 + 批量操作：把「写好了但从没挂上」的能力真正交到用户手里。
 *
 * 真实缺陷（改动前）：
 *   - `components/batch-operation-dock.tsx`（底部批量操作坞）**全仓无人渲染**；
 *   - `lib/batch-operations.ts`（导出 Markdown / OneTab、批量置顶 / 移动 / 删除）
 *     连同它的 5 个纯函数**一个测试都没有**；
 *   - 于是「一次处理多个站点」的需求没有任何入口 —— 用户只能一个一个点。
 *
 * 这里锁三件事：
 *   1. `lib/selection.ts` 的选中语义（去重、可取消、全选、剪枝、顺序）；
 *   2. `lib/batch-operations.ts` 既有纯函数的行为（既然要上界面，就必须有测试）；
 *   3. 接线：卡片能进入「选中」而不导航、操作坞真的被渲染、导出只包含可见项。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  batchDeleteSitesFromCustomCategories,
  batchExportSitesToMarkdown,
  batchExportSitesToOneTab,
  batchMoveSitesBetweenCustomCategories,
  batchSetPinnedSitesInCategory,
  type BatchSiteItem,
} from "../src/lib/batch-operations";
import {
  clearSelected,
  isSelected,
  pickSelectedSites,
  pruneSelected,
  selectAllIds,
  summarizeSelection,
  toggleSelected,
} from "../src/lib/selection";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

function countOccurrences(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

const A: BatchSiteItem = { id: "a", title: "甲", href: "https://a.example.com" };
const B: BatchSiteItem = { id: "b", title: "乙", href: "https://b.example.com", description: "描述" };
const C: BatchSiteItem = { id: "c", title: "丙", href: "https://c.example.com" };

describe("selection：选中集合怎么变", () => {
  it("点击同一张卡片第二次 = 取消选中，且永不重复", () => {
    let ids = toggleSelected([], "a");
    expect(ids).toEqual(["a"]);
    ids = toggleSelected(ids, "a");
    expect(ids).toEqual([]);
    ids = toggleSelected(toggleSelected(toggleSelected([], "a"), "a"), "a");
    expect(ids).toEqual(["a"]);
    expect(isSelected(ids, "a")).toBe(true);
    expect(isSelected(ids, "b")).toBe(false);
  });

  it("空 id 不进入选中集合（避免出现「已选 1」却什么都操作不了的幽灵项）", () => {
    expect(toggleSelected(["a"], "")).toEqual(["a"]);
  });

  it("全选去重、忽略空 id、保持传入顺序", () => {
    expect(selectAllIds(["a", "b", "a", "", "c", "b"])).toEqual(["a", "b", "c"]);
    expect(selectAllIds([])).toEqual([]);
  });

  it("清空就是清空", () => {
    expect(clearSelected()).toEqual([]);
  });

  it("剪枝：筛选 / 折叠后只保留仍然可见的选中项", () => {
    expect(pruneSelected(["a", "b", "c"], ["b", "c", "d"])).toEqual(["b", "c"]);
    expect(pruneSelected(["a"], [])).toEqual([]);
    expect(pruneSelected([], ["a"])).toEqual([]);
  });

  it("摘要：始终让用户知道自己选了多大规模", () => {
    expect(summarizeSelection([], 20)).toBe("未选择任何站点");
    expect(summarizeSelection(["a", "b"], 20)).toBe("已选 2 / 共 20 个站点");
    expect(summarizeSelection(["a"], 0)).toBe("已选 1 个站点");
    expect(summarizeSelection(["a", "", "b"], Number.NaN)).toBe("已选 2 个站点");
  });

  it("取数据按「用户选择的先后顺序」，并跳过已经不存在的 id", () => {
    expect(pickSelectedSites(["c", "a"], [A, B, C]).map((s) => s.id)).toEqual(["c", "a"]);
    expect(pickSelectedSites(["a", "gone"], [A, B]).map((s) => s.id)).toEqual(["a"]);
    expect(pickSelectedSites([], [A])).toEqual([]);
  });
});

describe("batch-operations：导出格式必须能被工具直接吃下", () => {
  it("Markdown 导出：标题 + 每条一个链接，描述里的换行不能破坏列表", () => {
    const md = batchExportSitesToMarkdown(
      [A, { ...B, description: "第一行\n第二行" }],
      { categoryTitle: "我的收藏" },
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# 我的收藏");
    expect(lines[2]).toBe("- [甲](https://a.example.com)");
    expect(lines[3]).toBe("- [乙](https://b.example.com) - 第一行 第二行");
    expect(lines).toHaveLength(4);
  });

  it("Markdown 导出：默认标题存在（不能出现空标题）", () => {
    expect(batchExportSitesToMarkdown([]).startsWith("# ")).toBe(true);
  });

  it("OneTab 导出：每行 `url | title`，顺序与选中一致", () => {
    expect(batchExportSitesToOneTab([B, A])).toBe("https://b.example.com | 乙\nhttps://a.example.com | 甲");
    expect(batchExportSitesToOneTab([])).toBe("");
  });

  it("批量置顶：pin 只新增、去重；unpin 只移除", () => {
    const pinned = batchSetPinnedSitesInCategory({}, "cat", ["a", "b", "a"], "pin");
    expect(pinned.cat).toEqual(["a", "b"]);
    const again = batchSetPinnedSitesInCategory(pinned, "cat", ["b", "c"], "pin");
    expect(again.cat).toEqual(["a", "b", "c"]);
    const unpinned = batchSetPinnedSitesInCategory(again, "cat", ["a", "c"], "unpin");
    expect(unpinned.cat).toEqual(["b"]);
  });

  it("批量置顶：toggle 在「全已置顶」时取消，否则补上；其他分类不受影响", () => {
    const before = { cat: ["a"], other: ["z"] };
    const on = batchSetPinnedSitesInCategory(before, "cat", ["a", "b"], "toggle");
    expect(on.cat).toEqual(["a", "b"]);
    expect(on.other).toEqual(["z"]);
    const off = batchSetPinnedSitesInCategory(on, "cat", ["a", "b"], "toggle");
    expect(off.cat).toEqual([]);
  });

  it("批量移动：移入目标分类，同名 id / 同链接不重复；无命中时原样返回", () => {
    const cats = [
      { id: "src", title: "源", items: [A, B] },
      { id: "dst", title: "目标", items: [{ ...A }] },
    ];
    const moved = batchMoveSitesBetweenCustomCategories(cats, ["a", "b"], "dst");
    expect(moved.movedCount).toBe(2);
    expect(moved.categories.find((c) => c.id === "src")?.items).toEqual([]);
    // id=a / href=a 已存在（去重），只有 b 被加入
    expect(moved.categories.find((c) => c.id === "dst")?.items.map((i) => i.id)).toEqual(["a", "b"]);

    const untouched = batchMoveSitesBetweenCustomCategories(cats, ["nope"], "dst");
    expect(untouched.movedCount).toBe(0);
    expect(untouched.categories).toBe(cats);
  });

  it("批量删除：只删目标 id 并给出数量，其他分类保持原样", () => {
    const cats = [
      { id: "x", title: "X", items: [A, B, C] },
      { id: "y", title: "Y", items: [{ ...C, id: "c2" }] },
    ];
    const res = batchDeleteSitesFromCustomCategories(cats, ["a", "c"]);
    expect(res.deletedCount).toBe(2);
    expect(res.categories.find((c) => c.id === "x")?.items.map((i) => i.id)).toEqual(["b"]);
    expect(res.categories.find((c) => c.id === "y")?.items).toHaveLength(1);
  });
});

describe("源码守卫：入口真的存在，且默认行为不被改变", () => {
  it("操作坞被真正挂载（回归：组件写好了却全仓无人渲染）", () => {
    const src = overlaySource("src/components/navigation-content.tsx");
    // 2026-10-18：改为 next/dynamic 客户端懒加载（首屏分包 -48 KB），
    // 形态从静态 import 变成 dynamic()，守卫放行两种写法，但必须真的引用组件模块并渲染。
    const referenced =
      src.includes("import { BatchOperationDock } from '@/components/batch-operation-dock'") ||
      src.includes("import('@/components/batch-operation-dock')");
    expect(referenced).toBe(true);
    expect(src).toContain("<BatchOperationDock");
    expect(src).toContain("selectedSites={selectedSites}");
    // 2026-10-18 P1-2：选中态抽到 use-site-selection hook，清除回调即 hook 返回值
    expect(src).toContain("onClearSelection={clearSelection}");
  });

  it("工具栏有多选开关与全选，并把状态传给卡片", () => {
    const toolbar = overlaySource("src/components/navigation-toolbar.tsx");
    const section = overlaySource("src/components/navigation-category-section.tsx");
    const src = overlaySource("src/components/navigation-content.tsx");
    expect(toolbar).toContain("aria-pressed={selectionMode}");
    expect(toolbar).toMatch(/onClick=\{(on)?[Tt]oggleSelectMode\}/);
    expect(src).toContain("onSelectAll={selectAllVisible}");
    // 两个卡片渲染点（一级分类 + 二级分类）都要进入多选
    expect(countOccurrences(section, "selectable={selectionMode}")).toBe(2);
    expect(countOccurrences(section, "onToggleSelect={toggleSelectOne}")).toBe(2);
    // 列表变化后剪枝，避免导出到用户已经看不见的站点
    // （P1-2：剪枝随选中态一起抽进 use-site-selection hook；守卫改查 hook 源 + 消费接线）
    const hook = overlaySource("src/lib/modular/use-site-selection.ts");
    expect(hook).toContain("pruneSelected(prev, visibleSites.map((s) => s.id))");
    expect(src).toContain("useSiteSelection(");
  });

  it("卡片：多选模式下点击不导航，只切换选中；三个显示模式都要一致", () => {
    const src = overlaySource("src/components/navigation-card.tsx");
    expect(src).toContain("selectable?: boolean");
    expect(src).toContain("selected?: boolean");
    expect(src).toContain("onToggleSelect?: (siteId: string) => void");
    expect(src).toContain("if (!selectable) return");
    expect(src).toContain("e.preventDefault()");
    expect(src).toContain("onToggleSelect?.(item.id)");
    // 紧凑 / 标准 / 丰富 三个分支都要挂上（漏一个就会「有的卡片点了没用」）
    expect(countOccurrences(src, "onClick={handleLinkClick}")).toBe(3);
    expect(countOccurrences(src, "data-navhub-site-id={item.id}")).toBe(3);
    expect(countOccurrences(src, "data-navhub-selected={selected ? 'true' : undefined}")).toBe(3);
  });

  it("默认（非多选）模式必须不受影响：没有 selectable 时直接放行", () => {
    const src = overlaySource("src/components/navigation-card.tsx");
    // handleLinkClick 的第一句就是「非多选直接返回」，不能有任何副作用
    const idx = src.indexOf("const handleLinkClick");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 320);
    expect(body).toContain("if (!selectable) return");
    expect(body.indexOf("if (!selectable) return")).toBeLessThan(body.indexOf("preventDefault"));
  });
});
