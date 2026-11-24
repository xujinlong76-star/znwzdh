import type { Repository } from "../repository.ts";

export interface CrawlAiModerationDecisionInput {
  id: string;
  candidateId: string;
  decisionSource: "ai" | "human";
  mode: "shadow" | "manual" | "auto_approve";
  status: "completed" | "error" | "quota_blocked" | "reviewed";
  verdict?: string | null;
  confidence?: number | null;
  qualityScore?: number | null;
  risks?: string[];
  reasons?: string[];
  model?: string | null;
  policyVersion?: string | null;
  actor?: string | null;
  createdAt?: number;
}

/** 追加式审核账本：每次 AI 判断与人工最终决定各写一行，不覆盖历史。 */
export async function recordCrawlAiModerationDecision(
  repo: Repository,
  input: CrawlAiModerationDecisionInput,
): Promise<void> {
  await repo.run(
    `INSERT INTO crawl_ai_moderation_decisions
      (id,candidate_id,decision_source,mode,status,verdict,confidence,quality_score,
       risks_json,reasons_json,model,policy_version,actor,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.id,input.candidateId,input.decisionSource,input.mode,input.status,
      input.verdict ?? null,input.confidence ?? null,input.qualityScore ?? null,
      JSON.stringify((input.risks ?? []).slice(0, 20)),
      JSON.stringify((input.reasons ?? []).slice(0, 20)),
      input.model ?? null,input.policyVersion ?? null,input.actor ?? null,
      input.createdAt ?? Date.now(),
    ],
  );
}

export async function listCrawlAiModerationDecisions(
  repo: Repository,
  options: { candidateId?: string; limit?: number; offset?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(5000, Math.max(1, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const where = options.candidateId ? "WHERE candidate_id = ?" : "";
  return repo.raw(
    `SELECT id,candidate_id,decision_source,mode,status,verdict,confidence,quality_score,
       risks_json,reasons_json,model,policy_version,actor,created_at
     FROM crawl_ai_moderation_decisions ${where}
     ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    [...(options.candidateId ? [options.candidateId] : []),limit,offset],
  );
}


const goldRiskParam = (repo: Repository, value: boolean): boolean | number =>
  repo.db.dialect === "pg" ? value : value ? 1 : 0;

export type CrawlModerationGoldLabel = "approve" | "reject" | "review";
export interface CreateCrawlModerationGoldCaseInput {
  id: string; sourceFingerprint: string; title?: string | null;
  description?: string | null; category?: string | null; sanitizedExcerpt?: string | null;
  createdBy: string; createdAt?: number;
}
export interface CrawlModerationGoldAnnotationInput {
  id: string; caseId: string; annotatorId: string; label: CrawlModerationGoldLabel;
  risk: boolean; evidence: string; createdAt?: number;
}

/** 只存调用方已脱敏的字段；本表刻意没有原始 URL 或原始网页正文列。 */
export async function createCrawlModerationGoldCase(
  repo: Repository, input: CreateCrawlModerationGoldCaseInput,
): Promise<void> {
  await repo.run(
    `INSERT INTO crawl_moderation_gold_cases
      (id,source_fingerprint,title,description,category,sanitized_excerpt,status,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'pending',?,?,?)`,
    [input.id,input.sourceFingerprint,input.title ?? null,input.description ?? null,
     input.category ?? null,input.sanitizedExcerpt ?? null,input.createdBy,
     input.createdAt ?? Date.now(),input.createdAt ?? Date.now()],
  );
}

export async function listCrawlModerationGoldCases(
  repo: Repository, options: { status?: "pending" | "annotating" | "needs_adjudication" | "gold_ready"; limit?: number; offset?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(5000, Math.max(1, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const where = options.status ? "WHERE c.status = ?" : "";
  return repo.raw(
    `SELECT c.*, (SELECT COUNT(*) FROM crawl_moderation_gold_annotations a WHERE a.case_id=c.id) AS annotation_count
     FROM crawl_moderation_gold_cases c ${where}
     ORDER BY c.created_at ASC,c.id ASC LIMIT ? OFFSET ?`,
    [...(options.status ? [options.status] : []),limit,offset],
  );
}

export async function getCrawlModerationGoldCase(
  repo: Repository, id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await repo.raw("SELECT * FROM crawl_moderation_gold_cases WHERE id = ? LIMIT 1", [id]);
  return rows[0] ?? null;
}

/** 双人标注写入与状态推进应由 API 在同一个 withTransaction 中调用。 */
export async function annotateCrawlModerationGoldCase(
  repo: Repository, input: CrawlModerationGoldAnnotationInput,
): Promise<"gold_ready" | "needs_adjudication" | "annotating"> {
  await repo.run(
    `INSERT INTO crawl_moderation_gold_annotations
      (id,case_id,annotator_id,label,risk,evidence,created_at) VALUES (?,?,?,?,?,?,?)`,
    [input.id,input.caseId,input.annotatorId,input.label,goldRiskParam(repo,input.risk),
     input.evidence.slice(0,2000),input.createdAt ?? Date.now()],
  );
  const rows = await repo.raw(
    "SELECT label,risk FROM crawl_moderation_gold_annotations WHERE case_id = ? ORDER BY created_at ASC,id ASC",
    [input.caseId],
  );
  if (rows.length < 2) {
    await repo.run("UPDATE crawl_moderation_gold_cases SET status='annotating',updated_at=? WHERE id=? AND status IN ('pending','annotating')",
      [Date.now(),input.caseId]);
    return "annotating";
  }
  if (rows.length !== 2) throw new Error("该样本标注数量异常，需管理员检查");
  const agrees = String(rows[0].label) === String(rows[1].label) && Boolean(rows[0].risk) === Boolean(rows[1].risk);
  if (agrees) {
    await repo.run(
      "UPDATE crawl_moderation_gold_cases SET status='gold_ready',final_label=?,final_risk=?,updated_at=? WHERE id=?",
      [String(rows[0].label),goldRiskParam(repo,Boolean(rows[0].risk)),Date.now(),input.caseId],
    );
    return "gold_ready";
  }
  await repo.run("UPDATE crawl_moderation_gold_cases SET status='needs_adjudication',updated_at=? WHERE id=?",
    [Date.now(),input.caseId]);
  return "needs_adjudication";
}

export async function adjudicateCrawlModerationGoldCase(
  repo: Repository, input: { caseId: string; adjudicatorId: string; label: CrawlModerationGoldLabel; risk: boolean; reason: string },
): Promise<boolean> {
  const rows = await repo.raw("SELECT status FROM crawl_moderation_gold_cases WHERE id = ? LIMIT 1", [input.caseId]);
  if (rows.length !== 1 || String(rows[0].status) !== "needs_adjudication") return false;
  await repo.run(
    `UPDATE crawl_moderation_gold_cases
     SET status='gold_ready',final_label=?,final_risk=?,adjudicator_id=?,adjudication_reason=?,
         adjudicated_at=?,updated_at=?
     WHERE id=? AND status='needs_adjudication'`,
    [input.label,goldRiskParam(repo,input.risk),input.adjudicatorId,input.reason.slice(0,2000),
     Date.now(),Date.now(),input.caseId],
  );
  return true;
}

export async function listCrawlModerationGoldAnnotations(
  repo: Repository, caseId: string,
): Promise<Array<Record<string, unknown>>> {
  return repo.raw(
    "SELECT id,case_id,annotator_id,label,risk,evidence,created_at FROM crawl_moderation_gold_annotations WHERE case_id=? ORDER BY created_at ASC,id ASC",
    [caseId],
  );
}
