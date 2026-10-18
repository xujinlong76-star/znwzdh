/**
 * 首页分类管线（P1-2 组件拆分后的纯函数）。
 *
 * 背景：`components/navigation-content.tsx` 曾把「工作台过滤 → 自建分类转换
 * → 归类重映射 → 隐藏过滤 → 排序」近 200 行逻辑内联在一个 1225 行的组件里，
 * 无法在无 DOM 环境下验证。拆出两个纯模块 + 一个 hook 后，这里锁行为：
 *
 *   - `lib/modular/workspace-matching.ts`：工作台该显示哪些站点
 *   - `lib/modular/category-combine.ts`：分类合并 / 重映射 / 隐藏 / 排序
 *
 * 重点覆盖容易写错的两处：
 *   1. 跨分类归类重映射是**双阶段** map（先摘下、再并回），单阶段会漏项；
 *   2. 置顶分类优先于手工排序，手工排序优先原序。
 */
import { describe, expect, it } from "vitest";

import {
  combineAndSortCategories,
  customCategoriesToNavigation,
  type CategoryNode,
} from "../src/lib/modular/category-combine";
import {
  filterNavigationByWorkspace,
  matchesWorkspace,
  type WorkspaceMatchable,
} from "../src/lib/modular/workspace-matching";

const item = (id: string, title: string, extra: Partial<WorkspaceMatchable> = {}) => ({
  id,
  title,
  href: `https://example.com/${id}`,
  ...extra,
});

describe("workspace-matching：场景工作台过滤", () => {
  const tree = [
    {
      id: "cat-a",
      title: "开发",
      items: [
        item("gh", "GitHub", { tags: ["代码托管"] }),
        item("wp", "壁纸站", { description: "高清图片素材" }),
        item("copilot", "AI 编程助手", { tags: ["智能"] }),
      ],
      subCategories: [
        {
          id: "sub-1",
          title: "子分类",
          items: [
            item("docker", "Docker 文档", { tags: ["容器"] }),
            item("noise", "无关站点"),
          ],
        },
      ],
    },
    {
      id: "cat-b",
      title: "全不匹配",
      items: [item("x", "无关站点")],
      subCategories: [],
    },
  ];

  it("'all' 原样返回（同一引用，不产生无意义拷贝）", () => {
    expect(filterNavigationByWorkspace(tree, "all")).toBe(tree);
  });

  it("关键词命中标题/描述/标签，未命中的项被移除", () => {
    const result = filterNavigationByWorkspace(tree, "dev");
    const ids = result[0]!.items.map((i) => i.id);
    expect(ids).toEqual(["gh"]); // 「壁纸站」「AI 助手」不属于 dev
    expect(result[0]!.subCategories[0]!.items.map((i) => i.id)).toEqual(["docker"]);
  });

  it("二级分类过滤后为空时整块移除；一级分类全空时整条移除", () => {
    const result = filterNavigationByWorkspace(tree, "ai");
    expect(result.map((c) => c.id)).toEqual(["cat-a"]); // cat-b 整条移除
    expect(result[0]!.items.map((i) => i.id)).toEqual(["copilot"]);
    expect(result[0]!.subCategories).toHaveLength(0); // 子分类过滤后为空
    // 原树不被修改（纯函数）
    expect(tree[1]!.items).toHaveLength(1);
  });

  it("站点显式声明 workspaces 时优先于关键词", () => {
    const odd = [item("misc", "随便起的名字", { workspaces: ["ai"] })];
    expect(matchesWorkspace(odd[0]!, "ai")).toBe(true);
    expect(matchesWorkspace(odd[0]!, "dev")).toBe(false);
  });
});

describe("category-combine：合并 / 重映射 / 隐藏 / 排序", () => {
  it("customCategoriesToNavigation 保留 icon 与 items，并标记 isCustom", () => {
    const out = customCategoriesToNavigation([
      {
        id: "c1",
        title: "我的分类",
        icon: "star",
        items: [{ id: "i1", title: "站点", href: "https://a.com", description: "d", icon: "globe" }],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.isCustom).toBe(true);
    expect(out[0]!.items[0]).toMatchObject({ id: "i1", href: "https://a.com", icon: "globe" });
    expect(out[0]!.subCategories).toEqual([]);
  });

  it("合并自建 + 上游，产出全量 id 与标题映射", () => {
    const view = combineAndSortCategories({
      custom: [{ id: "c1", title: "自建", items: [], subCategories: [] }],
      navigation: [{ id: "n1", title: "上游", items: [], subCategories: [] }],
    });
    expect(view.allCategoryIds).toEqual(["c1", "n1"]);
    expect(view.categoryTitleMap).toEqual({ c1: "自建", n1: "上游" });
    expect(view.sortedCategories.map((c) => c.id)).toEqual(["c1", "n1"]);
  });

  it("归类重映射：跨分类移动是双阶段的，目标在后面也能收到", () => {
    const view = combineAndSortCategories({
      custom: [],
      navigation: [
        { id: "src", title: "来源", items: [item("a", "A"), item("b", "B")], subCategories: [] },
        { id: "dst", title: "目标", items: [item("z", "Z")], subCategories: [] },
      ],
      siteCategoryOverrides: { a: "dst" },
    });
    const src = view.sortedCategories.find((c) => c.id === "src")!;
    const dst = view.sortedCategories.find((c) => c.id === "dst")!;
    expect(src.items.map((i) => (i as { id: string }).id)).toEqual(["b"]); // 被摘走
    expect(dst.items.map((i) => (i as { id: string }).id)).toEqual(["z", "a"]); // 收到
  });

  it("重映射指向不存在的分类时静默丢弃（不会抛错、不会凭空造分类）", () => {
    const view = combineAndSortCategories({
      custom: [],
      navigation: [{ id: "src", title: "来源", items: [item("a", "A")], subCategories: [] }],
      siteCategoryOverrides: { a: "ghost" },
    });
    expect(view.sortedCategories.map((c) => c.id)).toEqual(["src"]);
    expect(view.sortedCategories[0]!.items).toHaveLength(0);
  });

  it("隐藏分类不进入渲染列表，但仍留在全量 id 与标题映射里", () => {
    const view = combineAndSortCategories({
      custom: [],
      navigation: [
        { id: "n1", title: "一", items: [], subCategories: [] },
        { id: "n2", title: "二", items: [], subCategories: [] },
      ],
      hiddenCategoryIds: ["n2"],
    });
    expect(view.sortedCategories.map((c) => c.id)).toEqual(["n1"]);
    expect(view.allCategoryIds).toEqual(["n1", "n2"]);
    expect(view.categoryTitleMap.n2).toBe("二");
  });

  it("置顶分类优先于手工排序；手工排序内保持 index 顺序；未提及的按原序垫后", () => {
    const base: CategoryNode[] = ["a", "b", "c", "d"].map((id) => ({
      id,
      title: id.toUpperCase(),
      items: [],
      subCategories: [],
    }));
    const view = combineAndSortCategories({
      custom: [],
      navigation: base,
      pinnedCategoryIds: ["d"],
      categoryOrder: ["c", "b"],
    });
    expect(view.sortedCategories.map((c) => c.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("副作用隔离：不改传入数组", () => {
    const nav: CategoryNode[] = [
      { id: "n1", title: "一", items: [item("a", "A")], subCategories: [] },
    ];
    const snapshot = JSON.stringify(nav);
    combineAndSortCategories({
      custom: [],
      navigation: nav,
      hiddenCategoryIds: ["n1"],
      pinnedCategoryIds: ["n1"],
    });
    expect(JSON.stringify(nav)).toBe(snapshot);
  });
});
