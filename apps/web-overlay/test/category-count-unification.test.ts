/**
 * 首屏分类计数只有一个平面（改进计划 一「计数口径打架」）。
 *
 * 症状：同一屏里「AI 工具 215」和「AI 工具 332」并排出现——前者是快捷直达轨与
 * 分类区块头按导航树数出来的条目，后者是站内目录带从中枢 `/api/categories/counts`
 * 取的 active 口径。两个数各自都对，但并排就是「数字不可信」。
 *
 * 这里的三条契约：
 *   1. 算式只有一份（countCategorySites），且它数的就是渲染出来的卡片数；
 *   2. 首屏三个出口（快捷直达轨 / 分类区块头 / 目录带）都用这一份；
 *   3. 目录带的中枢计数只保留「链过去会不会 404」的门槛职责，显示数字回退可用。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countCategorySites } from "../src/lib/modular/category-counts";
import { filterNavigationData, processNavigationData } from "../src/lib/data-loader";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 同时支持从 apps/web-overlay/test 与 apps/web/test（镜像副本）运行 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const item = (id: string) => ({ id, title: id, href: "https://example.com/" + id });

/** 一个分类：2 条直接项 + 两个子分类（3 条与 1 条） */
const mixed = {
  id: "reg-ai-tools",
  title: "AI 工具",
  items: [item("a1"), item("a2")],
  subCategories: [
    { id: "s1", title: "子一", items: [item("b1"), item("b2"), item("b3")] },
    { id: "s2", title: "子二", items: [item("c1")] },
  ],
};

describe("countCategorySites：唯一的分类站点数算式", () => {
  const cases: Array<[string, unknown, number]> = [
    ["直接项 + 子分类项", mixed, 6],
    ["只有直接项", { id: "x", items: [item("a")] }, 1],
    ["只有子分类项", { id: "x", subCategories: [{ items: [item("a"), item("b")] }] }, 2],
    ["空分类", { id: "x" }, 0],
    ["子分类没有 items", { id: "x", subCategories: [{ id: "s" }, { id: "t", items: [] }] }, 0],
    ["undefined 分类", undefined, 0],
  ];

  it.each(cases)("%s", (_name, category, expected) => {
    expect(countCategorySites(category as never)).toBe(expected);
  });

  it("与页面渲染的卡片数同口径：停用项被 filterNavigationData 摘掉后，数字一起变小", () => {
    const raw = {
      navigationItems: [
        {
          ...mixed,
          // 停用 1 条直接项与 1 条子分类项：可见卡片 8 → 6
          items: [...mixed.items, { ...item("a3"), enabled: false }],
          subCategories: mixed.subCategories.map((s, i) =>
            i === 0 ? { ...s, items: [...s.items, { ...item("b4"), enabled: false }] } : s,
          ),
        },
        { id: "reg-off", title: "停用分类", enabled: false, items: [item("z")] },
      ],
    };
    const visible = filterNavigationData(processNavigationData(raw as never));

    // 算式的输入必须是「过滤后的树」，否则数字会把看不见的站点也算进去
    expect(countCategorySites(visible.navigationItems[0])).toBe(6);
    expect(visible.navigationItems).toHaveLength(1);
    expect(countCategorySites(visible.navigationItems[0])).toBe(
      (visible.navigationItems[0].items?.length || 0) +
        (visible.navigationItems[0].subCategories?.reduce((acc, s) => acc + (s.items?.length || 0), 0) || 0),
    );
  });
});

describe("首屏三个出口共用同一份算式", () => {
  const quickJump = "src/components/navigation-content.tsx";
  const section = "src/components/navigation-category-section.tsx";

  it("吸顶快捷直达轨的数字来自 countCategorySites", () => {
    expect(overlayFile(quickJump)).toContain("count: countCategorySites(cat)");
    // 旧的内联算式（子分类 reduce）不得再出现在这屏的任何一处
    expect(overlayFile(quickJump)).not.toMatch(/subCategories\?\.reduce/);
  });

  it("分类区块头的 totalCount 来自 countCategorySites", () => {
    expect(overlayFile(section)).toContain("const totalCount = countCategorySites(category)");
    expect(overlayFile(section)).not.toMatch(/const subCount = subCats\.reduce/);
  });

  it("站内目录带显示本页树里的数字，中枢 active 计数只在树里没有该分类时回退", () => {
    const src = overlayFile(quickJump);
    // 目录带已抽成独立组件：映射在页面算，回退逻辑跟着组件走
    const toolbar = overlayFile("src/components/directory-pill-toolbar.tsx");
    expect(src).toContain("[cat.id, countCategorySites(cat)]");
    expect(src).toContain("counts={treeSiteCounts}");
    expect(toolbar).toContain("counts?.get(link.id) ?? link.count");
  });

  it("中枢计数的职责写进注释：它管的是链过去会不会 404，不是「有几张卡片」", () => {
    const src = overlayFile("src/app/page.tsx");
    expect(src).toContain("会不会 404");
    expect(src).toContain("不是「有几张卡片」");
  });
});
