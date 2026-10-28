import { describe, expect, it } from "vitest";
import { hasImpl, planGates } from "./prepush-gates.mjs";

/**
 * pre-push 门禁的**决策**（跑还是跳过），不是它调用的那几个检查。
 *
 * 这层值得单测，因为多会话并行下「跳过」是常态且必须说清楚理由：
 * 把跳过做成静默，等于让门禁看起来通过却没跑；把跳过做成失败，
 * 又会用别人的半成品挡住我的推送。
 *
 * 后两枚（客户端模块图、core 镜像）是特意做成「不受 dirty 影响」的：它们读 HEAD 的提交内容，
 * 也就是正要推出去的东西，别人的未提交改动根本进不了它们的视野。
 * core 镜像这枚尤其不能按工作区判——2026-10-28 它就是「工作区绿、HEAD 红」的形态。
 */
const REF_GATES = ["client-node-imports", "core-mirrors"];

describe("planGates：干净就查，脏就跳过并说明", () => {
  it("工作区干净时四枚闸门都跑", () => {
    const plan = planGates({ contractDirty: false, scopeDirty: false });
    expect(plan.map((gate) => [gate.id, gate.run])).toEqual([
      ["rest-contracts", true],
      ["scope-explicit", true],
      ["client-node-imports", true],
      ["core-mirrors", true],
    ]);
    expect(plan.every((gate) => gate.skipReason === "")).toBe(true);
  });

  it("相关路径有未提交改动时跳过，并给出原因与兜底", () => {
    const plan = planGates({ contractDirty: true, scopeDirty: true });
    for (const gate of plan) {
      if (REF_GATES.includes(gate.id)) continue;
      expect(gate.run).toBe(false);
      expect(gate.skipReason).toContain("有未提交改动");
      expect(gate.skipReason).toContain("与本次推送无关");
    }
    expect(plan[0]!.skipReason).toContain("rest-contracts.generated.ts");
    expect(plan[1]!.skipReason).toContain("apps/api/src");
  });

  it("两枚闸门互不牵连：一边脏不影响另一边", () => {
    const plan = planGates({ contractDirty: true, scopeDirty: false });
    expect(plan.find((gate) => gate.id === "rest-contracts")!.run).toBe(false);
    expect(plan.find((gate) => gate.id === "scope-explicit")!.run).toBe(true);
  });

  it("读 HEAD 的闸门无条件跑：前两道再脏也不能把它们带成静默跳过", () => {
    const plan = planGates({ contractDirty: true, scopeDirty: true });
    for (const id of REF_GATES) {
      const gate = plan.find((g) => g.id === id)!;
      expect(gate.run).toBe(true);
      expect(gate.skipReason).toBe("");
    }
  });

  it("默认参数是「干净」：不传也按跑处理（调用方漏传不会静默跳过）", () => {
    expect(planGates().every((gate) => gate.run)).toBe(true);
  });

  it("计划里的每枚闸门都有执行体和修复提示（漏一个就是闸门自己崩在推送现场）", () => {
    for (const gate of planGates()) {
      expect([gate.id, hasImpl(gate.id)]).toEqual([gate.id, true]);
    }
  });

  it("每枚闸门都有中文标题：钩子输出靠它定位是哪道闸拦的", () => {
    for (const gate of planGates()) {
      expect(gate.title.length).toBeGreaterThan(3);
    }
  });
});
