import type { Repository } from "../repository.ts";

export interface CrawlAiModerationDecisionInput {
  id: string;
  candidateId: string;
  decisionSource: "ai" | "human";
  mode: "shadow" | "manual";
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
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)));
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
