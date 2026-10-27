/**
 * 体检视图状态机（已在 core，面板与只读健康 API 共用）。
 * 锁四种状态互斥、stale 优先、0 是有效测量值、NaN 归为无数据。
 */
import { describe, expect, it } from "vitest";
import { deriveHealthPanelState } from "../src/health-state.ts";

describe("deriveHealthPanelState", () => {
  it("无快照 = 未体检；stale 优先于任何数值", () => {
    expect(deriveHealthPanelState(null).kind).toBe("untested");
    const stale = deriveHealthPanelState({ stale: true, reachability: 0.99, declared: 200 });
    expect(stale.kind).toBe("stale");
    if (stale.kind === "stale") expect(stale.declared).toBe(200);
  });

  it("reachability 为 null / NaN = 无有效数据（区别于未体检）", () => {
    expect(deriveHealthPanelState({ declared: 120, reachability: null }).kind).toBe("no-data");
    expect(deriveHealthPanelState({ reachability: Number.NaN }).kind).toBe("no-data");
  });

  it("0 是有效测量值，缺省计数补 0", () => {
    const s = deriveHealthPanelState({ reachability: 0, sampled: 10 });
    expect(s.kind).toBe("verified");
    if (s.kind === "verified") {
      expect(s.reachability).toBe(0);
      expect(s.brokenCount).toBe(0);
      expect(s.sampled).toBe(10);
    }
  });
});
