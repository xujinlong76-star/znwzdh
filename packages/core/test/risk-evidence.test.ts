import { describe, expect, it } from "vitest";
import { assessRiskEvidence, type RiskIntelEvidence } from "../src/risk-evidence.ts";
const now = 1_800_000_000_000;
const evidence: RiskIntelEvidence[] = [
  { sourceId: "feed-a", evidenceId: "a-1", category: "phishing", confidence: 0.99, observedAt: now - 1000, expiresAt: now + 10000 },
  { sourceId: "feed-a-secondary", evidenceId: "a-2", category: "malware", confidence: 0.98, observedAt: now - 1000, expiresAt: now + 10000 },
  { sourceId: "feed-b", evidenceId: "b-1", category: "phishing", confidence: 0.96, observedAt: now - 1000, expiresAt: now + 10000 },
];
describe("risk intelligence evidence aggregation", () => {
  const sameVendor = { providerGroupBySourceId: { "feed-a": "vendor-a", "feed-a-secondary": "vendor-a" } };
  it("requires independent trusted providers and retains multiple evidence categories", () => {
    expect(assessRiskEvidence(evidence, sameVendor, now).decision).toBe("review_required");
    const result = assessRiskEvidence(evidence, { providerGroupBySourceId: { ...sameVendor.providerGroupBySourceId, "feed-b": "vendor-b" } }, now);
    expect(result.decision).toBe("corroborated_risk");
    expect(result.categories).toEqual(["malware", "phishing"]);
    expect(result.independentProviderCount).toBe(2);
  });
  it("ignores stale, expired, future and untrusted evidence", () => {
    const result = assessRiskEvidence([{ ...evidence[0]!, observedAt: now - 99_000_000 }], { providerGroupBySourceId: { "feed-a": "vendor-a" }, maximumAgeMs: 1000 }, now);
    expect(result.decision).toBe("no_signal");
  });
});
