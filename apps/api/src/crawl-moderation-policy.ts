/**
 * 爬虫 AI 审核策略（crawl moderation policy）的唯一取值出口。
 *
 * 现状（2026-11-24 复核）：读取方只有 routes/crawl-operations.ts 的自动评测入口
 * （moderation-model-evaluations/auto），策略字段作为阈值进入 moderateSiteWithAi。
 * 持久化与 GET/PUT /api/admin/crawl-moderation/policy 端点尚未接入（对应表结构
 * 未入库，另一条工作线在途）；当前策略即内置默认值。
 *
 * 默认值与管理台 DEFAULT_POLICY 逐字一致
 * （apps/web-overlay/src/app/admin/crawl-ops/page.tsx）——接入持久化时只改本文件，
 * 所有调用方都从这里取值，不各自造默认值。
 */

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

/**
 * 读取当前生效的审核策略。持久化未接入前恒返回默认值；
 * 形参保留 ctx 以兼容将来从 repo 读配置的接入方式（调用方已按此签名调用）。
 */
export async function loadCrawlAiModerationPolicy(
  _ctx: unknown,
): Promise<CrawlAiModerationPolicy> {
  return { ...DEFAULT_CRAWL_MODERATION_POLICY };
}
