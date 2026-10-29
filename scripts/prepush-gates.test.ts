import { describe, expect, it } from "vitest";
import { hasImpl, pairMirrorDrift, planGates } from "./prepush-gates.mjs";

/**
 * pre-push 门禁的**决策**（跑还是跳过），不是它调用的那几个检查。
 *
 * 这层值得单测，因为多会话并行下「跳过」是常态且必须说清楚理由：
 * 把跳过做成静默，等于让门禁看起来通过却没跑；把跳过做成失败，
 * 又会用别人的半成品挡住我的推送。
 *
 * 后三枚（客户端模块图、core 镜像、测试镜像配对）是特意做成「不受 dirty 影响」的：它们读 HEAD 的提交内容，
 * 也就是正要推出去的东西，别人的未提交改动根本进不了它们的视野。
 * core 镜像这枚尤其不能按工作区判——2026-10-28 它就是「工作区绿、HEAD 红」的形态。
 * 测试镜像配对同因：`10e38d3a`（mobile-nav）与 `d7cf72d6`（sync-health-card）两次「只提交 overlay 侧守卫」
 * 都过了工作区口径的闸，HEAD 上留下两份自相矛盾的守卫副本，而 CI 先跑 vendor-web 把它盖掉了。
 */
const REF_GATES = ["client-node-imports", "core-mirrors", "test-mirror-pairs", "deps-integrity-prepush", "mock-hygiene-prepush"];

describe("planGates：干净就查，脏就跳过并说明", () => {
  it("工作区干净时所有闸门都跑", () => {
    const plan = planGates({ contractDirty: false, scopeDirty: false });
    // 钉**语义**不钉枚数与全量清单：闸门本来就要增（2026-10-29 加两枚时被这条拦下）。
    // 要钉的是「每枚都跑、且都不带跳过理由」，以及两枚脏敏闸门的 id 仍在。
    expect(plan.length).toBeGreaterThanOrEqual(5);
    expect(plan.map((gate) => [gate.id, gate.run])).toContainEqual(["rest-contracts", true]);
    expect(plan.map((gate) => [gate.id, gate.run])).toContainEqual(["scope-explicit", true]);
    expect(plan.every((gate) => gate.run)).toBe(true);
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

/** 造一份 ls-tree 风格的条目清单（sha + path）。 */
const e = (path: string, sha: string) => ({ path, sha });

describe("pairMirrorDrift：只挑「两侧都受跟踪但 committed blob 不等」", () => {
  it("两侧同名同 sha → 不算漂移", () => {
    expect(
      pairMirrorDrift([
        e("apps/web/test/a.test.ts", "1111111"),
        e("apps/web-overlay/test/a.test.ts", "1111111"),
      ]),
    ).toEqual([]);
  });

  it("两侧同名不同 sha → 报出文件名（这就是 HEAD 上自相矛盾的那两份守卫）", () => {
    expect(
      pairMirrorDrift([
        e("apps/web/test/sync-health-card.test.ts", "aaaaaaa"),
        e("apps/web-overlay/test/sync-health-card.test.ts", "bbbbbbb"),
      ]),
    ).toEqual(["sync-health-card.test.ts"]);
  });

  it("只有 overlay 侧（镜像还没建）不报：root vitest 跑不到它，那是覆盖损失不是红灯", () => {
    expect(pairMirrorDrift([e("apps/web-overlay/test/video-doc-read.test.ts", "ccccccc")])).toEqual([]);
  });

  it("只有 web 侧（历史上只在底座里的测试）不报", () => {
    expect(pairMirrorDrift([e("apps/web/test/legacy-only.test.ts", "ddddddd")])).toEqual([]);
  });

  it("多个漂移按名字排序，输出稳定可断言", () => {
    expect(
      pairMirrorDrift([
        e("apps/web/test/zeta.test.ts", "1"),
        e("apps/web-overlay/test/zeta.test.ts", "2"),
        e("apps/web/test/alpha.test.ts", "3"),
        e("apps/web-overlay/test/alpha.test.ts", "4"),
      ]),
    ).toEqual(["alpha.test.ts", "zeta.test.ts"]);
  });

  it("test 目录之外的路径不参与配对（src 侧是 gitignored 底座，不在闸门视野里）", () => {
    expect(
      pairMirrorDrift([
        e("apps/web/src/components/a.tsx", "1"),
        e("apps/web-overlay/src/components/a.tsx", "2"),
        e("apps/api/test/x.test.ts", "3"),
      ]),
    ).toEqual([]);
  });

  it("子目录也按相对名配对，不只顶层", () => {
    expect(
      pairMirrorDrift([
        e("apps/web/test/fixtures/y.test.ts", "1"),
        e("apps/web-overlay/test/fixtures/y.test.ts", "9"),
      ]),
    ).toEqual(["fixtures/y.test.ts"]);
  });

  it("空清单返回空数组（不能因为 every() 的空真值把「什么都没查」当成通过）", () => {
    expect(pairMirrorDrift([])).toEqual([]);
  });
});
