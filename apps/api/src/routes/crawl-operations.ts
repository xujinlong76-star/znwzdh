import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  countSiteDiscoveryCandidates, getSiteDiscoveryCandidateForUpdate,
  listSiteDiscoveryCandidates, reviewSiteDiscoveryCandidate,
} from "@navhub/store";
import type { AppContext } from "../context.ts";

/** 可解释的采集质量模型。所有维度均为证据提示，不构成自动发布/封禁决策。 */
export function scoreCrawlCandidate(input: {
  url: string; title?: string | null; description?: string | null;
  evidence?: Record<string, unknown>;
}): {
  score: number; reasons: string[];
  dimensions: { completeness: number; freshness: number | null; uniqueness: number; trust: number; risk: number };
  host: string | null; domainFamily: { id: string; label: string } | null;
} {
  let score = 35;
  const reasons: string[] = [];
  const evidence = input.evidence ?? {};
  const tokenCount = Number(evidence.tokenCount ?? 0);
  let completeness = 20;
  if (input.title?.trim()) { score += 15; completeness += 30; reasons.push("存在页面标题"); }
  else { score -= 12; reasons.push("缺少页面标题"); }
  if (input.description?.trim()) { score += 10; completeness += 20; reasons.push("存在页面描述"); }
  else { score -= 5; reasons.push("缺少页面描述"); }
  if (tokenCount >= 300) { score += 20; completeness += 30; reasons.push("正文信息量较充分"); }
  else if (tokenCount >= 80) { score += 10; completeness += 15; reasons.push("正文达到最低信息量"); }
  else { score -= 15; reasons.push("正文信息量偏低"); }
  if (evidence.exactDuplicateOf) { score -= 30; reasons.push("存在完全重复页面证据"); }
  const near = Array.isArray(evidence.nearDuplicateCandidates) ? evidence.nearDuplicateCandidates.length : 0;
  if (near > 0) { score -= Math.min(15, near * 3); reasons.push("存在近重复页面候选"); }
  const uniqueness = Math.max(0, 100 - (evidence.exactDuplicateOf ? 100 : 0) - Math.min(75, near * 15));
  let host: string | null = null;
  try {
    const parsed = new URL(input.url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("unsafe URL");
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol === "https:") { score += 5; reasons.push("使用 HTTPS（仅代表传输加密，不代表站点可信）"); }
  } catch { score -= 20; reasons.push("URL 格式异常或协议不受支持"); }
  // 新鲜度只在采集证据明确给出时间戳时计算；未知保持 null，不伪装成低分。
  const freshnessAt = Number(evidence.contentUpdatedAt ?? evidence.lastModifiedAt ?? 0);
  const freshness = Number.isFinite(freshnessAt) && freshnessAt > 0
    ? Math.max(0, Math.min(100, Math.round(100 * Math.exp(-Math.max(0, Date.now() - freshnessAt) / (180 * 24 * 60 * 60_000)))))
    : null;
  if (freshness !== null) reasons.push(freshness >= 70 ? "内容更新时间较近" : freshness >= 35 ? "内容更新时间一般" : "内容可能较久未更新");
  const rawTrustSignals = Number(evidence.trustSignals ?? 0);
  const trustSignals = Number.isFinite(rawTrustSignals) ? Math.max(0, Math.min(4, rawTrustSignals)) : 0;
  const trust = Math.max(0, Math.min(100, trustSignals * 25));
  if (trustSignals > 0) reasons.push("存在显式来源可信度证据");
  else reasons.push("尚无独立可信度背书，需人工核验");
  const riskFlags = Array.isArray(evidence.riskFlags) ? evidence.riskFlags.length : 0;
  const risk = Math.max(0, Math.min(100, riskFlags * 25 + (evidence.malwareEvidence ? 60 : 0) + (evidence.phishingEvidence ? 60 : 0)));
  if (risk > 0) { score -= Math.min(35, risk * 0.35); reasons.push("发现风险线索，需安全复核"); }
  // 家族归属仅接受经过管理员核验写入的显式证据；绝不通过相似域名或末两段猜测。
  const familyId = evidence.verifiedDomainFamilyId;
  const familyLabel = evidence.verifiedDomainFamilyLabel;
  const domainFamily = typeof familyId === "string" && familyId.trim() && typeof familyLabel === "string" && familyLabel.trim()
    ? { id: familyId, label: familyLabel } : null;
  if (domainFamily) reasons.push("命中已核验的域名族关系");
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    dimensions: { completeness: Math.max(0, Math.min(100, completeness)), freshness, uniqueness, trust, risk },
    host,
    domainFamily,
  };
}

export const crawlOperationsRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;
  app.get("/api/admin/crawl/overview", { config: { scope: "admin", cache: { maxAge: 0 } } }, async () => {
    const [tasks, sources, candidates, hosts, recent] = await Promise.all([
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM crawl_tasks GROUP BY status"),
      ctx.repo.raw("SELECT enabled, COUNT(*) AS total FROM crawl_sources GROUP BY enabled"),
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM site_discovery_candidates GROUP BY status"),
      ctx.repo.raw("SELECT host, COUNT(*) AS total FROM crawl_tasks GROUP BY host ORDER BY total DESC LIMIT 20"),
      ctx.repo.raw("SELECT status, COUNT(*) AS total FROM crawl_tasks WHERE updated_at >= ? GROUP BY status", [Date.now()-24*60*60_000]),
    ]);
    const countMap = (rows: Array<Record<string, unknown>>, key: string) =>
      Object.fromEntries(rows.map(row => [String(row[key]), Number(row.total ?? 0)]));
    const taskCounts = countMap(tasks, "status");
    const sourceCounts = countMap(sources, "enabled");
    const candidateCounts = countMap(candidates, "status");
    const recentCounts = countMap(recent, "status");
    const totalTasks = Object.values(taskCounts).reduce((a,b)=>a+b,0);
    const finished = (taskCounts.done ?? 0) + (taskCounts.dead_letter ?? 0) + (taskCounts.hold_for_review ?? 0);
    return {
      ok: true, generatedAt: Date.now(),
      tasks: { ...taskCounts, total: totalTasks, successRate: finished ? Math.round((taskCounts.done ?? 0)/finished*1000)/10 : null },
      sources: { enabled: sourceCounts.true ?? 0, disabled: sourceCounts.false ?? 0 },
      candidates: candidateCounts,
      last24Hours: recentCounts,
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
        quality };
    }), total, limit: parsed.data.limit, offset: parsed.data.offset };
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
