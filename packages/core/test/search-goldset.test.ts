import { describe, expect, it } from "vitest";
import { validateSearchGoldSet } from "../src/search-goldset.ts";

function makeSet(overrides: Record<string, unknown> = {}) {
  return {
    schema: "navhub-search-gold-v1",
    deidentified: true,
    source: "production_search_telemetry",
    cases: [{
      id: "case_000001",
      sampleId: "sample_000001",
      sampledAt: "2026-11-24T00:00:00.000Z",
      query: "AI 图片编辑工具",
      locale: "zh-CN",
      intent: "task",
      privacyReviewed: true,
      hits: ["site-a", "site-b"],
      annotations: [
        { annotatorId: "annotator_a", independent: true, judgments: { "site-a": 3, "site-b": 1 } },
        { annotatorId: "annotator_b", independent: true, judgments: { "site-a": 3, "site-b": 1 } },
      ],
    }],
    ...overrides,
  };
}

describe("search gold set：双盲人工金标校验", () => {
  it("接受两名不同标注员的一致判断并生成离线评测样本", () => {
    const result = validateSearchGoldSet(makeSet());
    expect(result).toMatchObject({
      totalCases: 1,
      eligibleCases: 1,
      excludedUnjudgeableCases: 0,
      evaluationCases: [{
        query: "AI 图片编辑工具",
        hits: ["site-a", "site-b"],
        relevance: { "site-a": 3, "site-b": 1 },
      }],
    });
  });

  it("轻微分歧采用较低等级，避免评测结果过度乐观", () => {
    const input = makeSet();
    const sample = (input.cases as Array<Record<string, unknown>>)[0]!;
    const annotations = sample.annotations as Array<Record<string, unknown>>;
    annotations[1] = {
      annotatorId: "annotator_b",
      independent: true,
      judgments: { "site-a": 2, "site-b": 1 },
    };
    const result = validateSearchGoldSet(input);
    expect(result.evaluationCases[0]?.relevance["site-a"]).toBe(2);
  });

  it("重大分歧必须由第三名标注员仲裁", () => {
    const input = makeSet();
    const sample = (input.cases as Array<Record<string, unknown>>)[0]!;
    const annotations = sample.annotations as Array<Record<string, unknown>>;
    annotations[1] = {
      annotatorId: "annotator_b",
      independent: true,
      judgments: { "site-a": 0, "site-b": 1 },
    };
    sample.adjudication = {
      reviewerId: "reviewer_c",
      judgments: { "site-a": 2 },
    };
    const result = validateSearchGoldSet(input);
    expect(result.evaluationCases[0]?.relevance["site-a"]).toBe(2);
    delete sample.adjudication;
    expect(() => validateSearchGoldSet(input)).toThrow("必须由第三人仲裁");
  });

  it("仲裁后仍不可判断的样本被排除，不会被伪装成 0 分", () => {
    const input = makeSet();
    const sample = (input.cases as Array<Record<string, unknown>>)[0]!;
    const annotations = sample.annotations as Array<Record<string, unknown>>;
    annotations[0] = {
      annotatorId: "annotator_a",
      independent: true,
      judgments: { "site-a": "unjudgeable", "site-b": 1 },
    };
    annotations[1] = {
      annotatorId: "annotator_b",
      independent: true,
      judgments: { "site-a": 2, "site-b": 1 },
    };
    sample.adjudication = {
      reviewerId: "reviewer_c",
      judgments: { "site-a": "unjudgeable" },
    };
    const result = validateSearchGoldSet(input);
    expect(result.eligibleCases).toBe(0);
    expect(result.excludedUnjudgeableCases).toBe(1);
  });

  it("拒绝相同标注员、缺失候选判断和非独立标注", () => {
    const sameAnnotator = makeSet();
    const sameCase = (sameAnnotator.cases as Array<Record<string, unknown>>)[0]!;
    const sameAnnotations = sameCase.annotations as Array<Record<string, unknown>>;
    sameAnnotations[1] = { ...sameAnnotations[0]!, annotatorId: "annotator_a" };
    expect(() => validateSearchGoldSet(sameAnnotator)).toThrow("不同标注员");

    const missing = makeSet();
    const missingCase = (missing.cases as Array<Record<string, unknown>>)[0]!;
    const missingAnnotations = missingCase.annotations as Array<Record<string, unknown>>;
    missingAnnotations[0] = { annotatorId: "annotator_a", independent: true, judgments: { "site-a": 3 } };
    expect(() => validateSearchGoldSet(missing)).toThrow("全部 siteId");

    const notBlind = makeSet();
    const blindCase = (notBlind.cases as Array<Record<string, unknown>>)[0]!;
    const blindAnnotations = blindCase.annotations as Array<Record<string, unknown>>;
    blindAnnotations[0] = { ...blindAnnotations[0]!, independent: false };
    expect(() => validateSearchGoldSet(notBlind)).toThrow("独立标注员");
  });

  it("拒绝明显个人信息并区分零结果查询", () => {
    const pii = makeSet();
    const piiCase = (pii.cases as Array<Record<string, unknown>>)[0]!;
    piiCase.query = "联系 test@example.com";
    expect(() => validateSearchGoldSet(pii)).toThrow("必须先脱敏");

    const zero = makeSet({
      cases: [{
        id: "case_000002",
        sampleId: "sample_000002",
        sampledAt: "2026-11-24T00:00:00.000Z",
        query: "不存在的工具类别",
        locale: "zh-CN",
        intent: "zero_result",
        privacyReviewed: true,
        hits: [],
        annotations: [
          { annotatorId: "annotator_a", independent: true, judgments: {} },
          { annotatorId: "annotator_b", independent: true, judgments: {} },
        ],
      }],
    });
    expect(validateSearchGoldSet(zero).evaluationCases).toEqual([{
      query: "不存在的工具类别", hits: [], relevance: {},
    }]);
  });

  it("拒绝合成/非生产来源和未完成隐私复核的数据", () => {
    expect(() => validateSearchGoldSet(makeSet({ source: "synthetic" }))).toThrow("真实生产搜索遥测");
    const input = makeSet();
    (input.cases as Array<Record<string, unknown>>)[0]!.privacyReviewed = false;
    expect(() => validateSearchGoldSet(input)).toThrow("隐私复核");
  });
});
