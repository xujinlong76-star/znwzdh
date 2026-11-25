/**
 * 爬虫 AI 审核策略（crawl moderation policy）的唯一取值出口。
 *
 * 持久化（2026-11-25 接入）：策略存 system_states KV（key 见下方常量），
 * GET/PUT /api/admin/crawl-moderation/policy 走 routes/crawl-operations.ts。
 * 读取方（routes/crawl-operations.ts 自动评测入口）统一走 loadCrawlAiModerationPolicy，
 * 不各自造默认值。DB 无记录或值非法时回退内置默认值，保证零配置可用。
 */

import { z } from "zod";
import type { AppContext } from "./context.ts";

export interface CrawlAiModerationPolicy {
  enabled: boolean;
  mode: "shadow";
  autoApproveConfidence: number;
  rejectConfidence: number;
  minQualityScore: number;
  maxExcerptChars: number;
  maxAiReviewsPerRun: number;
  requireHttps: boolean;
}

export const DEFAULT_CRAWL_MODERATION_POLICY: CrawlAiModerationPolicy = {
  enabled: false,
  mode: "shadow",
  autoApproveConfidence: 0.93,
  rejectConfidence: 0.97,
  minQualityScore: 70,
  maxExcerptChars: 6000,
  maxAiReviewsPerRun: 5,
  requireHttps: false,
};

/** system_states 中本策略的 KV 键（与 ai.llm.config.v1 同一张表）。 */
export const CRAWL_MODERATION_POLICY_KEY = "crawl.moderation.policy.v1";

/** PUT 入参契约：字段齐全、范围受限、拒绝未知键。 */
export const CrawlModerationPolicyInputSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.literal("shadow"),
    autoApproveConfidence: z.number().min(0).max(1),
    rejectConfidence: z.number().min(0).max(1),
    minQualityScore: z.number().min(0).max(100),
    maxExcerptChars: z.number().int().min(100).max(100000),
    maxAiReviewsPerRun: z.number().int().min(1).max(100),
    requireHttps: z.boolean(),
  })
  .strict()
  .refine((p) => p.rejectConfidence >= p.autoApproveConfidence, {
    message: "rejectConfidence 不得小于 autoApproveConfidence",
    path: ["rejectConfidence"],
  });

export type CrawlModerationPolicyInput = z.infer<typeof CrawlModerationPolicyInputSchema>;

/** 读取当前生效的审核策略（DB 覆盖优先，非法/缺失回退默认值）。 */
export async function loadCrawlAiModerationPolicy(
  ctx: unknown,
): Promise<CrawlAiModerationPolicy> {
  try {
    const repo = (ctx as AppContext | undefined)?.repo;
    if (!repo) return { ...DEFAULT_CRAWL_MODERATION_POLICY };
    const raw = await repo.getSystemState<unknown>(CRAWL_MODERATION_POLICY_KEY);
    if (raw == null) return { ...DEFAULT_CRAWL_MODERATION_POLICY };
    const parsed = CrawlModerationPolicyInputSchema.safeParse(raw);
    if (!parsed.success) return { ...DEFAULT_CRAWL_MODERATION_POLICY };
    return { ...parsed.data };
  } catch {
    // 存储层暂时不可用（例如未迁移的存量库）时退回默认值，审核链路不应因读配置失败而中断。
    return { ...DEFAULT_CRAWL_MODERATION_POLICY };
  }
}

/** 保存策略并写审计；返回回读后的生效值。 */
export async function saveCrawlAiModerationPolicy(
  ctx: AppContext,
  input: CrawlModerationPolicyInput,
  actor: string,
  ip?: string,
): Promise<CrawlAiModerationPolicy> {
  await ctx.repo.setSystemState(CRAWL_MODERATION_POLICY_KEY, input);
  await ctx.repo.audit({
    actor,
    action: "crawl.moderation_policy.set",
    target: CRAWL_MODERATION_POLICY_KEY,
    diff: input,
    ip,
  });
  return loadCrawlAiModerationPolicy(ctx);
}
