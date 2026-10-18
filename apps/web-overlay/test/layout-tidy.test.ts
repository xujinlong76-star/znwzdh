/**
 * 「算法智能自愈整理」的决策逻辑（P1-2 拆分）。
 *
 * 这段算法原来内联在 1307 行的工具栏里，动的是用户眼前的整个排版：
 * 误隐藏一个分类，用户就「丢了」一个分类；误开自适应排序，
 * 站点顺序会悄悄变。抽成纯函数后把语义锁在这里：
 *
 *   - 空分类（直接项 + 二级项都为 0）且未隐藏 → 进隐藏清单；
 *   - 站点数 > 25 且未折叠 → 进折叠清单；
 *   - 自适应排序未开 → 开启，并计入改动数；
 *   - 已在隐藏 / 已折叠 / 已开启的**不重复操作**（幂等）。
 */
import { describe, expect, it } from "vitest";

import { computeLayoutTidyPlan, TIDY_COLLAPSE_THRESHOLD, type TidyCategory } from "../src/lib/modular/layout-tidy";

const cat = (id: string, items: unknown[] = [], subs: Array<{ items: unknown[] }> = []): TidyCategory => ({
  id,
  items,
  subCategories: subs,
});

const BASE = { hiddenCategoryIds: [] as string[], collapsedCategoryIds: [] as string[], isAdaptiveRankingEnabled: true };

describe("computeLayoutTidyPlan", () => {
  it("空分类（含只有空二级分类的）被隐藏", () => {
    const plan = computeLayoutTidyPlan(
      [cat("empty"), cat("onlyEmptySubs", [], [{ items: [] }, { items: [] }]), cat("hasItems", [{ id: "a" }])],
      BASE,
    );
    expect(plan.toHide).toEqual(["empty", "onlyEmptySubs"]);
    expect(plan.toCollapse).toEqual([]);
  });

  it("超过 25 个站点的分类被折叠，边界值不折", () => {
    const big = Array.from({ length: TIDY_COLLAPSE_THRESHOLD + 1 }, (_, i) => ({ id: `s${i}` }));
    const atLimit = Array.from({ length: TIDY_COLLAPSE_THRESHOLD }, (_, i) => ({ id: `s${i}` }));
    const plan = computeLayoutTidyPlan([cat("big", big), cat("limit", atLimit)], BASE);
    expect(plan.toCollapse).toEqual(["big"]);
  });

  it("二级分类的站点数计入总数（直接项+二级项）", () => {
    const plan = computeLayoutTidyPlan(
      [cat("mixed", [{ id: "a" }], [{ items: Array.from({ length: 30 }, (_, i) => ({ id: `x${i}` })) }])],
      BASE,
    );
    expect(plan.toCollapse).toEqual(["mixed"]);
    expect(plan.toHide).toEqual([]);
  });

  it("已隐藏 / 已折叠的不重复操作（幂等）", () => {
    const plan = computeLayoutTidyPlan(
      [cat("empty"), cat("big", Array.from({ length: 30 }, (_, i) => ({ id: `s${i}` })))],
      { hiddenCategoryIds: ["empty"], collapsedCategoryIds: ["big"], isAdaptiveRankingEnabled: true },
    );
    expect(plan.toHide).toEqual([]);
    expect(plan.toCollapse).toEqual([]);
    expect(plan.changeCount).toBe(0);
  });

  it("自适应排序未开时开启并计入改动数", () => {
    const plan = computeLayoutTidyPlan([cat("ok", [{ id: "a" }])], { ...BASE, isAdaptiveRankingEnabled: false });
    expect(plan.enableAdaptiveRanking).toBe(true);
    expect(plan.changeCount).toBe(1);
  });

  it("已开自适应排序时不重复开启", () => {
    const plan = computeLayoutTidyPlan([], { ...BASE, isAdaptiveRankingEnabled: true });
    expect(plan.enableAdaptiveRanking).toBe(false);
    expect(plan.changeCount).toBe(0);
  });

  it("changeCount = 隐藏数 + 折叠数 + (开排序?1:0)", () => {
    const plan = computeLayoutTidyPlan(
      [cat("e1"), cat("e2"), cat("big", Array.from({ length: 30 }, (_, i) => ({ id: `s${i}` })))],
      { ...BASE, isAdaptiveRankingEnabled: false },
    );
    expect(plan.changeCount).toBe(2 + 1 + 1);
  });

  it("空输入不抛错，全零计划", () => {
    const plan = computeLayoutTidyPlan([], BASE);
    expect(plan).toEqual({ toHide: [], toCollapse: [], enableAdaptiveRanking: false, changeCount: 0 });
  });
});
