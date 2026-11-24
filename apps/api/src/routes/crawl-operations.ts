import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  countSiteDiscoveryCandidates, getSiteDiscoveryCandidateForUpdate,
  recordCrawlAiModerationDecision, listCrawlAiModerationDecisions,
  createCrawlModerationGoldCase, listCrawlModerationGoldCases, getCrawlModerationGoldCase,
  annotateCrawlModerationGoldCase, adjudicateCrawlModerationGoldCase, listCrawlModerationGoldAnnotations,
  listSiteDiscoveryCandidates, reviewSiteDiscoveryCandidate,
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

  app.get("/api/admin/crawl/moderation-gold-cases/:id/annotations", {config:{scope:"admin",cache:{maxAge:0}}}, async(req,reply)=>{
    const parsed=z.object({id:z.string().uuid()}).safeParse(req.params??{});
    if(!parsed.success){reply.code(400);return {ok:false,error:"样本 ID 无效"};}
    const current=await getCrawlModerationGoldCase(ctx.repo,parsed.data.id);
    if(!current){reply.code(404);return {ok:false,error:"金标样本不存在"};}
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
      const current=await getCrawlModerationGoldCase(ctx.repo,params.data.id);
      if(!current)return {kind:"missing" as const};
      if(current.status==="gold_ready"||current.status==="needs_adjudication")return {kind:"closed" as const};
      const previous=await listCrawlModerationGoldAnnotations(ctx.repo,params.data.id);
      if(previous.some(row=>String(row.annotator_id)===actor))return {kind:"duplicate" as const};
      if(previous.length>=2)return {kind:"closed" as const};
      const status=await annotateCrawlModerationGoldCase(ctx.repo,{id:randomUUID(),caseId:params.data.id,annotatorId:actor,
        label:body.data.label,risk:body.data.risk,evidence:body.data.evidence});
      return {kind:"ok" as const,status};
    });
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

};
