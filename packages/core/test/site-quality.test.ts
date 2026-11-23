import { describe, expect, it } from "vitest";
import {
  evaluateSiteQuality,
  SITE_QUALITY_VERSION,
  type SiteQualityAssessments,
} from "../src/site-quality.ts";

function emptyAssessments(): SiteQualityAssessments {
  return {
    accessibility: { score: null, evidence: [] },
    contentCompleteness: { score: null, evidence: [] },
    sourceTrust: { score: null, evidence: [] },
    relevance: { score: null, evidence: [] },
    uniqueness: { score: null, evidence: [] },
    freshness: { score: null, evidence: [] },
    risk: { score: null, evidence: [] },
  };
}

describe("site quality evidence contract", () => {
  it("keeps unknown dimensions unknown instead of treating them as zero", () => {
    const result = evaluateSiteQuality(emptyAssessments(), 1_800_000_000_000);
    expect(result.score).toBeNull();
    expect(result.evidenceCoverage).toBe(0);
    expect(result.band).toBe("insufficient_evidence");
    expect(result.riskScore).toBeNull();
  });

  it("requires evidence for every numeric dimension score", () => {
    const dimensions = emptyAssessments();
    dimensions.accessibility = { score: 0, evidence: ["  "] };
    expect(() => evaluateSiteQuality(dimensions)).toThrow(/没有有效证据/);
  });

  it("rejects out-of-range and non-finite scores", () => {
    const dimensions = emptyAssessments();
    dimensions.accessibility = { score: 101, evidence: ["HTTP 200"] };
    expect(() => evaluateSiteQuality(dimensions)).toThrow(/0–100/);
    dimensions.accessibility = { score: Number.NaN, evidence: ["HTTP 200"] };
    expect(() => evaluateSiteQuality(dimensions)).toThrow(/0–100/);
  });

  it("calculates a weighted score only when enough evidence is present", () => {
    const dimensions = emptyAssessments();
    dimensions.accessibility = { score: 100, evidence: ["two successful checks"] };
    dimensions.contentCompleteness = { score: 80, evidence: ["title and description present"] };
    dimensions.sourceTrust = { score: 90, evidence: ["official domain confirmed"] };
    dimensions.relevance = { score: 80, evidence: ["category and content agree"] };
    const result = evaluateSiteQuality(dimensions, 1_800_000_000_000);
    expect(result.score).toBe(89.41);
    expect(result.evidenceCoverage).toBe(70);
    expect(result.observedDimensions).toBe(4);
    expect(result.band).toBe("high");
  });

  it("inverts risk contribution and exposes raw risk separately", () => {
    const dimensions = emptyAssessments();
    dimensions.accessibility = { score: 90, evidence: ["reachable"] };
    dimensions.contentCompleteness = { score: 90, evidence: ["metadata complete"] };
    dimensions.sourceTrust = { score: 90, evidence: ["source verified"] };
    dimensions.risk = { score: 95, evidence: ["confirmed phishing indicator"] };
    const result = evaluateSiteQuality(dimensions, 1_800_000_000_000);
    expect(result.riskScore).toBe(95);
    expect(result.band).toBe("high_risk");
    expect(result.score).toBeLessThan(90);
  });

  it("does not call low evidence coverage a low-quality site", () => {
    const dimensions = emptyAssessments();
    dimensions.accessibility = { score: 10, evidence: ["single timeout"] };
    dimensions.freshness = { score: 0, evidence: ["last checked over one year ago"] };
    const result = evaluateSiteQuality(dimensions, 1_800_000_000_000);
    expect(result.score).toBeNull();
    expect(result.band).toBe("insufficient_evidence");
  });

  it("returns a versioned defensive snapshot", () => {
    const dimensions = emptyAssessments();
    dimensions.accessibility = { score: 90, evidence: ["ok"] };
    dimensions.contentCompleteness = { score: 90, evidence: ["complete"] };
    dimensions.sourceTrust = { score: 90, evidence: ["verified"] };
    const result = evaluateSiteQuality(dimensions, 1_800_000_000_000);
    dimensions.accessibility.evidence[0] = "mutated";
    expect(result.version).toBe(SITE_QUALITY_VERSION);
    expect(result.evaluatedAt).toBe(1_800_000_000_000);
    expect(result.dimensions.accessibility.evidence[0]).toBe("ok");
  });

  it("requires a valid evaluation timestamp", () => {
    expect(() => evaluateSiteQuality(emptyAssessments(), 0)).toThrow(/时间戳/);
  });
});
