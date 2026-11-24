import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CrawlAiModerationPolicySchema,
  DEFAULT_CRAWL_AI_MODERATION_POLICY,
  getCrawlAiAutoApprovalGate,
  shouldAutoApproveCrawlCandidate,
} from "../src/crawl-moderation-policy.ts";

describe("crawl AI moderation policy", () => {
  it("defaults to disabled shadow mode", () => {
    expect(DEFAULT_CRAWL_AI_MODERATION_POLICY.enabled).toBe(false);
    expect(DEFAULT_CRAWL_AI_MODERATION_POLICY.mode).toBe("shadow");
    expect(CrawlAiModerationPolicySchema.parse({}).maxAiReviewsPerRun).toBe(5);
  });

  it("validates thresholds and bounded worker cost controls", () => {
    expect(CrawlAiModerationPolicySchema.safeParse({
      enabled: true,
      mode: "shadow",
      autoApproveConfidence: 0.94,
      rejectConfidence: 0.98,
      minQualityScore: 75,
      maxExcerptChars: 5000,
      maxAiReviewsPerRun: 8,
      requireHttps: true,
    }).success).toBe(true);
    expect(CrawlAiModerationPolicySchema.safeParse({
      enabled: true,
      mode: "auto",
    }).success).toBe(false);
    expect(CrawlAiModerationPolicySchema.safeParse({
      enabled: true,
      mode: "auto_approve",
    }).success).toBe(true);
    expect(CrawlAiModerationPolicySchema.safeParse({
      autoApproveConfidence: 0.98,
      rejectConfidence: 0.90,
    }).success).toBe(false);
    expect(CrawlAiModerationPolicySchema.safeParse({
      maxAiReviewsPerRun: 1000,
    }).success).toBe(false);
  });
});


describe("crawl AI auto-approval gate", () => {
  const now = 1_800_000_000_000;
  const goldRows = Array.from({ length: 100 }, (_, i) => ({
    id: `gold-${String(i).padStart(3, "0")}`,
    final_label: i % 2 === 0 ? "approve" : "reject",
    final_risk: i % 2 === 1,
  }));
  const datasetVersion = createHash("sha256")
    .update(goldRows.map(row => `${row.id}:${row.final_label}:${String(Boolean(row.final_risk))}`).join("|"))
    .digest("hex");

  const makeContext = (metrics: Record<string, unknown>, sampleSize = 100, createdAt = now - 1000) => ({
    repo: {
      raw: async (sql: string) => sql.includes("crawl_moderation_gold_cases")
        ? goldRows
        : [{ sample_size: sampleSize, metrics_json: JSON.stringify(metrics), created_at: createdAt }],
    },
  });

  const goodMetrics = {
    exactMatchRate: 1,
    perLabel: { approve: { precision: 1 } },
    riskDetection: { recall: 1, positiveSupport: 50, falseNegatives: 0 },
    alerts: [],
  };

  it("only opens after a fresh full 100-case evaluation for the exact dataset and model", async () => {
    const gate = await getCrawlAiAutoApprovalGate(makeContext(goodMetrics) as never, "model-x", now);
    expect(gate.eligible).toBe(true);
    expect(gate.sampleSize).toBe(100);
    expect(gate.datasetVersion).toBe(datasetVersion);

    const stale = await getCrawlAiAutoApprovalGate(makeContext(goodMetrics, 100, now - 31 * 24 * 60 * 60 * 1000) as never, "model-x", now);
    expect(stale.eligible).toBe(false);
    expect(stale.reason).toBe("evaluation_stale");

    const missedRisk = await getCrawlAiAutoApprovalGate(makeContext({
      ...goodMetrics,
      riskDetection: { recall: 0.98, positiveSupport: 50, falseNegatives: 1 },
    }) as never, "model-x", now);
    expect(missedRisk.eligible).toBe(false);
    expect(missedRisk.reason).toBe("risk_recall_below_0_99");
  });

  it("keeps automatic approval limited to high-confidence, high-quality, risk-free HTTPS candidates", () => {
    const policy = CrawlAiModerationPolicySchema.parse({
      enabled: true, mode: "auto_approve", autoApproveConfidence: 0.98,
      minQualityScore: 90, requireHttps: true,
    });
    const decision = { verdict: "auto_approve", confidence: 0.99, qualityScore: 95, risks: ["none"] };
    expect(shouldAutoApproveCrawlCandidate(decision, policy, "https://example.com")).toBe(true);
    expect(shouldAutoApproveCrawlCandidate({ ...decision, risks: ["phishing"] }, policy, "https://example.com")).toBe(false);
    expect(shouldAutoApproveCrawlCandidate({ ...decision, confidence: 0.9 }, policy, "https://example.com")).toBe(false);
    expect(shouldAutoApproveCrawlCandidate(decision, policy, "http://example.com")).toBe(false);
  });
});
