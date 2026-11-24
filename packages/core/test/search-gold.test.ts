import { describe, expect, it } from "vitest";
import { finalSearchGoldLabel, validateSearchGoldCase, validateSearchGoldSet, type SearchGoldCase } from "../src/search-gold.ts";

const validCase = (queryId: string): SearchGoldCase => ({
  queryId, queryText: "匿名化查询文本", locale: "zh-CN", intent: "task",
  snapshotId: "snapshot-2026-11-24-001",
  candidates: [{ siteId: "site-a", baselineRank: 1 }, { siteId: "site-b", baselineRank: 2 }],
  annotations: [
    { annotatorId: "annotator-a", label: 3, rationaleCode: "direct_match", annotatedAt: 1 },
    { annotatorId: "annotator-b", label: 3, rationaleCode: "direct_match", annotatedAt: 2 },
  ],
});

describe("human search gold-set protocol", () => {
  it("accepts two independent annotations and resolves consensus", () => {
    const item = validCase("query_000001");
    expect(validateSearchGoldCase(item).valid).toBe(true);
    expect(finalSearchGoldLabel(item)).toBe(3);
  });
  it("requires adjudication for disagreements", () => {
    const item = validCase("query_000002");
    item.annotations[1]!.label = 1;
    expect(validateSearchGoldCase(item).needsAdjudication).toEqual(["query_000002"]);
    item.adjudication = { adjudicatorId: "senior", label: 2, rationale: "综合判断", adjudicatedAt: 3 };
    expect(finalSearchGoldLabel(item)).toBe(2);
  });
  it("enforces the 100-case gate without inventing data", () => {
    const result = validateSearchGoldSet(Array.from({ length: 99 }, (_, i) => validCase(`query_${String(i).padStart(6, "0")}`)));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("至少 100 条");
  });
});
