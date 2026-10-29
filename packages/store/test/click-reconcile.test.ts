/**
 * 点击证据 ↔ visit_count 对账的纯汇总函数（D4）。
 *
 * 这里只锁「怎么算」：读数的口径与排序、边界（负数/缺失值当 0）、上限。
 * 真实库的取数在 scripts/click-reconcile.mjs，只读；本测试不碰数据库。
 */
import { describe, expect, it } from "vitest";

import {
  CLICK_RECONCILE_TOP_GAPS,
  summarizeClickReconcile,
  type ClickReconcileSiteInput,
} from "../src/click-reconcile.ts";

function site(partial: Partial<ClickReconcileSiteInput> & { siteId: string }): ClickReconcileSiteInput {
  return { title: null, visitCount: 0, clickEvents: 0, ...partial };
}

describe("summarizeClickReconcile", () => {
  it("空输入给出全零，且没有差值行", () => {
    const summary = summarizeClickReconcile([]);
    expect(summary).toMatchObject({
      sitesScanned: 0,
      totalVisitCount: 0,
      totalClickEvents: 0,
      sitesWithVisitCount: 0,
      sitesWithClickEvidence: 0,
      visitedWithoutEvidence: 0,
      clicksWithoutVisitCount: 0,
      mismatchedBothSides: 0,
      topGaps: [],
      delivery: [],
    });
  });

  it("把两侧不一致分成三类：有计数无证据 / 有证据无计数 / 两侧都有但不等", () => {
    const summary = summarizeClickReconcile([
      site({ siteId: "a", visitCount: 3 }),
      site({ siteId: "b", clickEvents: 2 }),
      site({ siteId: "c", visitCount: 5, clickEvents: 4 }),
      site({ siteId: "d", visitCount: 1, clickEvents: 1 }),
      site({ siteId: "e" }),
    ]);
    expect(summary.visitedWithoutEvidence).toBe(1);
    expect(summary.clicksWithoutVisitCount).toBe(1);
    expect(summary.mismatchedBothSides).toBe(1);
    expect(summary.totalVisitCount).toBe(9);
    expect(summary.totalClickEvents).toBe(7);
    expect(summary.sitesWithVisitCount).toBe(3);
    expect(summary.sitesWithClickEvidence).toBe(3);
    expect(summary.topGaps.map((g) => g.siteId)).toEqual(["a", "b", "c"]);
    expect(summary.topGaps.map((g) => g.gap)).toEqual([3, -2, 1]);
  });

  it("topGaps 按 |gap| 倒序，平手时 visit_count 大的在前", () => {
    const summary = summarizeClickReconcile([
      site({ siteId: "small", visitCount: 1, clickEvents: 0 }),
      site({ siteId: "big", visitCount: 9, clickEvents: 0 }),
      site({ siteId: "mid", visitCount: 5, clickEvents: 10 }),
      site({ siteId: "tie-low", visitCount: 2, clickEvents: 5 }),
      site({ siteId: "tie-high", visitCount: 8, clickEvents: 5 }),
    ]);
    expect(summary.topGaps.map((g) => g.siteId)).toEqual(["big", "mid", "tie-high", "tie-low", "small"]);
  });

  it("缺失/负数按 0 处理：计数列不是从负数长出来的", () => {
    const summary = summarizeClickReconcile([
      site({ siteId: "neg", visitCount: -5, clickEvents: Number.NaN }),
      site({ siteId: "nan", visitCount: Number.POSITIVE_INFINITY }),
    ]);
    expect(summary.totalVisitCount).toBe(0);
    expect(summary.totalClickEvents).toBe(0);
    expect(summary.topGaps).toEqual([]);
  });

  it("topGaps 有上限（默认 20，最大 200）", () => {
    const many = Array.from({ length: 30 }, (_, i) => site({ siteId: `s-${i}`, visitCount: i + 1 }));
    expect(summarizeClickReconcile(many).topGaps).toHaveLength(CLICK_RECONCILE_TOP_GAPS);
    expect(summarizeClickReconcile(many, [], 500).topGaps).toHaveLength(30);
    expect(summarizeClickReconcile(many, [], 0).topGaps).toHaveLength(CLICK_RECONCILE_TOP_GAPS);
  });

  it("投递漏斗按次数倒序，丢掉零行的桶（GROUP BY 不会产出，但输入不受信）", () => {
    const summary = summarizeClickReconcile(
      [],
      [
        { outcome: "failed", code: "enqueued", count: 2 },
        { outcome: "success", code: "drained", count: 5 },
        { outcome: "deleted", code: "consent_off", count: 0 },
      ],
    );
    expect(summary.delivery).toEqual([
      { outcome: "success", code: "drained", count: 5 },
      { outcome: "failed", code: "enqueued", count: 2 },
    ]);
  });
});
