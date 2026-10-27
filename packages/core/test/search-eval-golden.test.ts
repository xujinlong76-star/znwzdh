/**
 * 检索质量闸门：用**生产融合逻辑**重放金标集，指标跌破阈值即红。
 *
 * 为什么不是「再造一套离线评测脚本」：`search-eval.ts` 的指标函数已经是纯函数，
 * 缺的是**输入**——一份可复现的候选快照（各通道召回 + 通道内名次）和人工标注的
 * 相关性等级。这里把两者接起来：`fuse()` 用生产默认权重与 k 重放候选，
 * 再把输出交给 `evaluateSearch()`。于是 RRF 的 k、通道权重、coverage 强度任何
 * 一处改动都会改变排序，进而改变指标——排序回归第一次有了可复现的红灯。
 *
 * 数据来源与维护契约：
 *   - `fixtures/search-eval-golden.json` 的 candidates 是「召回快照」，不是线上实时结果；
 *   - 改 `DEFAULT_WEIGHTS` 或 `DEFAULT_WEIGHTS.k` 必须**同一 PR** 内重录快照并复核阈值，
 *     否则「权重快照一致性」用例会红——这道门故意要求人工签核，不允许悄悄调参；
 *   - 阈值 = 录制值 - 0.01（宏平均），即容忍 1 个百分点的自然抖动，超过就是回归。
 *
 * 为什么不改 CI workflow 加独立 job：金标集测试走现有 vitest 通道即可（CI 的
 * SQLite / PostgreSQL 两个 job 都会跑 packages 下的全部测试），少一个 workflow 改动
 * 就少一处「为过门禁而放宽断言」的入口。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_WEIGHTS, fuse, type FusionWeights } from "../src/fusion.ts";
import {
  evaluateSearch,
  ndcgAtK,
  type SearchEvalCase,
  type SearchEvalMetrics,
} from "../src/search-eval.ts";
import type { SearchCandidate } from "../src/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

interface GoldenCase {
  query: string;
  relevance: Record<string, number>;
  candidates: SearchCandidate[];
}

interface GoldenFixture {
  version: number;
  k: number;
  weights: FusionWeights;
  thresholds: Pick<SearchEvalMetrics, "ndcgAtK" | "mrrAtK" | "recallAtK">;
  cases: GoldenCase[];
}

const FIXTURE = JSON.parse(
  readFileSync(resolve(HERE, "fixtures/search-eval-golden.json"), "utf8"),
) as GoldenFixture;

/** 用给定权重重放全部用例；返回每组用例的最终排序与宏平均指标 */
function evaluateWith(
  weights: FusionWeights = FIXTURE.weights,
  k: number = FIXTURE.k,
): { cases: SearchEvalCase[]; metrics: SearchEvalMetrics } {
  const cases: SearchEvalCase[] = FIXTURE.cases.map((c) => ({
    query: c.query,
    hits: fuse(c.candidates, weights, k).map((h) => h.siteId),
    relevance: c.relevance,
  }));
  return { cases, metrics: evaluateSearch(cases, k) };
}

/** 断言失败时能直接看到「哪条 query 掉了多少」，不用自己再跑一遍 */
function breakdown(cases: SearchEvalCase[], metrics: SearchEvalMetrics): string {
  const lines = cases.map(
    (c) => `  ${c.query}: ndcg=${ndcgAtK(c, FIXTURE.k).toFixed(4)} hits=[${c.hits.join(", ")}]`,
  );
  return (
    `宏平均 ndcg=${metrics.ndcgAtK.toFixed(4)} mrr=${metrics.mrrAtK.toFixed(4)} ` +
    `recall=${metrics.recallAtK.toFixed(4)}\n` + lines.join("\n")
  );
}

