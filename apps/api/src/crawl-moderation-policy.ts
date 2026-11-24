import { createHash } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "./context.ts";

export const CRAWL_AI_MODERATION_POLICY_KEY = "crawl.ai_moderation.policy.v1";

export const CrawlAiModerationPolicySchema = z.object({
  enabled: z.boolean().default(false),
  // auto_approve 由服务端全量金标评测门槛控制；默认始终为 shadow。
  mode: z.enum(["shadow", "auto_approve"]).default("shadow"),
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


export interface CrawlAiAutoApprovalGate {
  eligible: boolean;
  reason: string;
  model: string;
  datasetVersion: string | null;
  sampleSize: number;
  exactMatchRate: number | null;
  approvePrecision: number | null;
  riskRecall: number | null;
  riskPositiveSupport: number;
  riskFalseNegatives: number;
  evaluatedAt: number | null;
}

/**
 * Automatic approval is a release-gated action, not a configurable confidence
 * threshold alone. It requires a current full goldset evaluation for this exact
 * model and exact label snapshot. Risky/uncertain candidates are never auto-rejected.
 */
export async function getCrawlAiAutoApprovalGate(
  ctx: AppContext,
  model: string,
  now = Date.now(),
): Promise<CrawlAiAutoApprovalGate> {
  const blocked = (reason: string, sampleSize = 0, datasetVersion: string | null = null): CrawlAiAutoApprovalGate => ({
    eligible: false, reason, model, datasetVersion, sampleSize,
    exactMatchRate: null, approvePrecision: null, riskRecall: null,
    riskPositiveSupport: 0, riskFalseNegatives: 0, evaluatedAt: null,
  });
  const rows = await ctx.repo.raw(
    "SELECT id, final_label, final_risk FROM crawl_moderation_gold_cases " +
      "WHERE status='gold_ready' ORDER BY created_at ASC,id ASC LIMIT 5001",
  );
  if (rows.length < 100) return blocked("goldset_below_100", rows.length);
  if (rows.length > 4999) return blocked("goldset_exceeds_4999", rows.length);
  const valid = rows.filter(row =>
    ["approve", "reject", "review"].includes(String(row.final_label)) &&
    (row.final_risk === true || row.final_risk === false || row.final_risk === 0 || row.final_risk === 1),
  );
  if (valid.length !== rows.length) return blocked("goldset_has_invalid_labels", rows.length);
  const datasetVersion = createHash("sha256")
    .update(valid.map(row => String(row.id) + ":" + String(row.final_label) + ":" + String(Boolean(row.final_risk))).join("|"))
    .digest("hex");
  const evaluations = await ctx.repo.raw(
    "SELECT sample_size, metrics_json, created_at FROM crawl_moderation_model_evaluations " +
      "WHERE model=? AND dataset_version=? ORDER BY created_at DESC,id DESC LIMIT 1",
    [model, datasetVersion],
  );
  const evaluation = evaluations[0];
  if (!evaluation) return blocked("no_full_dataset_evaluation", rows.length, datasetVersion);

  let metrics: Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(evaluation.metrics_json ?? "{}")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return blocked("evaluation_metrics_invalid", rows.length, datasetVersion);
    }
    metrics = parsed as Record<string, unknown>;
  } catch {
    return blocked("evaluation_metrics_invalid", rows.length, datasetVersion);
  }
  const perLabel = metrics.perLabel && typeof metrics.perLabel === "object"
    ? metrics.perLabel as Record<string, unknown> : {};
  const approve = perLabel.approve && typeof perLabel.approve === "object"
    ? perLabel.approve as Record<string, unknown> : {};
  const risk = metrics.riskDetection && typeof metrics.riskDetection === "object"
    ? metrics.riskDetection as Record<string, unknown> : {};
  const alerts = Array.isArray(metrics.alerts) ? metrics.alerts : [];
  const sampleSize = Number(evaluation.sample_size ?? 0);
  const exactMatchRate = Number.isFinite(Number(metrics.exactMatchRate)) ? Number(metrics.exactMatchRate) : null;
  const approvePrecision = approve.precision == null ? null : Number(approve.precision);
  const riskRecall = risk.recall == null ? null : Number(risk.recall);
  const riskPositiveSupport = Number(risk.support ?? risk.positiveSupport ?? 0);
  const riskFalseNegatives = Number(risk.falseNegatives ?? 0);
  const evaluatedAt = Number(evaluation.created_at ?? 0);
  const hasCriticalAlert = alerts.some(alert =>
    !!alert && typeof alert === "object" && (alert as Record<string, unknown>).severity === "critical",
  );
  const fresh = Number.isFinite(evaluatedAt) && evaluatedAt > 0 &&
    now - evaluatedAt <= 30 * 24 * 60 * 60 * 1000 && evaluatedAt <= now + 5 * 60 * 1000;
  let reason = "eligible";
  if (sampleSize !== valid.length || sampleSize < 100) reason = "evaluation_sample_mismatch";
  else if (!fresh) reason = "evaluation_stale";
  else if (exactMatchRate === null || exactMatchRate < 0.95) reason = "exact_match_below_0_95";
  else if (approvePrecision === null || !Number.isFinite(approvePrecision) || approvePrecision < 0.99) reason = "approve_precision_below_0_99";
  else if (riskPositiveSupport < 10) reason = "risk_positive_support_below_10";
  else if (riskRecall === null || !Number.isFinite(riskRecall) || riskRecall < 0.99) reason = "risk_recall_below_0_99";
  else if (riskFalseNegatives !== 0) reason = "risk_false_negatives_present";
  else if (hasCriticalAlert) reason = "critical_evaluation_alert";
  return {
    eligible: reason === "eligible", reason, model, datasetVersion, sampleSize,
    exactMatchRate, approvePrecision, riskRecall, riskPositiveSupport, riskFalseNegatives,
    evaluatedAt: fresh ? evaluatedAt : null,
  };
}

export function shouldAutoApproveCrawlCandidate(
  decision: { verdict: string; confidence: number; qualityScore: number; risks: readonly string[] },
  policy: CrawlAiModerationPolicy,
  url: string,
): boolean {
  return policy.enabled &&
    policy.mode === "auto_approve" &&
    decision.verdict === "auto_approve" &&
    Number.isFinite(decision.confidence) &&
    decision.confidence >= policy.autoApproveConfidence &&
    Number.isFinite(decision.qualityScore) &&
    decision.qualityScore >= policy.minQualityScore &&
    decision.risks.length > 0 &&
    decision.risks.every(risk => risk === "none") &&
    (!policy.requireHttps || url.startsWith("https://"));
}
