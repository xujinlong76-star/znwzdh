/**
 * 体检面板视图状态机的契约测试。
 *
 * 锁的是「四种状态互斥且覆盖全部输入」——上一轮的缺陷正是一个永远进不去的分支：
 * 外层已经判定 `snap` 为假，内层又判 `snap?.stale`，于是那段文案永远不会出现。
 * 有了单入口推导，这类错误在类型层就写不出来。
 */
import { describe, expect, it } from "vitest";
import { deriveHealthPanelState } from "../src/lib/health-panel-state.ts";

describe("deriveHealthPanelState", () => {
  it("没有快照 = 从未体检", () => {
    expect(deriveHealthPanelState(null).kind).toBe("untested");
    expect(deriveHealthPanelState(undefined).kind).toBe("untested");
  });

  it("stale 优先于任何数值：清单改过之后不展示旧百分比", () => {
    const state = deriveHealthPanelState({
      stale: true,
      declared: 200,
      sampled: 30,
      reachability: 0.97,
      okCount: 29,
      brokenCount: 1,
    });
    expect(state.kind).toBe("stale");
    if (state.kind === "stale") expect(state.declared).toBe(200);
  });

  it("有快照但 reachability 为 null = 无有效数据（不是没测过）", () => {
    const state = deriveHealthPanelState({ declared: 120, sampled: 0, reachability: null });
    expect(state.kind).toBe("no-data");
    if (state.kind === "no-data") expect(state.declared).toBe(120);
  });

  it("reachability 非有限数（NaN/Infinity）同样归为无有效数据", () => {
    expect(deriveHealthPanelState({ reachability: Number.NaN }).kind).toBe("no-data");
    expect(deriveHealthPanelState({ reachability: Number.POSITIVE_INFINITY }).kind).toBe("no-data");
  });

  it("有测量值 = verified，并补齐缺省计数为 0", () => {
    const state = deriveHealthPanelState({ reachability: 0.9, sampled: 30, declared: 200 });
    expect(state.kind).toBe("verified");
    if (state.kind === "verified") {
      expect(state.reachability).toBeCloseTo(0.9);
      expect(state.okCount).toBe(0);
      expect(state.blockedCount).toBe(0);
      expect(state.suspiciousCount).toBe(0);
      expect(state.brokenCount).toBe(0);
      expect(state.sampled).toBe(30);
      expect(state.declared).toBe(200);
    }
  });

  it("0 是一个有效测量值，不能被当成「没有数据」", () => {
    const state = deriveHealthPanelState({ reachability: 0, sampled: 30 });
    expect(state.kind).toBe("verified");
    if (state.kind === "verified") expect(state.reachability).toBe(0);
  });

  it("四种状态互斥：任意输入只会命中一个 kind", () => {
    const inputs = [
      null,
      {},
      { stale: true },
      { stale: false, reachability: null },
      { reachability: 0 },
      { reachability: 1, brokenCount: 3 },
      { stale: true, reachability: 0.5 },
    ];
    for (const input of inputs) {
      const kind = deriveHealthPanelState(input).kind;
      expect(["verified", "stale", "no-data", "untested"]).toContain(kind);
    }
  });
});
