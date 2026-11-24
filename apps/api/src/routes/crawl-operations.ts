import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  countSiteDiscoveryCandidates, getSiteDiscoveryCandidateForUpdate,
  listSiteDiscoveryCandidates, reviewSiteDiscoveryCandidate, listCrawlAiModerationDecisions, countCrawlAiModerationDecisions,
} from "@navhub/store";
import type { AppContext } from "../context.ts";

/** 透明、可解释的初筛分数；只用于排序辅助，不自动批准或拒绝。 */
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
    const [tasks, sources, candidates, hosts, recent, moderationRows] = await Promise.all([
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM crawl_tasks GROUP BY status"),
      ctx.repo.raw("SELECT enabled, COUNT(*) AS total FROM crawl_sources GROUP BY enabled"),
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM site_discovery_candidates GROUP BY status"),
      ctx.repo.raw("SELECT host, COUNT(*) AS total FROM crawl_tasks GROUP BY host ORDER BY total DESC LIMIT 20"),
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM crawl_tasks WHERE updated_at >= ? GROUP BY status", [Date.now()-24*60*60_000]),
      ctx.repo.raw("SELECT evidence_json FROM site_discovery_candidates WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 1000", [Date.now()-24*60*60_000]),
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
    const totalTasks = Object.values(taskCounts).reduce((a,b)=>a+b,0);
    const finished = (taskCounts.done ?? 0) + (taskCounts.dead_letter ?? 0) + (taskCounts.hold_for_review ?? 0);
    return {
      ok: true, generatedAt: Date.now(),
      tasks: { ...taskCounts, total: totalTasks, successRate: finished ? Math.round((taskCounts.done ?? 0)/finished*1000)/10 : null },
      sources: { enabled: sourceCounts.true ?? 0, disabled: sourceCounts.false ?? 0 },
      candidates: candidateCounts,
      last24Hours: recentCounts,
      aiModeration,
      busiestHosts: hosts.map(row => ({ host: String(row.host), tasks: Number(row.total) })),
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

  app.get("/api/admin/crawl/candidates/:id/moderation-history", { config: { scope: "admin", cache: { maxAge: 0 } } }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(req.params ?? {});
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    }).safeParse(req.query ?? {});
    if (!params.success || !query.success) {
      reply.code(400);
      return { ok: false, error: "审核历史查询参数无效" };
    }
    const [items, total] = await Promise.all([
      listCrawlAiModerationDecisions(ctx.repo, { candidateId: params.data.id, ...query.data }),
      countCrawlAiModerationDecisions(ctx.repo, params.data.id),
    ]);
    return { ok: true, items, total, limit: query.data.limit, offset: query.data.offset };
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
      return updated ? { kind:"ok" as const, candidate:updated } : { kind:"conflict" as const, status:"changed" };
    });
    if (result.kind === "missing") { reply.code(404); return {ok:false,error:"候选不存在"}; }
    if (result.kind === "conflict") { reply.code(409); return {ok:false,error:"候选已被其他审核操作处理",status:result.status}; }
    await ctx.repo.audit({ ip:req.ip,actor:reviewer,actorKind:req.auth.kind,action:"crawl.candidate_review",target:result.candidate.id,
      diff:{decision:body.data.decision,reason:body.data.reason ?? null,previousStatus:"pending"} });
    return {ok:true,candidate:{id:result.candidate.id,status:result.candidate.status,reviewedAt:result.candidate.reviewedAt}};
  });
};
