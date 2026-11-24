export interface RiskIntelEvidence {
  sourceId: string;
  providerGroup: string;
  evidenceId: string;
  category: "malware" | "phishing" | "fraud" | "impersonation" | "policy";
  confidence: number;
  observedAt: number;
  expiresAt: number;
}
export interface RiskEvidencePolicy {
  trustedSourceIds: readonly string[];
  minimumIndependentProviders?: number;
  minimumConfidence?: number;
  maximumAgeMs?: number;
}
export type RiskEvidenceDecision = "no_signal" | "review_required" | "corroborated_risk";
export interface RiskEvidenceAssessment {
  decision: RiskEvidenceDecision;
  independentProviderCount: number;
  evidenceIds: string[];
  categories: string[];
}

/** Evidence aggregator only: never blocks, deletes or unpublishes a site. */
export function assessRiskEvidence(
  evidence: readonly RiskIntelEvidence[],
  policy: RiskEvidencePolicy,
  now = Date.now(),
): RiskEvidenceAssessment {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("now 无效");
  const trusted = new Set(policy.trustedSourceIds);
  const minProviders = policy.minimumIndependentProviders ?? 2;
  const minConfidence = policy.minimumConfidence ?? 0.9;
  const maxAge = policy.maximumAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  if (!Number.isInteger(minProviders) || minProviders < 2) throw new RangeError("minimumIndependentProviders 不得低于 2");
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw new RangeError("minimumConfidence 必须在 0–1 之间");
  if (!Number.isFinite(maxAge) || maxAge <= 0) throw new RangeError("maximumAgeMs 必须大于 0");
  const valid = evidence.filter(item =>
    trusted.has(item.sourceId) && !!item.providerGroup && !!item.evidenceId &&
    Number.isFinite(item.confidence) && item.confidence >= minConfidence && item.confidence <= 1 &&
    Number.isFinite(item.observedAt) && item.observedAt <= now && now - item.observedAt <= maxAge &&
    Number.isFinite(item.expiresAt) && item.expiresAt > now
  );
  const byProvider = new Map<string, RiskIntelEvidence>();
  for (const item of valid) {
    const prior = byProvider.get(item.providerGroup);
    if (!prior || item.confidence > prior.confidence) byProvider.set(item.providerGroup, item);
  }
  const unique = [...byProvider.values()];
  const decision: RiskEvidenceDecision = unique.length >= minProviders ? "corroborated_risk" : unique.length ? "review_required" : "no_signal";
  return {
    decision,
    independentProviderCount: unique.length,
    evidenceIds: unique.map(item => item.evidenceId).sort(),
    categories: [...new Set(unique.map(item => item.category))].sort(),
  };
}
