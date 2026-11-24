import { describe, expect, it } from "vitest";
import { parseSearchGoldJsonl, validateSearchGoldJsonl } from "./validate-search-goldset.mts";

function makeCase(index: number, datasetVersion = "search-gold-v1") {
  return {
    schemaVersion: "search-quality-golden-v2",
    datasetVersion,
    queryId: `query_${String(index).padStart(6, "0")}`,
    queryText: "脱敏查询示例文本",
    locale: "zh-CN",
    intent: "task",
    sampledAt: 1_700_000_000_000,
    privacyReviewed: true,
    snapshotId: "snapshot-2026-11-24",
    candidates: [{ siteId: "site-a", baselineRank: 1, evidenceUrl: "https://example.com/" }],
    annotations: [
      { annotatorId: "annotator-a", annotatedAt: 1_700_000_000_001, judgments: [{ siteId: "site-a", label: 3, rationaleCode: "direct_match" }] },
      { annotatorId: "annotator-b", annotatedAt: 1_700_000_000_002, judgments: [{ siteId: "site-a", label: 3, rationaleCode: "direct_match" }] },
    ],
  };
}

describe("validate-search-goldset JSONL", () => {
  it("validates 100 structurally valid privacy-reviewed cases without echoing query text", () => {
    const input = Array.from({ length: 100 }, (_, index) => JSON.stringify(makeCase(index + 1))).join("\n");
    const result = validateSearchGoldJsonl(input);
    expect(result.count).toBe(100);
    expect(result.datasetVersion).toBe("search-gold-v1");
    expect(result.validation.valid).toBe(true);
  });

  it("rejects mixed dataset versions", () => {
    const input = [JSON.stringify(makeCase(1)), JSON.stringify(makeCase(2, "search-gold-v2"))].join("\n");
    const result = validateSearchGoldJsonl(input, 2);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.join(" ")).toContain("不得混合不同 datasetVersion");
  });

  it("ignores blank lines but reports malformed JSON by line number only", () => {
    expect(parseSearchGoldJsonl("\n" + JSON.stringify(makeCase(1)) + "\n\n")).toHaveLength(1);
    expect(() => parseSearchGoldJsonl('{"queryText":"private query"}\n{bad json}')).toThrow("第 2 行不是有效 JSON");
    try {
      parseSearchGoldJsonl('{"queryText":"private query"}\n{bad json}');
    } catch (error) {
      expect(String(error)).not.toContain("private query");
    }
  });

  it("rejects oversized rows and datasets", () => {
    expect(() => parseSearchGoldJsonl(JSON.stringify({ queryText: "x".repeat(300_000) }))).toThrow("256KB");
    const many = Array.from({ length: 10_001 }, (_, index) => JSON.stringify(makeCase(index + 1))).join("\n");
    expect(() => parseSearchGoldJsonl(many)).toThrow("最多允许 10000");
  });
});