describe("检索金标集：结构与权重快照", () => {
  it("金标集没被掏空：≥8 条 query、每条 ≥3 个候选且 ≥2 个相关站点", () => {
    expect(FIXTURE.version).toBe(1);
    expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(8);
    const queries = new Set(FIXTURE.cases.map((c) => c.query));
    expect(queries.size).toBe(FIXTURE.cases.length);
    for (const c of FIXTURE.cases) {
      expect(c.query.trim().length, "query 不能为空").toBeGreaterThan(0);
      expect(c.candidates.length, c.query + " 候选过少").toBeGreaterThanOrEqual(3);
      const relevant = Object.values(c.relevance).filter((g) => g > 0).length;
      expect(relevant, c.query + " 相关站点过少").toBeGreaterThanOrEqual(2);
      // 每个候选都必须来自金标集认识的通道，拼错通道名会被权重表静默按 0 处理
      for (const cand of c.candidates) {
        expect(FIXTURE.weights[cand.channel], c.query + " 未知通道 " + cand.channel).toBeGreaterThan(0);
      }
    }
  });

  it("快照权重与生产 DEFAULT_WEIGHTS 逐字段一致（调参必须重录快照）", () => {
    expect(
      FIXTURE.weights,
      "DEFAULT_WEIGHTS 变了：请在同一 PR 里重录 fixtures/search-eval-golden.json 的 weights " +
        "并复核 thresholds，不要只改快照让它变绿",
    ).toEqual(DEFAULT_WEIGHTS);
  });

  it("阈值合法：三项都在 (0,1] 且 k 为正整数", () => {
    for (const [name, v] of Object.entries(FIXTURE.thresholds)) {
      expect(Number.isFinite(v), name).toBe(true);
      expect(v, name).toBeGreaterThan(0);
      expect(v, name).toBeLessThanOrEqual(1);
    }
    expect(Number.isInteger(FIXTURE.k)).toBe(true);
    expect(FIXTURE.k).toBeGreaterThan(0);
  });
});

describe("检索金标集：指标门", () => {
  it("宏平均 NDCG / MRR / Recall 不低于金标阈值", () => {
    const { cases, metrics } = evaluateWith();
    const detail = breakdown(cases, metrics);
    expect(metrics.ndcgAtK, "NDCG 跌破金标阈值\n" + detail).toBeGreaterThanOrEqual(
      FIXTURE.thresholds.ndcgAtK,
    );
    expect(metrics.mrrAtK, "MRR 跌破金标阈值\n" + detail).toBeGreaterThanOrEqual(
      FIXTURE.thresholds.mrrAtK,
    );
    expect(metrics.recallAtK, "Recall 跌破金标阈值\n" + detail).toBeGreaterThanOrEqual(
      FIXTURE.thresholds.recallAtK,
    );
  });

  it("非空转对照：所有通道权重归零 → 指标必须是 0（指标来自融合输出而非常量）", () => {
    const zero: FusionWeights = {
      exact: 0,
      fts: 0,
      pinyin: 0,
      semantic: 0,
      personal: 0,
      coverageStrength: FIXTURE.weights.coverageStrength,
      k: FIXTURE.weights.k,
    };
    const { cases, metrics } = evaluateWith(zero);
    expect(cases.every((c) => c.hits.length === 0)).toBe(true);
    expect(metrics).toEqual({ queries: FIXTURE.cases.length, ndcgAtK: 0, mrrAtK: 0, recallAtK: 0 });
  });

  it("通道回归可见：摘掉语义通道后 Recall 跌破阈值", () => {
    const { metrics } = evaluateWith({ ...FIXTURE.weights, semantic: 0 });
    expect(metrics.recallAtK).toBeLessThan(FIXTURE.thresholds.recallAtK);
  });

  it("偏好权重失控可见：personal 放大到 2.0 时，「图标库」用例的偏好噪声顶掉相关结果", () => {
    const target = FIXTURE.cases.find((c) => c.query === "图标库");
    expect(target, "金标集里少了「图标库」用例").toBeTruthy();
    const baseline = ndcgAtK(
      { query: target!.query, hits: fuse(target!.candidates, FIXTURE.weights, FIXTURE.k).map((h) => h.siteId), relevance: target!.relevance },
      FIXTURE.k,
    );
    const inflated = ndcgAtK(
      {
        query: target!.query,
        hits: fuse(target!.candidates, { ...FIXTURE.weights, personal: 2.0 }, FIXTURE.k).map((h) => h.siteId),
        relevance: target!.relevance,
      },
      FIXTURE.k,
    );
    // 只要求「明显下滑」而不是钉死数值：这里证明的是指标对偏好权重有方向性反应
    expect(baseline - inflated).toBeGreaterThan(0.05);
  });

  it("coverage 乘子真的在起作用：三路深名次胜过两路浅名次，关掉乘子则反转", () => {
    const candidates: SearchCandidate[] = [
      { siteId: "b-shallow", channel: "exact", rank: 1 },
      { siteId: "b-shallow", channel: "fts", rank: 1 },
      { siteId: "a-deep", channel: "fts", rank: 18 },
      { siteId: "a-deep", channel: "pinyin", rank: 18 },
      { siteId: "a-deep", channel: "semantic", rank: 18 },
    ];
    const order = (w: FusionWeights) => fuse(candidates, w, 10).map((h) => h.siteId);
    expect(order(FIXTURE.weights)[0]).toBe("a-deep");
    expect(order({ ...FIXTURE.weights, coverageStrength: 0 })[0]).toBe("b-shallow");
  });
});
