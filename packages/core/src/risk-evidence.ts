export interface RiskIntelEvidence {
  sourceId: string;
  evidenceId: string;
  category: "malware" | "phishing" | "fraud" | "impersonation" | "policy";
  confidence: number;
  observedAt: number;
  expiresAt: number;
}
export interface RiskEvidencePolicy {
  /** Source allow-list and source→provider mapping are controlled by server configuration, not feed payload. */
  providerGroupBySourceId: Readonly<Record<string, string>>;
  minimumIndependentProviders?: number;
  minimumConfidence?: number;
  maximumAgeMs?: number;
}
export type RiskEvidenceDecision = "no_signal" | "review_required" | "corroborated_risk";
export interface RiskEvidenceAssessment { decision: RiskEvidenceDecision; independentProviderCount: number; evidenceIds: string[]; categories: string[]; }

/** Evidence aggregator only: never blocks, deletes or unpublishes a site. */
export function assessRiskEvidence(evidence: readonly RiskIntelEvidence[], policy: RiskEvidencePolicy, now = Date.now()): RiskEvidenceAssessment {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("now 无效");
  const minProviders = policy.minimumIndependentProviders ?? 2, minConfidence = policy.minimumConfidence ?? 0.9;
  const maxAge = policy.maximumAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  if (!Number.isInteger(minProviders) || minProviders < 2) throw new RangeError("minimumIndependentProviders 不得低于 2");
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw new RangeError("minimumConfidence 必须在 0–1 之间");
  if (!Number.isFinite(maxAge) || maxAge <= 0) throw new RangeError("maximumAgeMs 必须大于 0");
  const trusted = evidence.filter(item => {
    const provider = policy.providerGroupBySourceId[item.sourceId];
    return !!provider && !!item.evidenceId && Number.isFinite(item.confidence) && item.confidence >= minConfidence && item.confidence <= 1 &&
      Number.isFinite(item.observedAt) && item.observedAt <= now && now - item.observedAt <= maxAge &&
      Number.isFinite(item.expiresAt) && item.expiresAt > now;
  });
  const unique = [...new Map(trusted.map(item => [`${item.sourceId}:${item.evidenceId}`, item])).values()];
  const providers = new Set(unique.map(item => policy.providerGroupBySourceId[item.sourceId]!));
  const decision: RiskEvidenceDecision = providers.size >= minProviders ? "corroborated_risk" : providers.size ? "review_required" : "no_signal";
  return {
    decision, independentProviderCount: providers.size,
    evidenceIds: unique.map(item => item.evidenceId).sort(),
    categories: [...new Set(unique.map(item => item.category))].sort(),
  };
}
