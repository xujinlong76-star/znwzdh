import { describe, expect, it } from "vitest";
import { scoreRecommendation, type RecommendationQualitySignals } from "../src/recommendation-quality.ts";

const base: RecommendationQualitySignals = {
  relevance: 90, qualityScore: 95, evidenceCoverage: 80, qualityBand: "high",
  freshness: 80, accessibilityConfidence: 90, userAffinity: 70, diversity: 60,
};

describe("shared recommendation quality features", () => {
  it("scores each recommendation surface through independent weights", () => {
    const home = scoreRecommendation("homepage", base);
    const finder = scoreRecommendation("ai_finder", base);
    expect(home.eligible).toBe(true);
    expect(home.qualityApplied).toBe(true);
    expect(home.score).not.toBe(finder.score);
  });
  it("hard-blocks high-risk candidates regardless of other quality signals", () => {
    expect(scoreRecommendation("homepage", { ...base, qualityBand: "high_risk", qualityScore: 100 })).toMatchObject({ eligible: false, score: null, reason: "high_risk" });
  });
  it("does not apply a quality score when evidence coverage is insufficient", () => {
    expect(scoreRecommendation("personalized", { ...base, evidenceCoverage: 20 })).toMatchObject({ eligible: true, qualityApplied: false });
  });
  it("rejects malformed numeric signals", () => {
    expect(() => scoreRecommendation("homepage", { ...base, relevance: 101 })).toThrow();
  });
});
