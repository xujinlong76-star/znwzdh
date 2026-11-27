import { describe, expect, it } from "vitest";
import { validateSearchGoldCase, validateSearchGoldSet, type SearchGoldCase, type SearchGoldLabel, type SearchGoldReasonCode } from "../src/search-gold.ts";

function judgment(siteId: string, label: SearchGoldLabel, rationaleCode: SearchGoldReasonCode = "task_fit") {
  return { siteId, label, rationaleCode };
}
function makeCase(queryId = "query_000001"): SearchGoldCase {
  return {
    schemaVersion: "search-quality-golden-v2",
    datasetVersion: "search-gold-v2-2026-11",
    queryId,
    queryText: "AI 图片编辑工具",
    locale: "zh-CN",
    intent: "task",
    sampledAt: 1_700_000_000_000,
    privacyReviewed: true,
    snapshotId: "snapshot_000001",
    candidates: [
      { siteId: "site-a", baselineRank: 1, evidenceUrl: "https://example.com/site-a" },
      { siteId: "site-b", baselineRank: 2, evidenceUrl: "https://example.com/site-b" },
    ],
    annotations: [
      { annotatorId: "annotator_a", annotatedAt: 1_700_000_000_001, judgments: [
        judgment("site-a", 3, "exact_match"), judgment("site-b", 1, "partial_fit"),
      ] },
      { annotatorId: "annotator_b", annotatedAt: 1_700_000_000_002, judgments: [
        judgment("site-a", 3, "exact_match"), judgment("site-b", 1, "partial_fit"),
      ] },
    ],
  };
}

describe("search-quality-golden-v2", () => {
  it("accepts two independent labels and produces frozen baseline eval cases", () => {
    const item = makeCase();
    expect(validateSearchGoldCase(item).errors).toEqual([]);
    const result = validateSearchGoldSet([item], 1);
    expect(result).toMatchObject({
      totalCases: 1, eligibleCases: 1, excludedUnjudgeableCases: 0,
      datasetVersion: "search-gold-v2-2026-11",
      eligibleIntentCounts: { task: 1 },
      eligibleLocaleCounts: { "zh-CN": 1 },
      evaluationCases: [{
        query: "AI 图片编辑工具",
        hits: ["site-a", "site-b"],
        relevance: { "site-a": 3, "site-b": 1 },
      }],
    });
  });

  it("uses the lower grade for a one-point disagreement", () => {
    const item = makeCase();
    item.annotations[1].judgments[0] = judgment("site-a", 2);
    const result = validateSearchGoldSet([item], 1);
    expect(result.eligibleCases).toBe(1);
    expect(result.evaluationCases[0]?.relevance["site-a"]).toBe(2);
  });

  it("requires a third independent adjudicator for major disagreements", () => {
    const item = makeCase();
    item.annotations[1].judgments[0] = judgment("site-a", 0);
    const missing = validateSearchGoldCase(item);
    expect(missing.needsAdjudication).toEqual(["query_000001:site-a"]);
    item.adjudication = {
      adjudicatorId: "reviewer_c",
      adjudicatedAt: 1_700_000_000_003,
      rationale: "根据页面实际功能与查询任务匹配度裁决",
      judgments: [judgment("site-a", 2)],
    };
    const result = validateSearchGoldSet([item], 1);
    expect(result.eligibleCases).toBe(1);
    expect(result.evaluationCases[0]?.relevance["site-a"]).toBe(2);
  });

  it("excludes unresolved unjudgeable cases rather than treating them as zero", () => {
    const item = makeCase();
    item.annotations[0].judgments[0] = judgment("site-a", "unjudgeable", "unavailable");
    item.annotations[1].judgments[0] = judgment("site-a", 2);
    item.adjudication = {
      adjudicatorId: "reviewer_c",
      adjudicatedAt: 1_700_000_000_003,
      rationale: "目标站点无法访问，证据不足",
      judgments: [judgment("site-a", "unjudgeable", "insufficient_evidence")],
    };
    const result = validateSearchGoldSet([item], 1);
    expect(result.eligibleCases).toBe(0);
    expect(result.excludedUnjudgeableCases).toBe(1);
  });

  it("supports zero-result queries with an empty candidate snapshot", () => {
    const item = makeCase();
    item.intent = "zero_result";
    item.candidates = [];
    item.annotations = [
      { annotatorId: "annotator_a", annotatedAt: 1_700_000_000_001, judgments: [] },
      { annotatorId: "annotator_b", annotatedAt: 1_700_000_000_002, judgments: [] },
    ];
    const result = validateSearchGoldSet([item], 1);
    expect(result.eligibleCases).toBe(1);
    expect(result.evaluationCases[0]).toEqual({ query: item.queryText, hits: [], relevance: {} });
  });

  it("rejects PII, access tokens, unsafe evidence URLs and duplicate normalized queries", () => {
    const email = makeCase();
    email.queryText = "contact test@example.com";
    expect(validateSearchGoldCase(email).errors.join(" ")).toContain("必须先脱敏");
    const phone = makeCase();
    phone.queryText = "+1 (415) 555-0123";
    expect(validateSearchGoldCase(phone).errors.join(" ")).toContain("必须先脱敏");
    const token = makeCase();
    token.queryText = "sk-1234567890abcdefghijklmn";
    expect(validateSearchGoldCase(token).errors.join(" ")).toContain("必须先脱敏");
    const unsafeUrl = makeCase();
    unsafeUrl.candidates[0]!.evidenceUrl = "https://example.com/page?token=secret";
    expect(validateSearchGoldCase(unsafeUrl).errors.join(" ")).toContain("不含凭据/查询参数/片段");
    const duplicate = makeCase("query_000002");
    duplicate.queryText = "  AI   图片编辑工具 ";
    expect(validateSearchGoldSet([makeCase(), duplicate], 2).errors.join(" ")).toContain("规范化 queryText 重复");
  });

  it("rejects same annotators, incomplete candidate labels and invalid adjudicators", () => {
    const same = makeCase();
    same.annotations[1] = { ...same.annotations[0], annotatorId: same.annotations[0].annotatorId };
    expect(validateSearchGoldCase(same).errors.join(" ")).toContain("两名不同标注员");
    const incomplete = makeCase();
    incomplete.annotations[0].judgments.pop();
    expect(validateSearchGoldCase(incomplete).errors.join(" ")).toContain("必须覆盖候选快照");
    const disputed = makeCase();
    disputed.annotations[1].judgments[0] = judgment("site-a", 0);
    disputed.adjudication = {
      adjudicatorId: "annotator_a",
      adjudicatedAt: 1_700_000_000_003,
      rationale: "仲裁理由",
      judgments: [judgment("site-a", 2)],
    };
    expect(validateSearchGoldCase(disputed).errors.join(" ")).toContain("独立第三人");
  });

  it("rejects mixed dataset versions and enforces the 100-query gate", () => {
    const first = makeCase("query_000001");
    const second = makeCase("query_000002");
    second.datasetVersion = "search-gold-v3";
    expect(validateSearchGoldSet([first, second], 2).errors.join(" ")).toContain("不得混合不同 datasetVersion");
    expect(validateSearchGoldSet([first]).errors.join(" ")).toContain("至少 100 条");
  });

  it("does not echo raw query text in validation errors", () => {
    const item = makeCase();
    item.queryText = "private phrase test@example.com";
    const errors = validateSearchGoldCase(item).errors.join(" ");
    expect(errors).not.toContain("private phrase");
    expect(errors).not.toContain("test@example.com");
  });
});
