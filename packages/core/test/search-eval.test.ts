import { describe, expect, it } from "vitest";

import {
  evaluateSearch,
  mrrAtK,
  ndcgAtK,
  recallAtK,
  type SearchEvalCase,
} from "../src/search-eval.ts";

const perfect: SearchEvalCase = {
  query: "ai 工具",
  hits: ["a", "b", "c"],
  relevance: { a: 3, b: 2, c: 1 },
};

describe("search-eval：离线检索指标", () => {
  it("完美排序的 NDCG / MRR / Recall 都是 1", () => {
    expect(ndcgAtK(perfect, 3)).toBeCloseTo(1, 10);
    expect(mrrAtK(perfect, 3)).toBe(1);
    expect(recallAtK(perfect, 3)).toBe(1);
  });

  it("逆转排序会降低 NDCG，但 MRR 仍可能被前排的低相关命中撑住", () => {
    const reversed: SearchEvalCase = { ...perfect, hits: ["c", "b", "a"] };
    expect(ndcgAtK(reversed, 3)).toBeCloseTo(6.392789 / 9.392789, 6);
    expect(mrrAtK(reversed, 3)).toBe(1);
  });

  it("MRR 只看第一个相关命中，不相关站点不贡献分数", () => {
    const caseWithMiss: SearchEvalCase = {
      query: "q",
      hits: ["x", "b"],
      relevance: { a: 3, b: 2 },
    };
    expect(mrrAtK(caseWithMiss, 2)).toBe(0.5);
  });

  it("k 截断会同时影响 NDCG 与 Recall", () => {
    const cutoff: SearchEvalCase = {
      query: "q",
      hits: ["c", "a"],
      relevance: { a: 3, c: 1 },
    };
    expect(ndcgAtK(cutoff, 1)).toBeCloseTo(1 / 7, 10);
    expect(recallAtK(cutoff, 1)).toBe(0.5);
  });

  it("重复命中只按第一次计分，避免刷高指标", () => {
    const dup: SearchEvalCase = {
      query: "q",
      hits: ["a", "a", "b"],
      relevance: { a: 3, b: 2 },
    };
    expect(ndcgAtK(dup, 3)).toBeCloseTo(1, 10);
    expect(recallAtK(dup, 3)).toBe(1);
  });

  it("空结果与无标注站点返回 0，不产生 NaN", () => {
    const empty: SearchEvalCase = { query: "q", hits: [], relevance: { a: 3 } };
    expect(ndcgAtK(empty, 10)).toBe(0);
    expect(mrrAtK(empty, 10)).toBe(0);
    expect(recallAtK(empty, 10)).toBe(0);

    const unlabeled: SearchEvalCase = { query: "q", hits: ["x"], relevance: {} };
    expect(ndcgAtK(unlabeled, 10)).toBe(0);
    expect(recallAtK(unlabeled, 10)).toBe(0);
  });

  it("evaluateSearch 求宏平均；空集合全 0", () => {
    const miss: SearchEvalCase = { query: "q2", hits: ["x"], relevance: { a: 3 } };
    const result = evaluateSearch([perfect, miss], 3);
    expect(result.queries).toBe(2);
    expect(result.ndcgAtK).toBeCloseTo(0.5, 10);
    expect(result.mrrAtK).toBeCloseTo(0.5, 10);
    expect(result.recallAtK).toBeCloseTo(0.5, 10);

    expect(evaluateSearch([], 10)).toEqual({ queries: 0, ndcgAtK: 0, mrrAtK: 0, recallAtK: 0 });
  });

  it("非法 k（0 / 负数 / NaN）按 0 处理", () => {
    expect(ndcgAtK(perfect, 0)).toBe(0);
    expect(mrrAtK(perfect, -1)).toBe(0);
    expect(recallAtK(perfect, Number.NaN)).toBe(0);
  });
});
