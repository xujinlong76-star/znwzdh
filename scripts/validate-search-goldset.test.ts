import { describe, expect, it } from "vitest";
import { parseSearchGoldJsonl, validateSearchGoldJsonl } from "./validate-search-goldset.mts";

function makeCase(index: number, datasetVersion = "search-gold-v2-2026-11") {
  return {
    schemaVersion: "search-quality-golden-v2",
    datasetVersion,
    queryId: "query_" + String(index).padStart(6, "0"),
    queryText: "脱敏真实查询样本 " + String(index).padStart(3, "0"),
    locale: "zh-CN",
    intent: "task",
    sampledAt: 1_700_000_000_000 + index,
    privacyReviewed: true,
    snapshotId: "snapshot_000001",
    candidates: [{ siteId: "site-a", baselineRank: 1, evidenceUrl: "https://example.com/site-a" }],
    annotations: [
      { annotatorId: "annotator_a", annotatedAt: 1_700_000_000_001, judgments: [{ siteId: "site-a", label: 3, rationaleCode: "exact_match" }] },
      { annotatorId: "annotator_b", annotatedAt: 1_700_000_000_002, judgments: [{ siteId: "site-a", label: 3, rationaleCode: "exact_match" }] },
    ],
  };
}

describe("validate-search-goldset JSONL", () => {
  it("validates 100 unique production cases without echoing query text", () => {
    const input = Array.from({ length: 100 }, (_, index) => JSON.stringify(makeCase(index + 1))).join("\n");
    const result = validateSearchGoldJsonl(input);
    expect(result.totalCases).toBe(100);
    expect(result.eligibleCases).toBe(100);
    expect(result.datasetVersion).toBe("search-gold-v2-2026-11");
    expect(result.errors).toEqual([]);
  });

  it("rejects mixed dataset versions and duplicate normalized queries", () => {
    const first = makeCase(1);
    const second = makeCase(2, "search-gold-v3");
    second.queryText = "  脱敏真实查询   样本 001 ";
    const result = validateSearchGoldJsonl([JSON.stringify(first), JSON.stringify(second)].join("\n"), 2);
    expect(result.errors.join(" ")).toContain("不得混合不同 datasetVersion");
    expect(result.errors.join(" ")).toContain("规范化 queryText 重复");
  });

  it("ignores blank lines and reports malformed JSON by line number only", () => {
    expect(parseSearchGoldJsonl("\n" + JSON.stringify(makeCase(1)) + "\n\n")).toHaveLength(1);
    expect(() => parseSearchGoldJsonl('{"queryText":"private phrase"}\n{bad json}')).toThrow("第 2 行不是有效 JSON");
    try {
      parseSearchGoldJsonl('{"queryText":"private phrase"}\n{bad json}');
    } catch (error) {
      expect(String(error)).not.toContain("private phrase");
    }
  });

  it("rejects oversized rows and datasets", () => {
    expect(() => parseSearchGoldJsonl(JSON.stringify({ queryText: "x".repeat(300_000) }))).toThrow("256KB");
    const many = Array.from({ length: 10_001 }, (_, index) => JSON.stringify(makeCase(index + 1))).join("\n");
    expect(() => parseSearchGoldJsonl(many)).toThrow("最多允许 10000");
  });
});
