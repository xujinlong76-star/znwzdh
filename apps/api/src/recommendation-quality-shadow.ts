import { scoreRecommendation, type RecommendationSurface, type Site } from "@navhub/core";
import type { AppContext } from "./context.ts";

export interface RecommendationShadowInput {
  surface: RecommendationSurface;
  sites: readonly Site[];
  relevanceBySiteId: ReadonlyMap<string, number>;
}

/**
 * Observes a quality-aware order without changing the user-visible baseline.
 * Disabled unless explicitly enabled; no query, identity, IP or raw user signal is persisted.
 */
export async function recordRecommendationQualityShadow(
  ctx: AppContext,
  input: RecommendationShadowInput,
): Promise<void> {
  if (process.env.NAVHUB_RECOMMENDATION_QUALITY_SHADOW !== "true" || input.sites.length === 0) return;
  try {
    const snapshots = await ctx.repo.getSiteQualityAssessmentsBySiteIds(input.sites.map(site => site.id));
    const byId = new Map(snapshots.map(row => [row.siteId, row]));
    const scored = input.sites.map((site, index) => {
      const quality = byId.get(site.id);
      const result = scoreRecommendation(input.surface, {
        relevance: input.relevanceBySiteId.get(site.id) ?? null,
        qualityScore: quality?.score ?? null,
        evidenceCoverage: quality?.evidenceCoverage ?? 0,
        qualityBand: quality?.band ?? "insufficient_evidence",
        freshness: null,
        accessibilityConfidence: null,
        userAffinity: null,
        diversity: null,
      });
      return { siteId: site.id, baselineRank: index + 1, ...result };
    });
    const shadowOrder = scored
      .filter(item => item.eligible)
      .sort((a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY) || a.baselineRank - b.baselineRank)
      .map(item => item.siteId);
    await ctx.repo.recordEvent("recommendation_quality_shadow", {
      meta: {
        version: "recommendation-quality-v1",
        surface: input.surface,
        baselineSiteIds: input.sites.slice(0, 100).map(site => site.id),
        shadowSiteIds: shadowOrder.slice(0, 100),
        candidateCount: input.sites.length,
        appliedCount: scored.filter(item => item.qualityApplied).length,
        excludedHighRiskCount: scored.filter(item => !item.eligible).length,
        unknownQualityCount: scored.filter(item => !item.qualityApplied).length,
      },
    });
  } catch {
    // Shadow observation is best-effort and must never fail the existing recommendation endpoint.
  }
}
