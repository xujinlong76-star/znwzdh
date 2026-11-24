import type { SiteQualityBand } from "./site-quality.ts";

export type RecommendationSurface = "homepage" | "similar_sites" | "ai_finder" | "personalized";
export interface RecommendationQualitySignals {
  relevance: number | null;
  qualityScore: number | null;
  evidenceCoverage: number;
  qualityBand: SiteQualityBand;
  freshness: number | null;
  accessibilityConfidence: number | null;
  userAffinity: number | null;
  diversity: number | null;
}
export interface RecommendationScore {
  score: number | null;
  eligible: boolean;
  qualityApplied: boolean;
  reason: string;
}

const WEIGHTS: Record<RecommendationSurface, Record<keyof Omit<RecommendationQualitySignals, "qualityBand">, number>> = {
  homepage: { relevance: 0.25, qualityScore: 0.3, evidenceCoverage: 0.1, freshness: 0.1, accessibilityConfidence: 0.1, userAffinity: 0.05, diversity: 0.1 },
  similar_sites: { relevance: 0.4, qualityScore: 0.25, evidenceCoverage: 0.08, freshness: 0.07, accessibilityConfidence: 0.1, userAffinity: 0, diversity: 0.1 },
  ai_finder: { relevance: 0.45, qualityScore: 0.2, evidenceCoverage: 0.08, freshness: 0.08, accessibilityConfidence: 0.12, userAffinity: 0.02, diversity: 0.05 },
  personalized: { relevance: 0.2, qualityScore: 0.2, evidenceCoverage: 0.08, freshness: 0.08, accessibilityConfidence: 0.08, userAffinity: 0.2, diversity: 0.16 },
};

function signal(value: number | null, name: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError(`${name} 必须在 0–100 之间或为 null`);
  return value;
}

/** Shared feature contract, not a candidate retriever. Risk is a hard gate, not a compensable score. */
export function scoreRecommendation(surface: RecommendationSurface, input: RecommendationQualitySignals): RecommendationScore {
  const weights = WEIGHTS[surface];
  if (!weights) throw new TypeError("推荐场景无效");
  if (input.qualityBand === "high_risk") return { score: null, eligible: false, qualityApplied: false, reason: "high_risk" };
  const coverage = signal(input.evidenceCoverage, "evidenceCoverage")!;
  const rawQuality = signal(input.qualityScore, "qualityScore");
  const qualityApplied = rawQuality !== null && coverage >= 40 && input.qualityBand !== "insufficient_evidence";
  const values: Record<keyof Omit<RecommendationQualitySignals, "qualityBand">, number | null> = {
    relevance: signal(input.relevance, "relevance"),
    qualityScore: qualityApplied ? rawQuality : null,
    evidenceCoverage: coverage,
    freshness: signal(input.freshness, "freshness"),
    accessibilityConfidence: signal(input.accessibilityConfidence, "accessibilityConfidence"),
    userAffinity: signal(input.userAffinity, "userAffinity"),
    diversity: signal(input.diversity, "diversity"),
  };
  let weighted = 0, usedWeight = 0;
  for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
    const value = values[key], weight = weights[key];
    if (value === null || weight === 0) continue;
    weighted += value * weight;
    usedWeight += weight;
  }
  if (usedWeight === 0) return { score: null, eligible: true, qualityApplied: false, reason: "insufficient_signals" };
  return {
    score: Number((weighted / usedWeight).toFixed(4)),
    eligible: true,
    qualityApplied,
    reason: qualityApplied ? "evidence_weighted" : "quality_unavailable_or_insufficient_evidence",
  };
}
