import { describe, expect, it } from "vitest";
import {
  bumpClocks,
  diffChangedSlots,
  mergeLayoutSlots,
  nextLamport,
  slotKey,
  type LayoutSlotClocks,
} from "../src/layout-sync.ts";

/**
 * 回归目标：多标签页同时打开首页时，旧标签页的整表回写不能再抹掉
 * 新标签页的改动。粒度是"插槽"而不是整份 JSON。
 */

type Cfg = Record<string, any>;

const base: Cfg = {
  version: 3,
  viewMode: "hybrid",
  accentColor: "default",
  categoryOrder: ["a", "b"],
  customCategories: [{ id: "c1", title: "一" }],
  pinnedSiteIdsByCategory: { catA: ["s1"] },
  updatedAt: 1000,
};

describe("diffChangedSlots", () => {
  it("只报真正改动的字段，updatedAt 永远不算改动", () => {
    const slots = diffChangedSlots(base, { ...base, updatedAt: 9999 });
    expect(slots).toEqual([]);
  });

  it("标量字段改动 -> 字段级插槽", () => {
    const slots = diffChangedSlots(base, { ...base, accentColor: "violet" });
    expect(slots).toContain("accentColor");
    expect(slots).not.toContain("viewMode");
  });

  it("customCategories 改动 -> 元素级插槽", () => {
    const next = { ...base, customCategories: [{ id: "c1", title: "改名了" }] };
    const slots = diffChangedSlots(base, next);
    expect(slots).toContain(slotKey("customCategories", "c1"));
  });

  it("删除分类也算改动（否则删除事实无法压过对端更旧的留存）", () => {
    const next = { ...base, customCategories: [] };
    const slots = diffChangedSlots(base, next);
    expect(slots).toContain(slotKey("customCategories", "c1"));
  });

  it("pinnedSiteIdsByCategory 按类目粒度上报", () => {
    const next = { ...base, pinnedSiteIdsByCategory: { catA: ["s1"], catB: ["s2"] } };
    const slots = diffChangedSlots(base, next);
    expect(slots).toContain(slotKey("pinnedSiteIdsByCategory", "catB"));
    expect(slots).not.toContain(slotKey("pinnedSiteIdsByCategory", "catA"));
  });
});

describe("bumpClocks / nextLamport", () => {
  it("空时钟从 1 开始", () => {
    expect(nextLamport({})).toBe(1);
  });

  it("取全局最大值 +1，且只推高指定插槽", () => {
    const clocks: LayoutSlotClocks = { a: 5, b: 2 };
    const next = bumpClocks(clocks, ["b"]);
    expect(next.b).toBe(6);
    expect(next.a).toBe(5); // 未涉及的插槽不动
  });

  it("永远不会把已有时钟推低", () => {
    const clocks: LayoutSlotClocks = { a: 100 };
    expect(bumpClocks(clocks, ["a"], 3).a).toBe(100);
  });

  it("不改动入参", () => {
    const clocks: LayoutSlotClocks = { a: 1 };
    bumpClocks(clocks, ["a"]);
    expect(clocks.a).toBe(1);
  });
});

