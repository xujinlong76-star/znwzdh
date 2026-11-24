import { z } from "zod";
import type { AppContext } from "./context.ts";

export const CRAWL_AI_MODERATION_POLICY_KEY = "crawl.ai_moderation.policy.v1";

export const CrawlAiModerationPolicySchema = z.object({
  enabled: z.boolean().default(false),
  // 当前仅开放 shadow；auto 必须等待人工金标评估和安全入库闭环。
  mode: z.literal("shadow").default("shadow"),
  autoApproveConfidence: z.number().min(0.5).max(1).default(0.93),
  rejectConfidence: z.number().min(0.5).max(1).default(0.97),
  minQualityScore: z.number().int().min(0).max(100).default(70),
  maxExcerptChars: z.number().int().min(200).max(12_000).default(6000),
  maxAiReviewsPerRun: z.number().int().min(1).max(25).default(5),
  requireHttps: z.boolean().default(false),
}).refine(value => value.rejectConfidence >= value.autoApproveConfidence, {
  message: "高风险拒绝阈值不能低于自动通过置信度",
  path: ["rejectConfidence"],
});

export type CrawlAiModerationPolicy = z.infer<typeof CrawlAiModerationPolicySchema>;

export const DEFAULT_CRAWL_AI_MODERATION_POLICY: CrawlAiModerationPolicy =
  CrawlAiModerationPolicySchema.parse({});

export async function loadCrawlAiModerationPolicy(ctx: AppContext): Promise<CrawlAiModerationPolicy> {
  const stored = await ctx.repo.getSystemState<unknown>(CRAWL_AI_MODERATION_POLICY_KEY);
  if (stored == null) return DEFAULT_CRAWL_AI_MODERATION_POLICY;
  return CrawlAiModerationPolicySchema.parse(stored);
}
