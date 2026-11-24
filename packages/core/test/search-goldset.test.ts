import { describe, expect, it } from "vitest";
import { validateSearchGoldSet } from "../src/search-goldset.ts";

type Grade = number | "unjudgeable";
function annotation(annotatorId: string, judgments: Record<string, Grade>) {
  const ids = Object.keys(judgments);
  return {
    annotatorId,
    independent: true,
    submittedAt: "2026-11-24T00:10:00.000Z",
    judgments,
    evidenceUrls: Object.fromEntries(ids.map((id) => [id, "https://example.com/" + id])),
    reasonCodes: Object.fromEntries(ids.map((id) => [
      id,
      judgments[id] === "unjudgeable" ? "insufficient_evidence" : "task_fit",
    ])),
  };
}
function adjudication(reviewerId: string, judgments: Record<string, Grade>) {
  const ids = Object.keys(judgments);
  return {
    reviewerId,
    reviewedAt: "2026-11-24T00:20:00.000Z",
    rationale: "第三人复核落地页与任务匹配证据",
    judgments,
    reasonCodes: Object.fromEntries(ids.map((id) => [
      id,
      judgments[id] === "unjudgeable" ? "insufficient_evidence" : "task_fit",
    ])),
  };
}
function makeSet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
        annotation("annotator_a", { "site-a": 3, "site-b": 1 }),
        annotation("annotator_b", { "site-a": 3, "site-b": 1 }),
      ],
    }],
    ...overrides,
  };
}
function firstCase(input: Record<string, unknown>): Record<string, unknown> {
  return (input.cases as Array<Record<string, unknown>>)[0]!;
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
    firstCase(input).annotations = [
      annotation("annotator_a", { "site-a": 3, "site-b": 1 }),
      annotation("annotator_b", { "site-a": 2, "site-b": 1 }),
    ];
    const result = validateSearchGoldSet(input);
    expect(result.evaluationCases[0]?.relevance["site-a"]).toBe(2);
  });

  it("重大分歧必须由第三名标注员仲裁", () => {
    const input = makeSet();
    const sample = firstCase(input);
    sample.annotations = [
      annotation("annotator_a", { "site-a": 3, "site-b": 1 }),
      annotation("annotator_b", { "site-a": 0, "site-b": 1 }),
    ];
    sample.adjudication = adjudication("reviewer_c", { "site-a": 2 });
    const result = validateSearchGoldSet(input);
    expect(result.evaluationCases[0]?.relevance["site-a"]).toBe(2);
    delete sample.adjudication;
    expect(() => validateSearchGoldSet(input)).toThrow("必须由第三人仲裁");
  });

  it("仲裁后仍不可判断的样本被排除，不会被伪装成 0 分", () => {
    const input = makeSet();
    const sample = firstCase(input);
    sample.annotations = [
      annotation("annotator_a", { "site-a": "unjudgeable", "site-b": 1 }),
      annotation("annotator_b", { "site-a": 2, "site-b": 1 }),
    ];
    sample.adjudication = adjudication("reviewer_c", { "site-a": "unjudgeable" });
    const result = validateSearchGoldSet(input);
    expect(result.eligibleCases).toBe(0);
    expect(result.excludedUnjudgeableCases).toBe(1);
  });

  it("拒绝相同标注员、缺失候选判断和非独立标注", () => {
    const sameAnnotator = makeSet();
    firstCase(sameAnnotator).annotations = [
      annotation("annotator_a", { "site-a": 3, "site-b": 1 }),
      annotation("annotator_a", { "site-a": 3, "site-b": 1 }),
    ];
    expect(() => validateSearchGoldSet(sameAnnotator)).toThrow("不同标注员");

    const missing = makeSet();
    firstCase(missing).annotations = [
      annotation("annotator_a", { "site-a": 3 }),
      annotation("annotator_b", { "site-a": 3, "site-b": 1 }),
    ];
    expect(() => validateSearchGoldSet(missing)).toThrow("全部 siteId");

    const notBlind = makeSet();
    const annotations = firstCase(notBlind).annotations as Array<Record<string, unknown>>;
    annotations[0] = { ...annotations[0]!, independent: false };
    expect(() => validateSearchGoldSet(notBlind)).toThrow("独立标注员");
  });

  it("拒绝不完整证据、含查询参数的证据 URL 和无效 reasonCode", () => {
    const missingEvidence = makeSet();
    const annotations = firstCase(missingEvidence).annotations as Array<Record<string, unknown>>;
    annotations[0] = { ...annotations[0]!, evidenceUrls: { "site-a": "https://example.com/site-a" } };
    expect(() => validateSearchGoldSet(missingEvidence)).toThrow("全部 siteId");

    const privateEvidence = makeSet();
    const privateAnnotations = firstCase(privateEvidence).annotations as Array<Record<string, unknown>>;
    const evidenceUrls = { ...(privateAnnotations[0]!.evidenceUrls as Record<string, string>), "site-a": "https://example.com/page?token=secret" };
    privateAnnotations[0] = { ...privateAnnotations[0]!, evidenceUrls };
    expect(() => validateSearchGoldSet(privateEvidence)).toThrow("查询参数");

    const invalidReason = makeSet();
    const reasonAnnotations = firstCase(invalidReason).annotations as Array<Record<string, unknown>>;
    reasonAnnotations[0] = {
      ...reasonAnnotations[0]!,
      reasonCodes: { "site-a": "made_up", "site-b": "task_fit" },
    };
    expect(() => validateSearchGoldSet(invalidReason)).toThrow("reasonCode");
  });

  it("拒绝明显个人信息并区分零结果查询", () => {
    const pii = makeSet();
    firstCase(pii).query = "联系 test@example.com";
    expect(() => validateSearchGoldSet(pii)).toThrow("必须先脱敏");

    const phone = makeSet();
    firstCase(phone).query = "+1 (415) 555-0123";
    expect(() => validateSearchGoldSet(phone)).toThrow("必须先脱敏");

    const token = makeSet();
    firstCase(token).query = "sk-1234567890abcdefghijklmn";
    expect(() => validateSearchGoldSet(token)).toThrow("必须先脱敏");

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
          annotation("annotator_a", {}),
          annotation("annotator_b", {}),
        ],
      }],
    });
    expect(validateSearchGoldSet(zero).evaluationCases).toEqual([{
      query: "不存在的工具类别", hits: [], relevance: {},
    }]);
  });

  it("拒绝重复查询，避免重复样本虚增 100 条金标规模", () => {
    const input = makeSet();
    const original = firstCase(input);
    const duplicate = {
      ...original,
      id: "case_000002",
      sampleId: "sample_000002",
      query: "  AI   图片编辑工具  ",
    };
    (input.cases as Array<Record<string, unknown>>).push(duplicate);
    expect(() => validateSearchGoldSet(input)).toThrow("query 与已有样本重复");
  });

  it("拒绝合成/非生产来源和未完成隐私复核的数据", () => {
    expect(() => validateSearchGoldSet(makeSet({ source: "synthetic" }))).toThrow("真实生产搜索遥测");
    const input = makeSet();
    firstCase(input).privacyReviewed = false;
    expect(() => validateSearchGoldSet(input)).toThrow("隐私复核");
  });
});
