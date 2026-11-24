import { describe, expect, it } from "vitest";
import { evaluateSearch } from "../src/search-eval.ts";
import { rerankBySiteQualityShadow, type SiteQualityShadowCandidate } from "../src/quality-shadow-rerank.ts";

const candidates: SiteQualityShadowCandidate[] = [
  { siteId: "best-match", qualityScore: 0, evidenceCoverage: 70, band: "low" },
  { siteId: "second-match", qualityScore: 100, evidenceCoverage: 85, band: "high" },
  { siteId: "unknown", qualityScore: null, evidenceCoverage: 25, band: "insufficient_evidence" },
  { siteId: "risk", qualityScore: 100, evidenceCoverage: 95, band: "high_risk" },
  { siteId: "filler-5", qualityScore: null, evidenceCoverage: 0, band: "insufficient_evidence" },
  { siteId: "filler-6", qualityScore: null, evidenceCoverage: 0, band: "insufficient_evidence" },
  { siteId: "filler-7", qualityScore: null, evidenceCoverage: 0, band: "insufficient_evidence" },
  { siteId: "filler-8", qualityScore: null, evidenceCoverage: 0, band: "insufficient_evidence" },
  { siteId: "filler-9", qualityScore: null, evidenceCoverage: 0, band: "insufficient_evidence" },
  { siteId: "filler-10", qualityScore: null, evidenceCoverage: 0, band: "insufficient_evidence" },
];

describe("site quality shadow reranker", () => {
  it("creates a bounded shadow order without mutating baseline candidates", () => {
    const result = rerankBySiteQualityShadow(candidates);
    expect(result.slice(0, 4).map((item) => item.siteId)).toEqual(["second-match", "best-match", "unknown", "risk"]);
    expect(result.find((item) => item.siteId === "second-match")?.baselineRank).toBe(2);
    expect(result.find((item) => item.siteId === "second-match")?.shadowRank).toBe(1);
    expect(candidates[0]?.siteId).toBe("best-match");
  });

  it("does not apply unknown, low-coverage, or high-risk scores", () => {
    const result = rerankBySiteQualityShadow(candidates);
    expect(result.find((item) => item.siteId === "unknown")?.excludedReason).toBe("unknown_score");
    expect(result.find((item) => item.siteId === "risk")?.excludedReason).toBe("high_risk");
    const lowCoverage = rerankBySiteQualityShadow([
      { siteId: "a", qualityScore: 100, evidenceCoverage: 10, band: "high" },
    ]);
    expect(lowCoverage[0]?.applied).toBe(false);
    expect(lowCoverage[0]?.excludedReason).toBe("insufficient_coverage");
  });

  it("keeps the baseline exactly when quality weight is zero", () => {
    const result = rerankBySiteQualityShadow(candidates, { qualityWeight: 0 });
    expect(result.map((item) => item.siteId)).toEqual(candidates.map((item) => item.siteId));
    expect(result.every((item) => !item.applied)).toBe(true);
  });

  it("rejects unsafe experiment weights and duplicate identities", () => {
    expect(() => rerankBySiteQualityShadow(candidates, { qualityWeight: 0.5 })).toThrow(/0–0.25/);
    expect(() => rerankBySiteQualityShadow([
      { siteId: "same", qualityScore: 80, evidenceCoverage: 80, band: "high" },
      { siteId: "same", qualityScore: 70, evidenceCoverage: 70, band: "medium" },
    ])).toThrow(/唯一/);
  });

  it("allows offline relevance metrics to compare baseline and shadow order", () => {
    const relevance = { "best-match": 3, "second-match": 2, unknown: 0, risk: 0 };
    const baseline = evaluateSearch([{ query: "tool", hits: candidates.map((item) => item.siteId), relevance }], 4);
    const shadow = evaluateSearch([{
      query: "tool",
      hits: rerankBySiteQualityShadow(candidates).map((item) => item.siteId),
      relevance,
    }], 4);
    expect(baseline.queries).toBe(1);
    expect(shadow.queries).toBe(1);
    expect(Number.isFinite(shadow.ndcgAtK)).toBe(true);
  });
});
