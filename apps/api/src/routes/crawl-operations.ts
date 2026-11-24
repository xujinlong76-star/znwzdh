import type { FastifyPluginAsync } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { evaluateSiteModerationGoldSet, moderateSiteWithAi } from "@navhub/ai";
import {
  countSiteDiscoveryCandidates, getSiteDiscoveryCandidateForUpdate,
  recordCrawlAiModerationDecision, listCrawlAiModerationDecisions,
  createCrawlModerationGoldCase, listCrawlModerationGoldCases, getCrawlModerationGoldCase,
  annotateCrawlModerationGoldCase, adjudicateCrawlModerationGoldCase, listCrawlModerationGoldAnnotations,
  listSiteDiscoveryCandidates, reviewSiteDiscoveryCandidate,
} from "@navhub/store";
import type { AppContext } from "../context.ts";
import { resolveLlm, llmProviderReady } from "../llm-config.ts";
import { reserveLlmQuota, settleLlmQuota, replyQuotaBlocked } from "../llm-quota.ts";
import { callLlm } from "../llm-usage.ts";
import { loadCrawlAiModerationPolicy } from "../crawl-moderation-policy.ts";

/** 对正式金标集做稳定抽样：相同数据集重复运行时选中相同样本。 */
export function selectGoldEvaluationSample<T extends { id: unknown }>(rows: readonly T[], limit = 20): T[] {
  const bounded = Math.max(1, Math.min(20, Math.floor(limit)));
  return rows.map(row => ({ row, key: createHash("sha256").update(String(row.id)).digest("hex") }))
    .sort((a,b) => a.key.localeCompare(b.key) || String(a.row.id).localeCompare(String(b.row.id)))
    .slice(0,bounded).map(item => item.row);
}

/** 把审核引擎输出映射为离线评测标签；风险字段只来自模型风险类别。 */
export function moderationVerdictToPrediction(result: { verdict: "auto_approve" | "reject" | "manual_review"; risks: readonly string[] }):
  { actual: "approve" | "reject" | "review"; actualRisk: boolean } {
  return {
    actual: result.verdict === "auto_approve" ? "approve" : result.verdict === "reject" ? "reject" : "review",
    actualRisk: result.risks.some(risk => risk !== "none"),
  };
}
/** 输出不含网页正文/URL 的错分摘要，便于审核员定位模型错误样本。 */\nexport function buildModerationErrorAnalysis(cases: Array<{id:string;expected:"approve"|"reject"|"review";actual:"approve"|"reject"|"review";expectedRisk?:boolean;actualRisk?:boolean}>) {\n  const groups = new Map<string,{expected:string;actual:string;count:number;sampleIds:string[]}>();\n  const riskFalseNegativeIds:string[] = [];\n  const riskFalsePositiveIds:string[] = [];\n  let labelMismatchCount = 0, riskMismatchCount = 0;\n  for (const item of cases) {\n    if (item.expected !== item.actual) {\n      labelMismatchCount++;\n      const key = item.expected + "->" + item.actual;\n      const group = groups.get(key) ?? {expected:item.expected,actual:item.actual,count:0,sampleIds:[]};\n      group.count++; if (group.sampleIds.length < 20) group.sampleIds.push(item.id);\n      groups.set(key,group);\n    }\n    if (item.expectedRisk !== undefined && item.actualRisk !== undefined && item.expectedRisk !== item.actualRisk) {\n      riskMismatchCount++;\n      if (item.expectedRisk && !item.actualRisk && riskFalseNegativeIds.length < 50) riskFalseNegativeIds.push(item.id);\n      if (!item.expectedRisk && item.actualRisk && riskFalsePositiveIds.length < 50) riskFalsePositiveIds.push(item.id);\n    }\n  }\n  return { labelMismatchCount, riskMismatchCount, confusionGroups:[...groups.values()].sort((a,b)=>b.count-a.count||a.expected.localeCompare(b.expected)||a.actual.localeCompare(b.actual)),\n    riskFalseNegativeIds, riskFalsePositiveIds, samplesTruncated: labelMismatchCount > 20 || riskMismatchCount > 100 };\n}\n/** 透明、可解释的初筛分数；只用于排序辅助，不自动批准或拒绝。 */
export function scoreCrawlCandidate(input: {
  url: string; title?: string | null; description?: string | null;
  evidence?: Record<string, unknown>;
}): { score: number; reasons: string[] } {
  let score = 35;
  const reasons: string[] = [];
  const evidence = input.evidence ?? {};
  const tokenCount = Number(evidence.tokenCount ?? 0);
  if (input.title?.trim()) { score += 15; reasons.push("存在页面标题"); }
  else { score -= 12; reasons.push("缺少页面标题"); }
  if (input.description?.trim()) { score += 10; reasons.push("存在页面描述"); }
  else { score -= 5; reasons.push("缺少页面描述"); }
  if (tokenCount >= 300) { score += 20; reasons.push("正文信息量较充分"); }
  else if (tokenCount >= 80) { score += 10; reasons.push("正文达到最低信息量"); }
  else { score -= 15; reasons.push("正文信息量偏低"); }
  if (evidence.exactDuplicateOf) { score -= 30; reasons.push("存在完全重复页面证据"); }
  const near = Array.isArray(evidence.nearDuplicateCandidates) ? evidence.nearDuplicateCandidates.length : 0;
  if (near > 0) { score -= Math.min(15, near * 3); reasons.push("存在近重复页面候选"); }
  try {
    if (new URL(input.url).protocol === "https:") { score += 5; reasons.push("使用 HTTPS"); }
  } catch { score -= 20; reasons.push("URL 格式异常"); }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/** 按类别、风险线索、来源和质量区间做轮转抽样，避免单一分层占满整批。 */
export function selectStratifiedCrawlCandidates<T extends { category: string; source: string; riskBand: string; qualityBand: string; score: number }>(
  items: T[], limit: number,
): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = [item.category,item.riskBand,item.source,item.qualityBand].join("|");
    const bucket = buckets.get(key) ?? []; bucket.push(item); buckets.set(key,bucket);
  }
  for (const bucket of buckets.values()) bucket.sort((a,b) => b.score-a.score);
  const keys = [...buckets.keys()].sort((a,b) => (buckets.get(a)?.length ?? 0) - (buckets.get(b)?.length ?? 0) || a.localeCompare(b));
  const selected: T[] = [];
  while (selected.length < Math.max(0,Math.min(100,Math.floor(limit)))) {
    let progressed = false;
    for (const key of keys) {
      const item = buckets.get(key)?.shift();
      if (!item) continue;
      selected.push(item); progressed = true;
      if (selected.length >= Math.max(0,Math.min(100,Math.floor(limit)))) break;
    }
    if (!progressed) break;
  }
  return selected;
}

function moderationEvidenceOf(evidence: Record<string, unknown>): Record<string, unknown> | null {
  const raw = evidence.aiModeration;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const status = ["completed", "error", "quota_blocked"].includes(String(value.status)) ? String(value.status) : "unknown";
  const verdict = ["auto_approve", "reject", "manual_review"].includes(String(value.verdict)) ? String(value.verdict) : null;
  const confidence = Number(value.confidence);
  const qualityScore = Number(value.qualityScore);
  return {
    mode: value.mode === "shadow" ? "shadow" : "unknown",
    status,
    verdict,
    confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
    qualityScore: Number.isFinite(qualityScore) && qualityScore >= 0 && qualityScore <= 100 ? qualityScore : null,
    risks: Array.isArray(value.risks) ? value.risks.filter((x): x is string => typeof x === "string").slice(0, 12) : [],
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((x): x is string => typeof x === "string").map(x => x.slice(0, 240)).slice(0, 8) : [],
    model: typeof value.model === "string" ? value.model.slice(0, 120) : null,
    policyVersion: typeof value.policyVersion === "string" ? value.policyVersion.slice(0, 80) : null,
    reviewedAt: Number.isFinite(Number(value.reviewedAt)) ? Number(value.reviewedAt) : null,
  };
}

