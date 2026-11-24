import { randomUUID } from "node:crypto";
import type { Repository } from "../repository.ts";

export type CrawlAiModerationDecisionStatus = "completed" | "error" | "quota_blocked";
export type CrawlAiModerationDecisionMode = "shadow" | "auto";
export type CrawlAiModerationVerdict = "auto_approve" | "reject" | "manual_review";

export interface CrawlAiModerationDecision {
  id: string;
  candidateId: string;
  canonicalUrl: string;
  mode: CrawlAiModerationDecisionMode;
  status: CrawlAiModerationDecisionStatus;
  verdict: CrawlAiModerationVerdict | null;
  confidence: number | null;
  qualityScore: number | null;
  risks: string[];
  reasons: string[];
  evidence: string[];
  model: string | null;
  policyVersion: string | null;
  errorType: string | null;
  createdAt: number;
}

export interface RecordCrawlAiModerationDecisionInput {
  candidateId: string;
  canonicalUrl: string;
  mode: CrawlAiModerationDecisionMode;
  status: CrawlAiModerationDecisionStatus;
  verdict?: CrawlAiModerationVerdict | null;
  confidence?: number | null;
  qualityScore?: number | null;
  risks?: string[];
  reasons?: string[];
  evidence?: string[];
  model?: string | null;
  policyVersion?: string | null;
  errorType?: string | null;
  createdAt?: number;
}

function rowToDecision(row: Record<string, unknown>): CrawlAiModerationDecision {
  const parseList = (value: unknown): string[] => {
    try {
      const parsed = JSON.parse(String(value ?? "[]"));
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch { return []; }
  };
  return {
    id: String(row.id),
    candidateId: String(row.candidate_id),
    canonicalUrl: String(row.canonical_url),
    mode: String(row.mode) as CrawlAiModerationDecisionMode,
    status: String(row.status) as CrawlAiModerationDecisionStatus,
    verdict: row.verdict == null ? null : String(row.verdict) as CrawlAiModerationVerdict,
    confidence: row.confidence == null ? null : Number(row.confidence),
    qualityScore: row.quality_score == null ? null : Number(row.quality_score),
    risks: parseList(row.risks_json),
    reasons: parseList(row.reasons_json),
    evidence: parseList(row.evidence_json),
    model: row.model == null ? null : String(row.model),
    policyVersion: row.policy_version == null ? null : String(row.policy_version),
    errorType: row.error_type == null ? null : String(row.error_type),
    createdAt: Number(row.created_at),
  };
}

/** 追加式审核历史：每次模型判断写一行，不覆盖候选当前 evidence。 */
export async function recordCrawlAiModerationDecision(
  repo: Repository,
  input: RecordCrawlAiModerationDecisionInput,
): Promise<CrawlAiModerationDecision> {
  const candidateId = input.candidateId.trim().slice(0, 64);
  const canonicalUrl = input.canonicalUrl.trim().slice(0, 2048);
  if (!candidateId || !canonicalUrl) throw new TypeError("审核历史必须包含候选 ID 和规范 URL");
  if (!["shadow", "auto"].includes(input.mode)) throw new TypeError("审核历史 mode 无效");
  if (!["completed", "error", "quota_blocked"].includes(input.status)) throw new TypeError("审核历史 status 无效");
  if (input.verdict != null && !["auto_approve", "reject", "manual_review"].includes(input.verdict)) {
    throw new TypeError("审核历史 verdict 无效");
  }
  const confidence = input.confidence == null ? null : Number(input.confidence);
  const qualityScore = input.qualityScore == null ? null : Number(input.qualityScore);
  if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new RangeError("审核历史 confidence 超出范围");
  }
  if (qualityScore != null && (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 100)) {
    throw new RangeError("审核历史 qualityScore 超出范围");
  }
  const risks = (input.risks ?? []).filter(x => typeof x === "string").slice(0, 12).map(x => x.slice(0, 32));
  const reasons = (input.reasons ?? []).filter(x => typeof x === "string").slice(0, 8).map(x => x.slice(0, 240));
  const evidence = (input.evidence ?? []).filter(x => typeof x === "string").slice(0, 8).map(x => x.slice(0, 300));
  const record: CrawlAiModerationDecision = {
    id: randomUUID(), candidateId, canonicalUrl,
    mode: input.mode, status: input.status, verdict: input.verdict ?? null,
    confidence, qualityScore, risks, reasons, evidence,
    model: input.model?.slice(0, 120) ?? null,
    policyVersion: input.policyVersion?.slice(0, 80) ?? null,
    errorType: input.errorType?.slice(0, 120) ?? null,
    createdAt: input.createdAt ?? Date.now(),
  };
  await repo.run(
    `INSERT INTO crawl_ai_moderation_decisions
      (id, candidate_id, canonical_url, mode, status, verdict, confidence, quality_score,
       risks_json, reasons_json, evidence_json, model, policy_version, error_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.candidateId, record.canonicalUrl, record.mode, record.status,
      record.verdict, record.confidence, record.qualityScore, JSON.stringify(record.risks),
      JSON.stringify(record.reasons), JSON.stringify(record.evidence), record.model,
      record.policyVersion, record.errorType, record.createdAt],
  );
  return record;
}

export async function listCrawlAiModerationDecisions(
  repo: Repository,
  options: { candidateId: string; limit?: number; offset?: number },
): Promise<CrawlAiModerationDecision[]> {
  const candidateId = options.candidateId.trim().slice(0, 64);
  if (!candidateId) throw new TypeError("candidateId 不能为空");
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const rows = await repo.raw(
    "SELECT * FROM crawl_ai_moderation_decisions WHERE candidate_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [candidateId, limit, offset],
  );
  return rows.map(rowToDecision);
}

export async function countCrawlAiModerationDecisions(repo: Repository, candidateId: string): Promise<number> {
  const id = candidateId.trim().slice(0, 64);
  if (!id) throw new TypeError("candidateId 不能为空");
  const rows = await repo.raw(
    "SELECT COUNT(*) AS total FROM crawl_ai_moderation_decisions WHERE candidate_id = ?",
    [id],
  );
  return Number(rows[0]?.total ?? 0);
}