describe("mergeLayoutSlots", () => {
  it("A 改配色、B 改分类顺序：两边改动都保留（整表 LWW 会丢一半）", () => {
    const localClocks = bumpClocks({}, diffChangedSlots(base, { ...base, accentColor: "violet" }), 10);
    const local: Cfg = { ...base, accentColor: "violet" };

    const remoteBase = { ...base, categoryOrder: ["b", "a"] };
    const remoteClocks = bumpClocks({}, diffChangedSlots(base, remoteBase), 20);

    const merged = mergeLayoutSlots(
      { config: local, clocks: localClocks },
      { config: remoteBase, clocks: remoteClocks },
    );

    expect(merged.config.accentColor).toBe("violet"); // 本地赢
    expect(merged.config.categoryOrder).toEqual(["b", "a"]); // 远端赢
    expect(merged.changed).toBe(true);
  });

  it("同一字段：时钟大的一方赢", () => {
    const local = { config: { ...base, viewMode: "classic" }, clocks: { viewMode: 5 } };
    const remote = { config: { ...base, viewMode: "workbench" }, clocks: { viewMode: 9 } };
    const merged = mergeLayoutSlots(local, remote);
    expect(merged.config.viewMode).toBe("workbench");
  });

  it("时钟平局时保留本地（否则两个标签页会无限互推）", () => {
    const local = { config: { ...base, viewMode: "classic" }, clocks: { viewMode: 7 } };
    const remote = { config: { ...base, viewMode: "workbench" }, clocks: { viewMode: 7 } };
    const merged = mergeLayoutSlots(local, remote);
    expect(merged.config.viewMode).toBe("classic");
    expect(merged.changed).toBe(false);
  });

  it("远端新增自定义分类 -> 合入本地，且本地已有分类不被回退", () => {
    const local: Cfg = { ...base, customCategories: [{ id: "c1", title: "本地改名" }] };
    const localClocks = bumpClocks({}, [slotKey("customCategories", "c1")], 30);

    const remote: Cfg = {
      ...base,
      customCategories: [{ id: "c1", title: "一" }, { id: "c2", title: "二" }],
    };
    const remoteClocks = bumpClocks({}, [slotKey("customCategories", "c2")], 40);

    const merged = mergeLayoutSlots({ config: local, clocks: localClocks }, { config: remote, clocks: remoteClocks });
    const byId = new Map(merged.config.customCategories.map((c: any) => [c.id, c.title]));
    expect(byId.get("c1")).toBe("本地改名"); // 本地时钟更旧但元素级时钟更高 -> 保留本地
    expect(byId.get("c1")).not.toBe("一");
    expect(byId.get("c2")).toBe("二"); // 远端新增 -> 合入
  });

  it("远端删除分类（时钟更新）-> 本地也删掉", () => {
    const local: Cfg = { ...base, customCategories: [{ id: "c1", title: "一" }] };
    const localClocks = bumpClocks({}, [slotKey("customCategories", "c1")], 10);

    const remote: Cfg = { ...base, customCategories: [] };
    const remoteClocks = bumpClocks({}, [slotKey("customCategories", "c1")], 50);

    const merged = mergeLayoutSlots({ config: local, clocks: localClocks }, { config: remote, clocks: remoteClocks });
    expect(merged.config.customCategories).toEqual([]);
  });

  it("pinnedSiteIdsByCategory 按类目粒度合并：改 A 类目不影响 B 类目", () => {
    const local: Cfg = { ...base, pinnedSiteIdsByCategory: { catA: ["s1"], catB: ["s9"] } };
    const localClocks = bumpClocks({}, [slotKey("pinnedSiteIdsByCategory", "catB")], 60);

    const remote: Cfg = { ...base, pinnedSiteIdsByCategory: { catA: ["s1", "s2"] } };
    const remoteClocks = bumpClocks({}, [slotKey("pinnedSiteIdsByCategory", "catA")], 70);

    const merged = mergeLayoutSlots({ config: local, clocks: localClocks }, { config: remote, clocks: remoteClocks });
    expect(merged.config.pinnedSiteIdsByCategory.catA).toEqual(["s1", "s2"]); // 远端赢
    expect(merged.config.pinnedSiteIdsByCategory.catB).toEqual(["s9"]); // 本地赢
  });

  it("updatedAt 取两侧较大值", () => {
    const local = { config: { ...base, updatedAt: 100 }, clocks: {} };
    const remote = { config: { ...base, updatedAt: 500 }, clocks: {} };
    expect(mergeLayoutSlots(local, remote).config.updatedAt).toBe(500);
  });

  it("合并可交换：谁当 local 结果一致（同一组时钟下）", () => {
    const aSlots = [slotKey("accentColor")];
    const bSlots = [slotKey("viewMode")];
    const cfgA: Cfg = { ...base, accentColor: "violet" };
    const cfgB: Cfg = { ...base, viewMode: "classic" };

    const m1 = mergeLayoutSlots(
      { config: cfgA, clocks: bumpClocks({}, aSlots, 10) },
      { config: cfgB, clocks: bumpClocks({}, bSlots, 20) },
    );
    const m2 = mergeLayoutSlots(
      { config: cfgB, clocks: bumpClocks({}, bSlots, 20) },
      { config: cfgA, clocks: bumpClocks({}, aSlots, 10) },
    );
    expect(m1.config.accentColor).toBe(m2.config.accentColor);
    expect(m1.config.viewMode).toBe(m2.config.viewMode);
  });
});