export const crawlOperationsRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;
  app.get("/api/admin/crawl/overview", { config: { scope: "admin", cache: { maxAge: 0 } } }, async () => {
    const [tasks, sources, candidates, hosts, recent, moderationRows, ledgerCounts, overturnedRows] = await Promise.all([
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM crawl_tasks GROUP BY status"),
      ctx.repo.raw("SELECT enabled, COUNT(*) AS total FROM crawl_sources GROUP BY enabled"),
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM site_discovery_candidates GROUP BY status"),
      ctx.repo.raw("SELECT host, COUNT(*) AS total FROM crawl_tasks GROUP BY host ORDER BY total DESC LIMIT 20"),
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM crawl_tasks WHERE updated_at >= ? GROUP BY status", [Date.now()-24*60*60_000]),
      ctx.repo.raw("SELECT evidence_json FROM site_discovery_candidates WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 1000", [Date.now()-24*60*60_000]),
      ctx.repo.raw("SELECT decision_source, COUNT(*) AS total FROM crawl_ai_moderation_decisions WHERE created_at >= ? GROUP BY decision_source", [Date.now()-24*60*60_000]),
      ctx.repo.raw("SELECT COUNT(DISTINCT ai.candidate_id) AS total FROM crawl_ai_moderation_decisions ai JOIN crawl_ai_moderation_decisions human ON human.candidate_id = ai.candidate_id AND human.decision_source = 'human' AND human.created_at > ai.created_at WHERE ai.decision_source = 'ai' AND ai.verdict IS NOT NULL AND ((ai.verdict = 'auto_approve' AND human.verdict <> 'approve') OR (ai.verdict = 'reject' AND human.verdict <> 'reject')) AND ai.created_at >= ?", [Date.now()-30*24*60*60_000]),
    ]);
    const countMap = (rows: Array<Record<string, unknown>>, key: string) =>
      Object.fromEntries(rows.map(row => [String(row[key]), Number(row.total ?? 0)]));
    const taskCounts = countMap(tasks, "status");
    const sourceCounts = countMap(sources, "enabled");
    const candidateCounts = countMap(candidates, "status");
    const recentCounts = countMap(recent, "status");
    const aiModeration = { windowHours: 24, sampleSize: moderationRows.length, completed: 0, errors: 0, quotaBlocked: 0,
      verdicts: { auto_approve: 0, reject: 0, manual_review: 0 } };
    for (const row of moderationRows) {
      try {
        const evidence = JSON.parse(String(row.evidence_json ?? "{}")) as Record<string, unknown>;
        const ai = evidence.aiModeration && typeof evidence.aiModeration === "object"
          ? evidence.aiModeration as Record<string, unknown> : null;
        if (!ai) continue;
        if (ai.status === "completed") {
          aiModeration.completed++;
          if (ai.verdict === "auto_approve" || ai.verdict === "reject" || ai.verdict === "manual_review") {
            aiModeration.verdicts[ai.verdict]++;
          }
        } else if (ai.status === "error") aiModeration.errors++;
        else if (ai.status === "quota_blocked") aiModeration.quotaBlocked++;
      } catch { /* 坏证据不影响运营总览 */ }
    }
    const ledger = Object.fromEntries(ledgerCounts.map(row => [String(row.decision_source), Number(row.total ?? 0)]));
    const totalTasks = Object.values(taskCounts).reduce((a,b)=>a+b,0);
    const finished = (taskCounts.done ?? 0) + (taskCounts.dead_letter ?? 0) + (taskCounts.hold_for_review ?? 0);
    return {
      ok: true, generatedAt: Date.now(),
      tasks: { ...taskCounts, total: totalTasks, successRate: finished ? Math.round((taskCounts.done ?? 0)/finished*1000)/10 : null },
      sources: { enabled: sourceCounts.true ?? 0, disabled: sourceCounts.false ?? 0 },
      candidates: candidateCounts,
      last24Hours: recentCounts,
      aiModeration: { ...aiModeration, ledger24h: ledger, humanOverturns30d: Number(overturnedRows[0]?.total ?? 0) },
      busiestHosts: hosts.map(row => ({ host: String(row.host), tasks: Number(row.total) })),
    };
  });

  app.get("/api/admin/crawl/moderation-analytics", { config: { scope: "admin", cache: { maxAge: 0 } } }, async (req, reply) => {
    const parsed = z.object({
      days: z.coerce.number().int().min(1).max(90).default(30),
    }).safeParse(req.query ?? {});
    if (!parsed.success) { reply.code(400); return { ok: false, error: "审核分析时间范围无效" }; }
    const since = Date.now() - parsed.data.days * 24 * 60 * 60_000;
    const rows = await ctx.repo.raw(
      `SELECT COALESCE(model, '(未标记模型)') AS model,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN status = 'quota_blocked' THEN 1 ELSE 0 END) AS quota_blocked,
        AVG(CASE WHEN status = 'completed' THEN confidence ELSE NULL END) AS avg_confidence,
        SUM(CASE WHEN verdict = 'auto_approve' THEN 1 ELSE 0 END) AS auto_approve,
        SUM(CASE WHEN verdict = 'reject' THEN 1 ELSE 0 END) AS reject,
        SUM(CASE WHEN verdict = 'manual_review' THEN 1 ELSE 0 END) AS manual_review
       FROM crawl_ai_moderation_decisions
       WHERE decision_source = 'ai' AND created_at >= ?
       GROUP BY COALESCE(model, '(未标记模型)')
       ORDER BY completed DESC, total DESC
       LIMIT 50`,
      [since],
    );
    return {
      ok: true, days: parsed.data.days, generatedAt: Date.now(),
      models: rows.map(row => {
        const total = Number(row.total ?? 0);
        const completed = Number(row.completed ?? 0);
        return {
          model: String(row.model), total, completed,
          errors: Number(row.errors ?? 0), quotaBlocked: Number(row.quota_blocked ?? 0),
          successRate: total ? Math.round(completed / total * 1000) / 10 : null,
          averageConfidence: row.avg_confidence == null ? null : Number(row.avg_confidence),
          verdicts: {
            autoApprove: Number(row.auto_approve ?? 0),
            reject: Number(row.reject ?? 0),
            manualReview: Number(row.manual_review ?? 0),
          },
        };
      }),
    };
  });

  app.get("/api/admin/crawl/candidates", { config: { scope: "admin", cache: { maxAge: 0 } } }, async (req, reply) => {
    const parsed = z.object({
      status: z.enum(["pending","approved","rejected"]).default("pending"),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    }).safeParse(req.query ?? {});
    if (!parsed.success) { reply.code(400); return { ok: false, error: "审核队列筛选参数无效" }; }
    const items = await listSiteDiscoveryCandidates(ctx.repo, parsed.data);
    const total = await countSiteDiscoveryCandidates(ctx.repo, parsed.data.status);
    return { ok: true, items: items.map(item => {
      const quality = scoreCrawlCandidate({ url: item.url, title: item.title, description: item.description, evidence: item.evidence });
      return { id:item.id,url:item.url,title:item.title,description:item.description,source:item.source,
        status:item.status,discoveredAt:item.discoveredAt,lastSeenAt:item.lastSeenAt,
        duplicateEvidence:{ exact: Boolean(item.evidence.exactDuplicateOf), near: Array.isArray(item.evidence.nearDuplicateCandidates) ? item.evidence.nearDuplicateCandidates.length : 0 },
        quality, aiModeration: moderationEvidenceOf(item.evidence) };
    }), total, limit: parsed.data.limit, offset: parsed.data.offset };
  });


  app.get("/api/admin/crawl/moderation-decisions", { config: { scope: "admin", cache: { maxAge: 0 } } }, async (req, reply) => {
    const parsed = z.object({
      candidateId: z.string().min(1).max(64).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    }).safeParse(req.query ?? {});
    if (!parsed.success) { reply.code(400); return { ok: false, error: "审核历史筛选参数无效" }; }
    const items = await listCrawlAiModerationDecisions(ctx.repo, parsed.data);
    return { ok: true, items: items.map(row => ({
      id: String(row.id), candidateId: String(row.candidate_id),
      decisionSource: String(row.decision_source), mode: String(row.mode),
      status: String(row.status), verdict: row.verdict == null ? null : String(row.verdict),
      confidence: row.confidence == null ? null : Number(row.confidence),
      qualityScore: row.quality_score == null ? null : Number(row.quality_score),
      risks: JSON.parse(String(row.risks_json ?? "[]")),
      reasons: JSON.parse(String(row.reasons_json ?? "[]")),
      model: row.model == null ? null : String(row.model),
      policyVersion: row.policy_version == null ? null : String(row.policy_version),
      actor: row.actor == null ? null : String(row.actor), createdAt: Number(row.created_at),
    })) };
  });

  app.post("/api/admin/crawl/candidates/:id/review", { config: { scope: "admin", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(req.params ?? {});
    const body = z.object({ decision: z.enum(["approve","reject"]), reason: z.string().trim().max(1000).optional() })
      .refine(v => v.decision !== "reject" || Boolean(v.reason?.trim()), "驳回时必须填写原因").safeParse(req.body ?? {});
    if (!params.success || !body.success) { reply.code(400); return { ok:false,error:"审核参数无效",details:!params.success?params.error.issues:body.error.issues }; }
    const reviewer = String(req.auth.actor ?? "admin");
    const result = await ctx.repo.withTransaction(async () => {
      const current = await getSiteDiscoveryCandidateForUpdate(ctx.repo, params.data.id);
      if (!current) return { kind:"missing" as const };
      if (current.status !== "pending") return { kind:"conflict" as const, status:current.status };
      const updated = await reviewSiteDiscoveryCandidate(ctx.repo, {
        id: current.id, status: body.data.decision === "approve" ? "approved" : "rejected",
        reviewer, rejectionReason: body.data.decision === "reject" ? body.data.reason : null,
      });
      if (!updated) return { kind:"conflict" as const, status:"changed" };
      // 审核状态与追加式决策账本必须原子提交，避免出现已审核但历史缺失。
      await recordCrawlAiModerationDecision(ctx.repo, {
        id: randomUUID(), candidateId: updated.id, decisionSource: "human",
        mode: "manual", status: "reviewed", verdict: body.data.decision,
        actor: reviewer, reasons: body.data.reason ? [body.data.reason] : [],
      });
      return { kind:"ok" as const, candidate:updated };
    });
    if (result.kind === "missing") { reply.code(404); return {ok:false,error:"候选不存在"}; }
    if (result.kind === "conflict") { reply.code(409); return {ok:false,error:"候选已被其他审核操作处理",status:result.status}; }
    await ctx.repo.audit({ ip:req.ip,actor:reviewer,actorKind:req.auth.kind,action:"crawl.candidate_review",target:result.candidate.id,
      diff:{decision:body.data.decision,reason:body.data.reason ?? null,previousStatus:"pending"} });
    return {ok:true,candidate:{id:result.candidate.id,status:result.candidate.status,reviewedAt:result.candidate.reviewedAt}};
  });
  const safeGoldText = (value: string | undefined, max: number) => {
    if (value === undefined) return undefined;
    const text = value.trim();
    if (/(https?:\/\/|www\.)/i.test(text) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /\b(?:\+?\d[\d -]{8,}\d)\b/.test(text)) {
      throw new Error("金标文本疑似包含 URL、邮箱或电话号码，请先脱敏");
    }
    return text.slice(0,max);
  };

  const redactGoldText = (value: string | undefined, max: number) => {
    if (!value) return undefined;
    return value
      .replace(/https?:\/\/[^\s<>"']+/gi, "[URL已脱敏]")
      .replace(/\bwww\.[^\s<>"']+/gi, "[URL已脱敏]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已脱敏]")
      .replace(/\b(?:\+?\d[\d .()-]{7,}\d)\b/g, "[电话已脱敏]")
      .replace(/\s+/g, " ").trim().slice(0, max);
  };

  app.post("/api/admin/crawl/moderation-gold-cases/sample-from-candidates",
    { config: { scope: "admin", rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).safeParse(req.body ?? {});
      if (!body.success) { reply.code(400); return { ok: false, error: "抽样数量必须为 1–100" }; }
      const rows = await ctx.repo.raw(
        "SELECT id,url,title,description,category_id,source,evidence_json,discovered_at FROM site_discovery_candidates WHERE status = 'pending' ORDER BY discovered_at DESC,id ASC LIMIT 5000",
      );
      const importedRows = await ctx.repo.raw("SELECT source_fingerprint FROM crawl_moderation_gold_cases WHERE source_fingerprint LIKE 'candidate:%'");
      const imported = new Set(importedRows.map(row => String(row.source_fingerprint)));
      const eligibleCandidates: Array<{ row: Record<string, unknown>; evidence: Record<string, unknown>; score: number; category: string; source: string; riskBand: string; qualityBand: string }> = [];
      let malformed = 0;
      for (const row of rows) {
        let evidence: Record<string, unknown>;
        try {
          const parsedEvidence = JSON.parse(String(row.evidence_json ?? "{}")) as unknown;
          if (!parsedEvidence || typeof parsedEvidence !== "object" || Array.isArray(parsedEvidence)) { malformed++; continue; }
          evidence = parsedEvidence as Record<string, unknown>;
        } catch { malformed++; continue; }
        const fingerprint = "candidate:" + createHash("sha256").update(String(row.id)).digest("hex");
        if (imported.has(fingerprint)) continue;
        const category = String(row.category_id ?? "").trim() || "未分类";
        const source = String(row.source ?? "").trim() || "未知来源";
        const ai = evidence.aiModeration && typeof evidence.aiModeration === "object" && !Array.isArray(evidence.aiModeration)
          ? evidence.aiModeration as Record<string, unknown> : null;
        const risks = ai && Array.isArray(ai.risks) ? ai.risks.filter(value => typeof value === "string" && value.trim()) : [];
        // AI 风险线索只决定抽样分层，不会被写入人工金标标签。
        const riskBand = risks.length ? "risk_hint" : ai?.status === "completed" ? "no_risk_hint" : "unknown";
        const quality = scoreCrawlCandidate({ url: String(row.url ?? ""), title: row.title == null ? null : String(row.title),
          description: row.description == null ? null : String(row.description), evidence });
        const qualityBand = quality.score < 40 ? "low" : quality.score < 70 ? "medium" : "high";
        eligibleCandidates.push({ row, evidence, score: quality.score, category, source, riskBand, qualityBand });
      }
      const selected = selectStratifiedCrawlCandidates(eligibleCandidates, body.data.limit);
      const actor = String(req.auth.actor ?? "admin");
      let created = 0, existing = 0, failed = 0;
      const createdIds: string[] = [];
      for (const item of selected) {
        const candidateId = String(item.row.id);
        const fingerprint = "candidate:" + createHash("sha256").update(candidateId).digest("hex");
        const excerptValue = [item.evidence.sanitizedExcerpt,item.evidence.excerpt,item.evidence.bodyExcerpt,item.evidence.contentExcerpt]
          .find(value => typeof value === "string" && value.trim()) as string | undefined;
        const title = redactGoldText(item.row.title == null ? undefined : String(item.row.title), 200);
        const description = redactGoldText(item.row.description == null ? undefined : String(item.row.description), 1000);
        const sanitizedExcerpt = redactGoldText(excerptValue, 3000);
        if (!title && !description && !sanitizedExcerpt) { failed++; continue; }
        try {
          const result = await ctx.repo.withTransaction(async () => {
            const found = await ctx.repo.raw("SELECT id FROM crawl_moderation_gold_cases WHERE source_fingerprint = ? LIMIT 1", [fingerprint]);
            if (found[0]) return false;
            await createCrawlModerationGoldCase(ctx.repo, { id: randomUUID(), sourceFingerprint: fingerprint, title, description,
              category: item.category, sanitizedExcerpt, createdBy: actor });
            return true;
          });
          if (result) { created++; createdIds.push(candidateId); imported.add(fingerprint); } else existing++;
        } catch {
          const found = await ctx.repo.raw("SELECT id FROM crawl_moderation_gold_cases WHERE source_fingerprint = ? LIMIT 1", [fingerprint]);
          if (found[0]) existing++; else failed++;
        }
      }
      const countBy = (key: "category" | "riskBand" | "source" | "qualityBand") => Object.fromEntries(
        [...selected.reduce((map,item) => map.set(item[key], (map.get(item[key]) ?? 0) + 1), new Map<string,number>())].sort((a,b) => b[1]-a[1]),
      );
      if (createdIds.length) await ctx.repo.audit({ ip: req.ip, actor, actorKind: req.auth.kind,
        action: "crawl.moderation_gold_stratified_import", target: "batch",
        diff: { created: createdIds.length, candidateIds: createdIds.slice(0,100), requested: body.data.limit } });
      return { ok: true, requested: body.data.limit, scanned: rows.length, eligible: eligibleCandidates.length,
        selected: selected.length, created, existing, failed, malformed, distribution: { categories: countBy("category"),
          riskHints: countBy("riskBand"), sources: countBy("source"), qualityBands: countBy("qualityBand") } };
    },
  );
  app.post("/api/admin/crawl/moderation-gold-cases/from-candidate/:id",
    { config: { scope: "admin", rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const params = z.object({ id: z.string().min(1).max(64) }).safeParse(req.params ?? {});
      if (!params.success) { reply.code(400); return { ok: false, error: "候选 ID 无效" }; }
      const candidate = await getSiteDiscoveryCandidateForUpdate(ctx.repo, params.data.id);
      if (!candidate) { reply.code(404); return { ok: false, error: "采集候选不存在" }; }
      const evidence = candidate.evidence ?? {};
      const excerptValue = [evidence.sanitizedExcerpt, evidence.excerpt, evidence.bodyExcerpt, evidence.contentExcerpt]
        .find(value => typeof value === "string" && value.trim()) as string | undefined;
      const title = redactGoldText(candidate.title ?? undefined, 200);
      const description = redactGoldText(candidate.description ?? undefined, 1000);
      const sanitizedExcerpt = redactGoldText(excerptValue, 3000);
      if (!title && !description && !sanitizedExcerpt) {
        reply.code(422); return { ok: false, error: "候选缺少可用于人工判断的标题、描述或摘要" };
      }
      const sourceFingerprint = "candidate:" + createHash("sha256").update(candidate.id).digest("hex");
      const actor = String(req.auth.actor ?? "admin");
      let result: { id: string; created: boolean };
      try {
        result = await ctx.repo.withTransaction(async () => {
          const existing = await ctx.repo.raw(
            "SELECT id FROM crawl_moderation_gold_cases WHERE source_fingerprint = ? LIMIT 1",
            [sourceFingerprint],
          );
          if (existing[0]) return { id: String(existing[0].id), created: false };
          const id = randomUUID();
          await createCrawlModerationGoldCase(ctx.repo, {
            id, sourceFingerprint, title, description,
            category: candidate.categoryId ?? undefined, sanitizedExcerpt,
            createdBy: actor,
          });
          return { id, created: true };
        });
      } catch (error) {
        // 唯一索引兜底并发竞争：若另一请求已完成相同候选导入，则返回既有记录。
        const existing = await ctx.repo.raw(
          "SELECT id FROM crawl_moderation_gold_cases WHERE source_fingerprint = ? LIMIT 1",
          [sourceFingerprint],
        );
        if (!existing[0]) throw error;
        result = { id: String(existing[0].id), created: false };
      }
      if (result.created) {
        await ctx.repo.audit({
          ip: req.ip, actor, actorKind: req.auth.kind,
          action: "crawl.moderation_gold_import_candidate", target: result.id,
          diff: { candidateId: candidate.id, sourceFingerprint },
        });
      }
      reply.code(result.created ? 201 : 200);
      return { ok: true, id: result.id, status: result.created ? "pending" : "already_exists", created: result.created };
    },
  );

  app.get("/api/admin/crawl/moderation-gold-cases", { config: { scope: "admin", cache: { maxAge: 0 } } }, async (req, reply) => {
    const parsed = z.object({status:z.enum(["pending","annotating","needs_adjudication","gold_ready"]).optional(),
      limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100_000).default(0)}).safeParse(req.query ?? {});
    if(!parsed.success){reply.code(400);return {ok:false,error:"金标队列筛选参数无效"};}
    const items=await listCrawlModerationGoldCases(ctx.repo,parsed.data);
    return {ok:true,items:items.map(row=>({id:String(row.id),sourceFingerprint:String(row.source_fingerprint),
      title:row.title==null?null:String(row.title),description:row.description==null?null:String(row.description),
      category:row.category==null?null:String(row.category),sanitizedExcerpt:row.sanitized_excerpt==null?null:String(row.sanitized_excerpt),
      status:String(row.status),annotationCount:Number(row.annotation_count??0),finalLabel:row.final_label==null?null:String(row.final_label),
      finalRisk:row.final_risk==null?null:Boolean(row.final_risk),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)}))};
  });

  app.post("/api/admin/crawl/moderation-gold-cases", {config:{scope:"admin",rateLimit:{max:30,timeWindow:"1 minute"}}}, async(req,reply)=>{
    const parsed=z.object({sourceFingerprint:z.string().regex(/^[a-f0-9]{32,128}$/i),title:z.string().max(200).optional(),
      description:z.string().max(1000).optional(),category:z.string().max(80).optional(),sanitizedExcerpt:z.string().max(3000).optional()}).safeParse(req.body??{});
    if(!parsed.success){reply.code(400);return {ok:false,error:"金标样本参数无效",details:parsed.error.issues};}
    let safe:{title?:string;description?:string;category?:string;sanitizedExcerpt?:string};
    try{safe={title:safeGoldText(parsed.data.title,200),description:safeGoldText(parsed.data.description,1000),
      category:safeGoldText(parsed.data.category,80),sanitizedExcerpt:safeGoldText(parsed.data.sanitizedExcerpt,3000)};}
    catch(error){reply.code(400);return {ok:false,error:error instanceof Error?error.message:"脱敏校验失败"};}
    const actor=String(req.auth.actor??"admin"),id=randomUUID(),now=Date.now();
    await createCrawlModerationGoldCase(ctx.repo,{id,sourceFingerprint:parsed.data.sourceFingerprint,...safe,createdBy:actor,createdAt:now});
    await ctx.repo.audit({ip:req.ip,actor,actorKind:req.auth.kind,action:"crawl.moderation_gold_case_create",target:id,diff:{sourceFingerprint:parsed.data.sourceFingerprint}});
    reply.code(201);return {ok:true,id,status:"pending"};
  });

  app.get("/api/admin/crawl/moderation-gold-assignments/metrics", {config:{scope:"admin",cache:{maxAge:0}}}, async(req) => {
    const actor=String(req.auth.actor??"admin");
    await ctx.repo.run("UPDATE crawl_moderation_gold_assignments SET status='expired' WHERE status='claimed' AND lease_expires_at<=?",[Date.now()]);
    const rows=await ctx.repo.raw("SELECT status,COUNT(*) AS total FROM crawl_moderation_gold_assignments GROUP BY status");
    const mine=await ctx.repo.raw("SELECT COUNT(*) AS total FROM crawl_moderation_gold_assignments WHERE annotator_id=? AND status='claimed' AND lease_expires_at>?",[actor,Date.now()]);
    const counts=Object.fromEntries(rows.map(row=>[String(row.status),Number(row.total??0)]));
    return {ok:true,claimed:counts.claimed??0,completed:counts.completed??0,expired:counts.expired??0,myActive:Number(mine[0]?.total??0)};
  });

  app.post("/api/admin/crawl/moderation-gold-cases/claim", {config:{scope:"admin",rateLimit:{max:30,timeWindow:"1 minute"}}}, async(req,reply)=>{
    const body=z.object({caseId:z.string().uuid().optional(),leaseMinutes:z.coerce.number().int().min(15).max(240).default(120)}).safeParse(req.body??{});
    if(!body.success){reply.code(400);return {ok:false,error:"领取参数无效"};}
    const actor=String(req.auth.actor??"admin");
    const now=Date.now(),expiresAt=now+body.data.leaseMinutes*60_000;
    const result=await ctx.repo.withTransaction(async()=>{
      await ctx.repo.run("UPDATE crawl_moderation_gold_assignments SET status='expired' WHERE status='claimed' AND lease_expires_at<=?",[now]);
      const params:unknown[]=[actor];
      let caseFilter="";
      if(body.data.caseId){caseFilter=" AND c.id=?";params.push(body.data.caseId);}
      else {caseFilter=" AND NOT EXISTS(SELECT 1 FROM crawl_moderation_gold_assignments own WHERE own.case_id=c.id AND own.annotator_id=? AND own.status='claimed' AND own.lease_expires_at>?)";params.push(actor,now);}
      const candidates=await ctx.repo.raw(
        "SELECT c.id,c.title,c.description,c.category,c.sanitized_excerpt,c.status FROM crawl_moderation_gold_cases c WHERE c.status IN ('pending','annotating') AND (SELECT COUNT(*) FROM crawl_moderation_gold_annotations a WHERE a.case_id=c.id)<2 AND NOT EXISTS(SELECT 1 FROM crawl_moderation_gold_annotations mine WHERE mine.case_id=c.id AND mine.annotator_id=?)"+caseFilter+" ORDER BY c.created_at ASC,c.id ASC LIMIT 50",
        params,
      );
      for(const candidate of candidates){
        const mine=await ctx.repo.raw("SELECT id,slot,lease_expires_at FROM crawl_moderation_gold_assignments WHERE case_id=? AND annotator_id=? AND status='claimed' AND lease_expires_at>? LIMIT 1",[String(candidate.id),actor,now]);
        if(mine[0])return {kind:"ok" as const,id:String(mine[0].id),caseId:String(candidate.id),slot:Number(mine[0].slot),expiresAt:Number(mine[0].lease_expires_at),title:candidate.title==null?null:String(candidate.title),description:candidate.description==null?null:String(candidate.description),category:candidate.category==null?null:String(candidate.category),sanitizedExcerpt:candidate.sanitized_excerpt==null?null:String(candidate.sanitized_excerpt)};
        const occupied=await ctx.repo.raw("SELECT slot FROM crawl_moderation_gold_assignments WHERE case_id=? AND status='claimed' AND lease_expires_at>? ORDER BY slot",[String(candidate.id),now]);
        const used=new Set(occupied.map(row=>Number(row.slot)));
        const slot=[1,2].find(value=>!used.has(value));
        if(!slot)continue;
        const id=randomUUID();
        await ctx.repo.run("INSERT INTO crawl_moderation_gold_assignments (id,case_id,annotator_id,slot,status,lease_expires_at,created_at,claimed_at) VALUES (?,?,?,?,'claimed',?,?,?) ON CONFLICT DO NOTHING",[id,String(candidate.id),actor,slot,expiresAt,now,now]);
        const active=await ctx.repo.raw("SELECT id,slot,lease_expires_at FROM crawl_moderation_gold_assignments WHERE case_id=? AND annotator_id=? AND status='claimed' AND lease_expires_at>? LIMIT 1",[String(candidate.id),actor,now]);
        if(active[0])return {kind:"ok" as const,id:String(active[0].id),caseId:String(candidate.id),slot:Number(active[0].slot),expiresAt:Number(active[0].lease_expires_at),title:candidate.title==null?null:String(candidate.title),description:candidate.description==null?null:String(candidate.description),category:candidate.category==null?null:String(candidate.category),sanitizedExcerpt:candidate.sanitized_excerpt==null?null:String(candidate.sanitized_excerpt)};
      }
      return {kind:"empty" as const};
    });
    if(result.kind==="empty"){reply.code(404);return {ok:false,error:"当前没有可领取的标注任务"};}
    await ctx.repo.audit({ip:req.ip,actor,actorKind:req.auth.kind,action:"crawl.moderation_gold_task_claim",target:result.caseId,diff:{assignmentId:result.id,slot:result.slot,expiresAt:result.expiresAt}});
    return {ok:true,assignmentId:result.id,case:{id:result.caseId,title:result.title,description:result.description,category:result.category,sanitizedExcerpt:result.sanitizedExcerpt},slot:result.slot,expiresAt:result.expiresAt};
  });

  app.get("/api/admin/crawl/moderation-gold-cases/:id/annotations", {config:{scope:"admin",cache:{maxAge:0}}}, async(req,reply)=>{
    const parsed=z.object({id:z.string().uuid()}).safeParse(req.params??{});
    if(!parsed.success){reply.code(400);return {ok:false,error:"样本 ID 无效"};}
    const current=await getCrawlModerationGoldCase(ctx.repo,parsed.data.id);
    if(!current){reply.code(404);return {ok:false,error:"金标样本不存在"};}
    // 盲标保护：第一位提交后，在第二位提交前不暴露标签或证据。
    if(current.status==="pending"||current.status==="annotating")return {ok:true,items:[],withheld:true};
    const items=await listCrawlModerationGoldAnnotations(ctx.repo,parsed.data.id);
    return {ok:true,items:items.map(row=>({id:String(row.id),annotatorId:String(row.annotator_id),label:String(row.label),
      risk:Boolean(row.risk),evidence:String(row.evidence),createdAt:Number(row.created_at)}))};
  });

  app.post("/api/admin/crawl/moderation-gold-cases/:id/annotations", {config:{scope:"admin",rateLimit:{max:60,timeWindow:"1 minute"}}}, async(req,reply)=>{
    const params=z.object({id:z.string().uuid()}).safeParse(req.params??{});
    const body=z.object({label:z.enum(["approve","reject","review"]),risk:z.boolean(),evidence:z.string().trim().min(10).max(2000)}).safeParse(req.body??{});
    if(!params.success||!body.success){reply.code(400);return {ok:false,error:"标注参数无效"};}
    const actor=String(req.auth.actor??"admin");
    const result=await ctx.repo.withTransaction(async()=>{
      const assignment=await ctx.repo.raw("SELECT id FROM crawl_moderation_gold_assignments WHERE case_id=? AND annotator_id=? AND status='claimed' AND lease_expires_at>? LIMIT 1",[params.data.id,actor,Date.now()]);
      if(!assignment[0])return {kind:"not_claimed" as const};
      const current=await getCrawlModerationGoldCase(ctx.repo,params.data.id);
      if(!current)return {kind:"missing" as const};
      if(current.status==="gold_ready"||current.status==="needs_adjudication")return {kind:"closed" as const};
      const previous=await listCrawlModerationGoldAnnotations(ctx.repo,params.data.id);
      if(previous.some(row=>String(row.annotator_id)===actor))return {kind:"duplicate" as const};
      if(previous.length>=2)return {kind:"closed" as const};
      const status=await annotateCrawlModerationGoldCase(ctx.repo,{id:randomUUID(),caseId:params.data.id,annotatorId:actor,
        label:body.data.label,risk:body.data.risk,evidence:body.data.evidence});
      await ctx.repo.run("UPDATE crawl_moderation_gold_assignments SET status='completed',completed_at=? WHERE id=? AND status='claimed'",[Date.now(),String(assignment[0].id)]);
      return {kind:"ok" as const,status};
    });
    if(result.kind==="not_claimed"){reply.code(409);return {ok:false,error:"请先领取该样本的有效标注任务，任务过期后需要重新领取"};}
    if(result.kind==="missing"){reply.code(404);return {ok:false,error:"金标样本不存在"};}
    if(result.kind==="duplicate"){reply.code(409);return {ok:false,error:"同一管理员不能对同一样本重复标注"};}
    if(result.kind==="closed"){reply.code(409);return {ok:false,error:"该样本已完成双标或等待仲裁"};}
    await ctx.repo.audit({ip:req.ip,actor,actorKind:req.auth.kind,action:"crawl.moderation_gold_annotate",target:params.data.id,
      diff:{label:body.data.label,risk:body.data.risk,status:result.status}});
    return {ok:true,status:result.status};
  });

  app.post("/api/admin/crawl/moderation-gold-cases/:id/adjudicate", {config:{scope:"admin",rateLimit:{max:30,timeWindow:"1 minute"}}}, async(req,reply)=>{
    const params=z.object({id:z.string().uuid()}).safeParse(req.params??{});
    const body=z.object({label:z.enum(["approve","reject","review"]),risk:z.boolean(),reason:z.string().trim().min(10).max(2000)}).safeParse(req.body??{});
    if(!params.success||!body.success){reply.code(400);return {ok:false,error:"仲裁参数无效"};}
    const actor=String(req.auth.actor??"admin");
    const annotations=await listCrawlModerationGoldAnnotations(ctx.repo,params.data.id);
    if(annotations.some(row=>String(row.annotator_id)===actor)){
      reply.code(403);return {ok:false,error:"仲裁人必须独立于该样本的两位标注员"};
    }
    const adjudicated=await ctx.repo.withTransaction(()=>adjudicateCrawlModerationGoldCase(ctx.repo,{
      caseId:params.data.id,adjudicatorId:actor,label:body.data.label,risk:body.data.risk,reason:body.data.reason}));
    if(!adjudicated){reply.code(409);return {ok:false,error:"样本不存在或当前状态不允许仲裁"};}
    await ctx.repo.audit({ip:req.ip,actor,actorKind:req.auth.kind,action:"crawl.moderation_gold_adjudicate",target:params.data.id,
      diff:{label:body.data.label,risk:body.data.risk,reason:body.data.reason}});
    return {ok:true,status:"gold_ready"};
  });

  app.get("/api/admin/crawl/moderation-gold-export", { config: { scope: "admin", cache: { maxAge: 0 } } }, async (req, reply) => {
    const parsed = z.object({
      limit: z.coerce.number().int().min(1).max(4999).default(1000),
    }).safeParse(req.query ?? {});
    if (!parsed.success) { reply.code(400); return { ok: false, error: "金标导出参数无效" }; }
    const rows = await listCrawlModerationGoldCases(ctx.repo, {
      status: "gold_ready", limit: parsed.data.limit + 1, offset: 0,
    });
    const truncated = rows.length > parsed.data.limit;
    const items = rows.slice(0, parsed.data.limit).filter(row =>
      ["approve", "reject", "review"].includes(String(row.final_label)) &&
      (row.final_risk === true || row.final_risk === false || row.final_risk === 0 || row.final_risk === 1)
    ).map(row => ({
      id: String(row.id),
      sourceFingerprint: String(row.source_fingerprint),
      title: row.title == null ? null : String(row.title),
      description: row.description == null ? null : String(row.description),
      category: row.category == null ? null : String(row.category),
      sanitizedExcerpt: row.sanitized_excerpt == null ? null : String(row.sanitized_excerpt),
      expected: String(row.final_label),
      expectedRisk: Boolean(row.final_risk),
      adjudicatedAt: row.adjudicated_at == null ? null : Number(row.adjudicated_at),
    }));
    return { ok: true, datasetVersion: "moderation-gold-v1", generatedAt: Date.now(),
      count: items.length, limit: parsed.data.limit, truncated, items };
  });


  app.get("/api/admin/crawl/moderation-gold-progress", {config:{scope:"admin",cache:{maxAge:0}}}, async()=>{
    const [totals,labels]=await Promise.all([
      ctx.repo.raw("SELECT status,COUNT(*) AS total FROM crawl_moderation_gold_cases GROUP BY status"),
      ctx.repo.raw("SELECT final_label,final_risk,COUNT(*) AS total FROM crawl_moderation_gold_cases WHERE status='gold_ready' GROUP BY final_label,final_risk"),
    ]);
    const counts=Object.fromEntries(totals.map(row=>[String(row.status),Number(row.total??0)]));
    const goldReady=counts.gold_ready??0;
    const distribution=labels.map(row=>({label:String(row.final_label??"unknown"),risk:Boolean(row.final_risk),count:Number(row.total??0)}));
    return {ok:true,target:100,total:totals.reduce((sum,row)=>sum+Number(row.total??0),0),
      pending:counts.pending??0,annotating:counts.annotating??0,needsAdjudication:counts.needs_adjudication??0,
      goldReady,remaining:Math.max(0,100-goldReady),progress:Math.min(100,Math.round(goldReady/100*100)),
      distribution,generatedAt:Date.now()};
  });

  app.get("/api/admin/crawl/moderation-model-evaluations", {config:{scope:"admin",cache:{maxAge:0}}}, async()=>{
    const rows=await ctx.repo.raw("SELECT id,model,dataset_version,sample_size,metrics_json,created_by,created_at FROM crawl_moderation_model_evaluations ORDER BY created_at DESC,id DESC LIMIT 50");
    return {ok:true,items:rows.map(row=>({id:String(row.id),model:String(row.model),datasetVersion:String(row.dataset_version),
      sampleSize:Number(row.sample_size),metrics:JSON.parse(String(row.metrics_json)),createdBy:String(row.created_by),createdAt:Number(row.created_at)}))};
  });

  app.post("/api/admin/crawl/moderation-model-evaluations/auto",
    { config: { scope: "admin", rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z.object({ limit: z.coerce.number().int().min(1).max(20).default(20) }).safeParse(req.body ?? {});
      if (!body.success) { reply.code(400); return { ok: false, error: "自动评测样本数必须为 1–20" }; }
      const countRows = await ctx.repo.raw("SELECT COUNT(*) AS total FROM crawl_moderation_gold_cases WHERE status='gold_ready'");
      const total = Number(countRows[0]?.total ?? 0);
      if (!total) { reply.code(409); return { ok: false, error: "尚无正式金标样本，暂不能自动评测" }; }
      const goldRows = await listCrawlModerationGoldCases(ctx.repo, { status: "gold_ready", limit: 5000, offset: 0 });
      const gold = goldRows.filter(row => ["approve","reject","review"].includes(String(row.final_label)) &&
        (row.final_risk === true || row.final_risk === false || row.final_risk === 0 || row.final_risk === 1) &&
        (row.title != null || row.description != null || row.sanitized_excerpt != null));
      if (!gold.length) { reply.code(409); return { ok: false, error: "正式金标样本缺少可供模型判断的脱敏文本" }; }
      const selected = selectGoldEvaluationSample(gold, body.data.limit);
      const resolved = await resolveLlm(ctx);
      const provider = [resolved.provider, ...resolved.fallbacks].find(llmProviderReady);
      if (!provider) { reply.code(409); return { ok: false, error: "系统尚未配置可用的大模型或备用模型" }; }
      // 固定本轮实际模型，避免同一评测集混入主模型与备用模型的预测结果。
      const evaluationResolved = { ...resolved, provider, fallbacks: [] };
      const policy = await loadCrawlAiModerationPolicy(ctx);
      const predictions: Array<{ id: string; actual: "approve" | "reject" | "review"; actualRisk: boolean }> = [];
      const actualModels = new Set<string>();
      let failed = 0;
      for (const row of selected) {
        const quota = await reserveLlmQuota(ctx, null, { source: resolved.source, estimatedTokens: 1800 });
        if (!quota.ok) return replyQuotaBlocked(reply, quota.error);
        try {
          const decision = await moderateSiteWithAi(provider, {
            // 金标表不保存原始 URL；评测时使用固定脱敏占位 URL，不反查候选原始地址。
            url: "https://redacted.invalid/",
            title: row.title == null ? null : String(row.title),
            description: row.description == null ? null : String(row.description),
            contentExcerpt: row.sanitized_excerpt == null ? null : String(row.sanitized_excerpt),
            declaredCategory: row.category == null ? null : String(row.category),
            knownCategories: row.category == null ? [] : [String(row.category)],
            evidence: { provenance: "moderation_gold_evaluation", warnings: [] },
          }, {
            autoApproveConfidence: policy.autoApproveConfidence, rejectConfidence: policy.rejectConfidence,
            minQualityScore: policy.minQualityScore, maxExcerptChars: policy.maxExcerptChars, requireHttps: policy.requireHttps,
          }, {
            deadlineAt: Date.now() + 45_000,
            complete: async (_provider, request) => {
              const result = await callLlm(ctx, evaluationResolved, {
                scenario: "crawl_moderation_gold_eval", identity: null, messages: request.messages,
                temperature: request.temperature, maxTokens: request.maxTokens, json: request.json,
                thinking: false, signal: request.signal, deadlineAt: request.deadlineAt, fetchImpl: request.fetchImpl,
              });
              return { content: result.content, model: result.model };
            },
          });
          actualModels.add(decision.model);
          const prediction = moderationVerdictToPrediction(decision);
          predictions.push({ id: String(row.id), ...prediction });
        } catch { failed++; }
        finally { await settleLlmQuota(ctx, quota.hold); }
      }
      if (failed || predictions.length !== selected.length) {
        reply.code(502); return { ok: false, error: "自动评测未完整完成，未保存不完整指标", selected: selected.length, completed: predictions.length, failed };
      }
      if (actualModels.size !== 1) { reply.code(409); return { ok: false, error: "本轮模型标识不一致，已阻止混合模型评测", models: [...actualModels] }; }
      const predictionMap = new Map(predictions.map(item => [item.id,item]));
      const cases = selected.map(row => {
        const prediction = predictionMap.get(String(row.id));
        if (!prediction) throw new Error("自动评测预测样本缺失");
        return { id: String(row.id), expected: String(row.final_label) as "approve"|"reject"|"review",
          actual: prediction.actual, expectedRisk: Boolean(row.final_risk), actualRisk: prediction.actualRisk };
      });
      const metrics = evaluateSiteModerationGoldSet(cases);
      const datasetVersion = createHash("sha256").update(selected.map(row => String(row.id)+":"+String(row.final_label)+":"+String(Boolean(row.final_risk))).join("|")).digest("hex");
      const model = [...actualModels][0] ?? provider.model;
      const previousRows = await ctx.repo.raw("SELECT metrics_json FROM crawl_moderation_model_evaluations WHERE model=? AND dataset_version=? ORDER BY created_at DESC,id DESC LIMIT 1",[model,datasetVersion]);
      const previous = previousRows[0]?.metrics_json ? JSON.parse(String(previousRows[0].metrics_json)) as {exactMatchRate?:number|null;riskDetection?:{recall?:number|null}} : null;
      const alerts: Array<{severity:"warning"|"critical";code:string;message:string}> = [];
      if (metrics.exactMatchRate !== null && metrics.exactMatchRate < 0.9) alerts.push({severity:"warning",code:"low_exact_match",message:"标签精确匹配率低于 90%，建议保持 Shadow 并检查错分样本"});
      if (metrics.riskDetection.positiveSupport === 0) alerts.push({severity:"warning",code:"risk_support_missing",message:"当前评测样本没有风险正样本，风险召回率无法评估"});
      else if (metrics.riskDetection.recall !== null && metrics.riskDetection.recall < 0.95) alerts.push({severity:"critical",code:"low_risk_recall",message:"风险召回率低于 95%，存在漏检风险，不应启用自动审核"});
      if (metrics.riskDetection.falseNegatives > 0) alerts.push({severity:"critical",code:"risk_false_negative",message:"本轮出现 "+metrics.riskDetection.falseNegatives+" 条风险漏报，必须复核对应样本"});
      if (previous?.exactMatchRate != null && metrics.exactMatchRate !== null && previous.exactMatchRate-metrics.exactMatchRate > 0.05) alerts.push({severity:"warning",code:"exact_match_regression",message:"相较该模型上一次同快照评测，标签精确匹配率下降超过 5 个百分点"});
      if (previous?.riskDetection?.recall != null && metrics.riskDetection.recall !== null && previous.riskDetection.recall-metrics.riskDetection.recall > 0.05) alerts.push({severity:"critical",code:"risk_recall_regression",message:"相较该模型上一次同快照评测，风险召回率下降超过 5 个百分点"});
      const errorAnalysis = buildModerationErrorAnalysis(cases);
      const evaluation = { ...metrics, alerts, errorAnalysis, execution: { mode: "automatic", requested: body.data.limit, selected: selected.length, source: resolved.source } };
      const id = randomUUID(), actor = String(req.auth.actor ?? "admin"), createdAt = Date.now();
      await ctx.repo.run("INSERT INTO crawl_moderation_model_evaluations (id,model,dataset_version,sample_size,metrics_json,created_by,created_at) VALUES (?,?,?,?,?,?,?)",
        [id,model,datasetVersion,metrics.sampleSize,JSON.stringify(evaluation),actor,createdAt]);
      await ctx.repo.audit({ ip:req.ip,actor,actorKind:req.auth.kind,action:"crawl.moderation_model_auto_evaluation",target:id,
        diff:{ model,datasetVersion,sampleSize:metrics.sampleSize,exactMatchRate:metrics.exactMatchRate,alertCount:alerts.length,source:resolved.source } });
      return { ok:true,id,model,datasetVersion,sampleSize:metrics.sampleSize,metrics:evaluation,alerts,createdAt,source:resolved.source };
    },
  );
  app.post("/api/admin/crawl/moderation-model-evaluations", {config:{scope:"admin",rateLimit:{max:20,timeWindow:"1 minute"}}}, async(req,reply)=>{
    const body=z.object({
      model:z.string().trim().min(1).max(120),
      predictions:z.array(z.object({
        id:z.string().uuid(),actual:z.enum(["approve","reject","review"]),actualRisk:z.boolean(),
      })).min(1).max(4999),
    }).safeParse(req.body??{});
    if(!body.success){reply.code(400);return {ok:false,error:"模型评测数据格式无效",details:body.error.issues};}
    const countRows=await ctx.repo.raw("SELECT COUNT(*) AS total FROM crawl_moderation_gold_cases WHERE status='gold_ready'");
    const total=Number(countRows[0]?.total??0);
    if(total===0){reply.code(409);return {ok:false,error:"尚无正式金标样本，暂不能进行模型评测"};}
    if(total>4999){reply.code(409);return {ok:false,error:"正式金标样本超过单次评测上限，请先建立分批评测集"};}
    const goldRows=await listCrawlModerationGoldCases(ctx.repo,{status:"gold_ready",limit:5000,offset:0});
    const gold=goldRows.filter(row=>
      ["approve","reject","review"].includes(String(row.final_label)) &&
      (row.final_risk===true||row.final_risk===false||row.final_risk===0||row.final_risk===1)
    );
    if(gold.length!==total){reply.code(409);return {ok:false,error:"部分正式金标缺少有效标签或风险标记，请先修复数据"};}
    const ids=new Set(body.data.predictions.map(item=>item.id));
    if(ids.size!==body.data.predictions.length){reply.code(400);return {ok:false,error:"模型预测包含重复样本 ID"};}
    const goldIds=new Set(gold.map(row=>String(row.id)));
    if(ids.size!==goldIds.size||[...goldIds].some(id=>!ids.has(id))){
      reply.code(400);return {ok:false,error:"模型预测必须覆盖当前全部正式金标样本，确保模型间使用相同评测集"};
    }
    const predictionMap=new Map(body.data.predictions.map(item=>[item.id,item]));
    const cases=gold.map(row=>{
      const prediction=predictionMap.get(String(row.id));
      if(!prediction)throw new Error("预测样本缺失");
      return {id:String(row.id),expected:String(row.final_label) as "approve"|"reject"|"review",
        actual:prediction.actual,expectedRisk:Boolean(row.final_risk),actualRisk:prediction.actualRisk};
    });
    const metrics=evaluateSiteModerationGoldSet(cases);
    const datasetVersion=createHash("sha256").update(gold.map(row=>String(row.id)+":"+String(row.final_label)+":"+String(Boolean(row.final_risk))).join("|")).digest("hex");
    const previousRows=await ctx.repo.raw("SELECT metrics_json FROM crawl_moderation_model_evaluations WHERE model=? AND dataset_version=? ORDER BY created_at DESC,id DESC LIMIT 1",[body.data.model,datasetVersion]);
    const previous=previousRows[0]?.metrics_json?JSON.parse(String(previousRows[0].metrics_json)) as {exactMatchRate?:number|null;riskDetection?:{recall?:number|null}}:null;
    const alerts:Array<{severity:"warning"|"critical";code:string;message:string}>=[];
    if(metrics.exactMatchRate!==null&&metrics.exactMatchRate<0.9)alerts.push({severity:"warning",code:"low_exact_match",message:"标签精确匹配率低于 90%，建议保持 Shadow 并检查错分样本"});
    if(metrics.riskDetection.positiveSupport===0)alerts.push({severity:"warning",code:"risk_support_missing",message:"当前金标集没有正向风险样本，风险召回率无法评估"});
    else if(metrics.riskDetection.recall!==null&&metrics.riskDetection.recall<0.95)alerts.push({severity:"critical",code:"low_risk_recall",message:"风险召回率低于 95%，存在漏检风险，不应启用自动审核"});
    if(metrics.riskDetection.falseNegatives>0)alerts.push({severity:"critical",code:"risk_false_negative",message:"本轮出现 "+metrics.riskDetection.falseNegatives+" 条风险漏报，必须复核对应样本"});
    if(previous?.exactMatchRate!=null&&metrics.exactMatchRate!==null&&previous.exactMatchRate-metrics.exactMatchRate>0.05)alerts.push({severity:"warning",code:"exact_match_regression",message:"相较该模型上一次评测，标签精确匹配率下降超过 5 个百分点"});
    if(previous?.riskDetection?.recall!=null&&metrics.riskDetection.recall!==null&&previous.riskDetection.recall-metrics.riskDetection.recall>0.05)alerts.push({severity:"critical",code:"risk_recall_regression",message:"相较该模型上一次评测，风险召回率下降超过 5 个百分点"});
    const errorAnalysis=buildModerationErrorAnalysis(cases);
    const evaluation={...metrics,alerts,errorAnalysis};
    const id=randomUUID(),actor=String(req.auth.actor??"admin"),createdAt=Date.now();
    await ctx.repo.run("INSERT INTO crawl_moderation_model_evaluations (id,model,dataset_version,sample_size,metrics_json,created_by,created_at) VALUES (?,?,?,?,?,?,?)",
      [id,body.data.model,datasetVersion,metrics.sampleSize,JSON.stringify(evaluation),actor,createdAt]);
    await ctx.repo.audit({ip:req.ip,actor,actorKind:req.auth.kind,action:"crawl.moderation_model_evaluation",target:id,
      diff:{model:body.data.model,datasetVersion,sampleSize:metrics.sampleSize,exactMatchRate:metrics.exactMatchRate,alertCount:alerts.length}});
    return {ok:true,id,model:body.data.model,datasetVersion,sampleSize:metrics.sampleSize,metrics:evaluation,alerts,createdAt};
  });

};
