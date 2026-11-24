import { describe, expect, it } from "vitest";
import {
  CrawlAiModerationPolicySchema,
  DEFAULT_CRAWL_AI_MODERATION_POLICY,
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
      autoApproveConfidence: 0.98,
      rejectConfidence: 0.90,
    }).success).toBe(false);
    expect(CrawlAiModerationPolicySchema.safeParse({
      maxAiReviewsPerRun: 1000,
    }).success).toBe(false);
  });
});
