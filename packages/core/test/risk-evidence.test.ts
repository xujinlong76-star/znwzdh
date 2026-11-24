import { describe, expect, it } from "vitest";
import { assessRiskEvidence, type RiskIntelEvidence } from "../src/risk-evidence.ts";

const now = 1_800_000_000_000;
const evidence: RiskIntelEvidence[] = [
  { sourceId: "feed-a", providerGroup: "vendor-a", evidenceId: "a-1", category: "phishing", confidence: 0.99, observedAt: now - 1000, expiresAt: now + 10000 },
  { sourceId: "feed-a-secondary", providerGroup: "vendor-a", evidenceId: "a-2", category: "malware", confidence: 0.98, observedAt: now - 1000, expiresAt: now + 10000 },
  { sourceId: "feed-b", providerGroup: "vendor-b", evidenceId: "b-1", category: "phishing", confidence: 0.96, observedAt: now - 1000, expiresAt: now + 10000 },
];

describe("risk intelligence evidence aggregation", () => {
  it("requires independent trusted providers for corroborated risk", () => {
    expect(assessRiskEvidence(evidence, { trustedSourceIds: ["feed-a", "feed-a-secondary"] }, now).decision).toBe("review_required");
    expect(assessRiskEvidence(evidence, { trustedSourceIds: ["feed-a", "feed-a-secondary", "feed-b"] }, now).decision).toBe("corroborated_risk");
  });
  it("ignores stale, expired, future and untrusted evidence", () => {
    const result = assessRiskEvidence([{ ...evidence[0]!, observedAt: now - 99_000_000 }], { trustedSourceIds: ["feed-a"], maximumAgeMs: 1000 }, now);
    expect(result.decision).toBe("no_signal");
  });
});
