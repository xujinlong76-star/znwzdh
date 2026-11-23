import type { Repository } from "../repository.ts";

export type DiscoveryCandidateStatus = "pending" | "approved" | "rejected";

export interface SiteDiscoveryCandidate {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  categoryId: string | null;
  tags: string[];
  source: string;
  confidence: number | null;
  evidence: Record<string, unknown>;
  status: DiscoveryCandidateStatus;
  siteId: string | null;
  discoveredAt: number;
  lastSeenAt: number;
  reviewedAt: number | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  updatedAt: number;
}

export interface UpsertSiteDiscoveryCandidateInput {
  id: string;
  url: string;
  canonicalUrl: string;
  title?: string | null;
  description?: string | null;
  categoryId?: string | null;
  tags?: string[];
  source: string;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
  now?: number;
}

function rowToCandidate(row: Record<string, unknown>): SiteDiscoveryCandidate {
  return {
    id: String(row.id),
    url: String(row.url),
    canonicalUrl: String(row.canonical_url),
    title: row.title == null ? null : String(row.title),
    description: row.description == null ? null : String(row.description),
    categoryId: row.category_id == null ? null : String(row.category_id),
    tags: JSON.parse(String(row.tags_json ?? "[]")) as string[],
    source: String(row.source),
    confidence: row.confidence == null ? null : Number(row.confidence),
    evidence: JSON.parse(String(row.evidence_json ?? "{}")) as Record<string, unknown>,
    status: String(row.status) as DiscoveryCandidateStatus,
    siteId: row.site_id == null ? null : String(row.site_id),
    discoveredAt: Number(row.discovered_at),
    lastSeenAt: Number(row.last_seen_at),
    reviewedAt: row.reviewed_at == null ? null : Number(row.reviewed_at),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    rejectionReason: row.rejection_reason == null ? null : String(row.rejection_reason),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * URL 去重后进入待审核队列。已审核记录不会被新采集覆盖或重新打开；
 * pending 记录只更新最新证据与 last_seen_at，保留最初 discovered_at。
 */
export async function upsertSiteDiscoveryCandidate(
  repo: Repository,
  input: UpsertSiteDiscoveryCandidateInput,
): Promise<SiteDiscoveryCandidate> {
  const now = input.now ?? Date.now();
  await repo.run(
    `INSERT INTO site_discovery_candidates
      (id, url, canonical_url, title, description, category_id, tags_json, source,
       confidence, evidence_json, status, discovered_at, last_seen_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
     ON CONFLICT(canonical_url) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at,
       evidence_json = CASE WHEN site_discovery_candidates.status = 'pending'
         THEN excluded.evidence_json ELSE site_discovery_candidates.evidence_json END,
       confidence = CASE WHEN site_discovery_candidates.status = 'pending'
         THEN excluded.confidence ELSE site_discovery_candidates.confidence END,
       title = CASE WHEN site_discovery_candidates.status = 'pending' AND
         (site_discovery_candidates.title IS NULL OR site_discovery_candidates.title = '')
         THEN excluded.title ELSE site_discovery_candidates.title END,
       description = CASE WHEN site_discovery_candidates.status = 'pending' AND
         (site_discovery_candidates.description IS NULL OR site_discovery_candidates.description = '')
         THEN excluded.description ELSE site_discovery_candidates.description END`,
    [
      input.id, input.url, input.canonicalUrl, input.title ?? null, input.description ?? null,
      input.categoryId ?? null, JSON.stringify(input.tags ?? []), input.source,
      input.confidence ?? null, JSON.stringify(input.evidence ?? {}), now, now, now,
    ],
  );
  const rows = await repo.raw(
    "SELECT * FROM site_discovery_candidates WHERE canonical_url = ? LIMIT 1",
    [input.canonicalUrl],
  );
  if (!rows[0]) throw new Error("采集候选写入后无法读取");
  return rowToCandidate(rows[0]);
}

export async function getSiteDiscoveryCandidate(
  repo: Repository,
  id: string,
): Promise<SiteDiscoveryCandidate | null> {
  const rows = await repo.raw("SELECT * FROM site_discovery_candidates WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? rowToCandidate(rows[0]) : null;
}

export async function listSiteDiscoveryCandidates(
  repo: Repository,
  options: { status?: DiscoveryCandidateStatus; limit?: number; offset?: number } = {},
): Promise<SiteDiscoveryCandidate[]> {
  const where = options.status ? "WHERE status = ?" : "";
  const params: unknown[] = options.status ? [options.status] : [];
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const rows = await repo.raw(
    `SELECT * FROM site_discovery_candidates ${where}
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
        discovered_at DESC, id ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(rowToCandidate);
}

export async function countSiteDiscoveryCandidates(
  repo: Repository,
  status?: DiscoveryCandidateStatus,
): Promise<number> {
  const rows = await repo.raw(
    "SELECT COUNT(*) AS total FROM site_discovery_candidates" + (status ? " WHERE status = ?" : ""),
    status ? [status] : [],
  );
  return Number(rows[0]?.total ?? 0);
}

/** 只允许 pending 记录完成一次审核；调用方随后回读以检测并发审核冲突。 */
export async function reviewSiteDiscoveryCandidate(
  repo: Repository,
  input: {
    id: string;
    status: "approved" | "rejected";
    reviewer: string;
    siteId?: string | null;
    rejectionReason?: string | null;
    now?: number;
  },
): Promise<SiteDiscoveryCandidate | null> {
  const now = input.now ?? Date.now();
  await repo.run(
    `UPDATE site_discovery_candidates
        SET status = ?, site_id = ?, reviewed_at = ?, reviewed_by = ?,
            rejection_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'`,
    [
      input.status, input.siteId ?? null, now, input.reviewer,
      input.rejectionReason ?? null, now, input.id,
    ],
  );
  return getSiteDiscoveryCandidate(repo, input.id);
}
