import { describe, expect, it } from "vitest";
import { finalSearchGoldLabels, validateSearchGoldCase, validateSearchGoldSet, type SearchGoldCase } from "../src/search-gold.ts";

const validCase = (queryId: string): SearchGoldCase => ({
  queryId, queryText: "脱敏后的真实查询文本", locale: "zh-CN", intent: "task",
  sampledAt: 1, privacyReviewed: true,
  snapshotId: "snapshot-2026-11-24-001",
  candidates: [{ siteId: "site-a", baselineRank: 1 }, { siteId: "site-b", baselineRank: 2 }],
  annotations: [
    { annotatorId: "annotator-a", annotatedAt: 1, judgments: [
      { siteId: "site-a", label: 3, rationaleCode: "direct_match" },
      { siteId: "site-b", label: 1, rationaleCode: "weak_match" },
    ] },
    { annotatorId: "annotator-b", annotatedAt: 2, judgments: [
      { siteId: "site-a", label: 3, rationaleCode: "direct_match" },
      { siteId: "site-b", label: 1, rationaleCode: "weak_match" },
    ] },
  ],
});

describe("human search gold-set protocol", () => {
  it("accepts two independent query-to-site annotations and resolves consensus", () => {
    const item = validCase("query_000001");
    expect(validateSearchGoldCase(item).valid).toBe(true);
    expect(finalSearchGoldLabels(item)).toEqual({ "site-a": 3, "site-b": 1 });
  });
  it("requires adjudication for each candidate-level disagreement", () => {
    const item = validCase("query_000002");
    item.annotations[1]!.judgments[1]!.label = 2;
    expect(validateSearchGoldCase(item).needsAdjudication).toEqual(["query_000002:site-b"]);
    item.adjudication = {
      adjudicatorId: "senior", rationale: "根据用户需求与站点功能说明裁决", adjudicatedAt: 3,
      judgments: [
        { siteId: "site-b", label: 2, rationaleCode: "related" },
      ],
    };
    expect(finalSearchGoldLabels(item)).toEqual({ "site-a": 3, "site-b": 2 });
  });
  it("requires a privacy-reviewed query and an adjudicator distinct from both annotators", () => {
    const unreviewed = validCase("query_000004");
    unreviewed.privacyReviewed = false;
    expect(validateSearchGoldCase(unreviewed).errors.join(" ")).toContain("privacyReviewed");

    const disputed = validCase("query_000005");
    disputed.annotations[1]!.judgments[1]!.label = 2;
    disputed.adjudication = {
      adjudicatorId: "annotator-a",
      rationale: "仲裁理由",
      adjudicatedAt: 3,
      judgments: [{ siteId: "site-b", label: 2, rationaleCode: "related" }],
    };
    expect(validateSearchGoldCase(disputed).errors.join(" ")).toContain("仲裁人必须独立于两名标注员");
  });

  it("does not produce final labels from a case that failed privacy or adjudication validation", () => {
    const item = validCase("query_000006");
    item.privacyReviewed = false;
    expect(finalSearchGoldLabels(item)).toEqual({});
  });

  it("rejects malformed runtime values without throwing", () => {
    expect(validateSearchGoldCase(null).valid).toBe(false);
    expect(validateSearchGoldCase({ queryId: 7, candidates: [null], annotations: [] }).valid).toBe(false);
  });

  it("requires every frozen candidate to be annotated", () => {
    const item = validCase("query_000003");
    item.annotations[0]!.judgments.pop();
    expect(validateSearchGoldCase(item).errors.join(" ")).toContain("缺少候选");
  });
  it("enforces the 100-query gate without inventing data", () => {
    const result = validateSearchGoldSet(Array.from({ length: 99 }, (_, i) => validCase(`query_${String(i).padStart(6, "0")}`)));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("至少 100 条");
  });
});
