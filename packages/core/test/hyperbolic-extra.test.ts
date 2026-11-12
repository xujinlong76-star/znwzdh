/**
 * hyperbolic.ts 补充覆盖：欧氏内积、莫比乌斯加法、指数/对数映射、
 * 庞加莱距离边界、洛伦兹模型互转与平替打分。
 * （此前 hyperbolic-projection.test.ts 只覆盖了 projectEmbeddingToBall
 *  与 poincareDistance 的主干。）
 */
import { describe, expect, it } from "vitest";
import {
  clampToBall,
  computeHyperbolicAlternativeScore,
  euclideanDot,
  euclideanNorm,
  expMap0,
  findTopAlternativesInHyperbolicSpace,
  logMap0,
  lorentzDistance,
  lorentzInnerProduct,
  lorentzToPoincare,
  mobiusAdd,
  poincareDistance,
  poincareToLorentz,
} from "../src/hyperbolic.ts";

describe("euclideanDot", () => {
  it("标准内积；长度不一时缺失维按 0 计", () => {
    expect(euclideanDot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(euclideanDot([1, 2], [3])).toBe(3);
    expect(euclideanDot([], [])).toBe(0);
    expect(euclideanDot([0, 0], [9, 9])).toBe(0);
  });
});

describe("mobiusAdd", () => {
  it("零元：u⊕0 = u，0⊕v = v", () => {
    expect(mobiusAdd([0.5, 0], [0, 0])).toEqual([0.5, 0]);
    expect(mobiusAdd([0, 0], [0.3, 0.4])).toEqual([0.3, 0.4]);
  });

  it("结果始终落在球内；维度不一致抛错", () => {
    const out = mobiusAdd([0.9, 0], [0.9, 0]);
    expect(euclideanNorm(out)).toBeLessThan(1);
    expect(mobiusAdd([0.2, 0.1], [0.2, 0.1])[0]).toBeGreaterThan(0.2);
    expect(() => mobiusAdd([0.1], [0.1, 0.2])).toThrow("维度不一致");
  });
});

describe("expMap0 / logMap0", () => {
  it("零向量映射为零向量；exp 与 log 互逆", () => {
    expect(expMap0([0, 0])).toEqual([0, 0]);
    expect(logMap0([0, 0])).toEqual([0, 0]);
    const v = [0.3, -0.2];
    const roundTripped = logMap0(expMap0(v));
    expect(roundTripped[0]).toBeCloseTo(v[0], 5);
    expect(roundTripped[1]).toBeCloseTo(v[1], 5);
  });

  it("expMap0 输出模长为 tanh(‖v‖)，落在球内", () => {
    const out = expMap0([1, 0]);
    expect(euclideanNorm(out)).toBeCloseTo(Math.tanh(1), 5);
  });
});

describe("poincareDistance", () => {
  it("同点距离 0；维度不一致抛错", () => {
    expect(poincareDistance([0.1, 0.2], [0.1, 0.2])).toBe(0);
    expect(poincareDistance([0, 0], [0.5, 0])).toBeGreaterThan(0);
    expect(() => poincareDistance([0.1], [0.1, 0.2])).toThrow("维度不一致");
  });
});

describe("computeHyperbolicAlternativeScore / findTopAlternativesInHyperbolicSpace", () => {
  it("同点得满分 1；越远分越低；模长差异拉低分数", () => {
    expect(computeHyperbolicAlternativeScore([0.3, 0.2], [0.3, 0.2])).toBe(1);
    const near = computeHyperbolicAlternativeScore([0.3, 0.2], [0.31, 0.21]);
    const far = computeHyperbolicAlternativeScore([0.3, 0.2], [0.9, 0.0]);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(1);
    // 模长差异大的候选即使方向相近也会被惩罚
    const sameDir = computeHyperbolicAlternativeScore([0.1, 0], [0.9, 0]);
    expect(sameDir).toBeLessThan(near);
    // 自定义 sigma/beta 生效
    expect(
      computeHyperbolicAlternativeScore([0.3, 0.2], [0.9, 0], { sigma: 10, beta: 0.5 }),
    ).toBeGreaterThan(far);
  });

  it("Top-K：排除自身、按分数降序、limit 截断", () => {
    const query = { id: "q", name: "Query", embedding: [0.3, 0.2] };
    const candidates = [
      { id: "a", name: "A", embedding: [0.31, 0.21] },
      { id: "q", name: "QuerySelf", embedding: [0.3, 0.2] },
      { id: "b", name: "B", embedding: [0.9, 0.0] },
      { id: "c", name: "C", embedding: [0.32, 0.19] },
    ];
    const top = findTopAlternativesInHyperbolicSpace(query, candidates, 2);
    expect(top).toHaveLength(2);
    expect(top.map((t) => t.targetId)).not.toContain("q");
    expect(top[0]!.alternativeScore).toBeGreaterThanOrEqual(top[1]!.alternativeScore);
    expect(top[0]!.geodesicDistance).toBeGreaterThanOrEqual(0);
    const all = findTopAlternativesInHyperbolicSpace(query, candidates);
    expect(all).toHaveLength(3);
  });
});

describe("洛伦兹模型", () => {
  it("lorentzInnerProduct：时间分量取负；空向量与维度不一致抛错", () => {
    // u=(1,0), v=(1,0)：-<1*1> + 0 = -1
    expect(lorentzInnerProduct([1, 0], [1, 0])).toBe(-1);
    expect(lorentzInnerProduct([2, 1], [2, 1])).toBe(-3);
    expect(() => lorentzInnerProduct([], [])).toThrow("空向量");
    expect(() => lorentzInnerProduct([1], [1, 2])).toThrow("维度不一致");
  });

  it("lorentzDistance：同点为 0（arcosh 下限保护）", () => {
    expect(lorentzDistance([1, 0], [1, 0])).toBe(0);
    expect(lorentzDistance([2, 1], [1, 0])).toBeGreaterThan(0);
  });

  it("poincareToLorentz / lorentzToPoincare 互逆；原点映射为 (1, 0, …)", () => {
    expect(poincareToLorentz([0, 0])).toEqual([1, 0, 0]);
    const p = [0.3, 0.4];
    const back = lorentzToPoincare(poincareToLorentz(p));
    expect(back[0]).toBeCloseTo(p[0], 5);
    expect(back[1]).toBeCloseTo(p[1], 5);
    expect(() => lorentzToPoincare([1])).toThrow("输入维度非法");
    expect(clampToBall([2, 0])[0]).toBeLessThan(1);
  });
});
