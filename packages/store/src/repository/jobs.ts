import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import {
  buildFtsTokens,
  canonicalizeUrl,
  getEnhancedSiteData,
  pinyinTraits,
  type Category,
  type Collection,
  type Site,
  type SiteAction,
  type SiteLiveMetrics,
  type SiteRelation,
  type SiteStatus,
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  CategoryDistributionItem,
  DashboardOverview,
  FavoriteFolderRecord,
  FavoriteRecord,
  JobRecord,
  MaintenanceStatus,
  SecurityOverview,
  SiteInput,
  TagWithCount,
  UserProfileRecord,
  UserRecord,
  UserVaultRecord,
} from "./records.ts";
import {
  bindSqlite,
  buildIndexFields,
  normalizeTokenScopes,
  packMetadata,
  rowToApiToken,
  rowToAuditLog,
  rowToCategory,
  rowToCollection,
  rowToFavorite,
  rowToFolder,
  rowToJob,
  rowToProfile,
  rowToSite,
  rowToUser,
  slugify,
  toPgSql,
} from "./dialect.ts";
import type { Db } from "../driver.ts";

export async function enqueueJob(repo: Repository, kind: string, payload: unknown): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await repo.run(
    // next_run_at 显式置 NULL：重试/重入同一语义 = 立即可被认领
    "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at, next_run_at) VALUES (?,?,?, 'pending', 0, ?, ?, NULL)",
    [id, kind, payload === undefined ? null : JSON.stringify(payload), now, now],
  );
  return id;
}

export async function claimNextJob(repo: Repository): Promise<JobRecord | null> {
  if (repo.db.dialect === "pg") {
    const now = Date.now();
    const rows = await repo.raw(
      "WITH next AS (" +
        "SELECT id FROM jobs WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) " +
        "ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED" +
        ") UPDATE jobs SET status = 'running', attempts = attempts + 1, next_run_at = NULL, updated_at = ? " +
        "FROM next WHERE jobs.id = next.id RETURNING jobs.*",
      [now, now],
    );
    const row = rows[0];
    return row ? rowToJob(row) : null;
  }
  return repo.withTransaction(async () => {
    const rows = await repo.raw(
      "SELECT * FROM jobs WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY created_at ASC LIMIT 1",
      [Date.now()],
    );
    const row = rows[0];
    if (!row) return null;
    await repo.run(
      "UPDATE jobs SET status = 'running', attempts = attempts + 1, next_run_at = NULL, updated_at = ? WHERE id = ? AND status = 'pending'",
      [Date.now(), String(row.id)],
    );
    // 返回更新后的行（attempts 已 +1），调用方拿到的就是最新状态
    const updated = (await repo.raw("SELECT * FROM jobs WHERE id = ?", [String(row.id)]))[0];
    return updated ? rowToJob(updated) : rowToJob(row);
  });
}

export async function completeJob(repo: Repository, id: string, error?: string | null, opts: { retryAt?: number | null; exhausted?: boolean } | null = null): Promise<void> {
  const now = Date.now();
  if (error && !opts?.exhausted && opts?.retryAt) {
    await repo.run(
      "UPDATE jobs SET status = 'pending', error = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
      [error, opts.retryAt, now, id],
    );
    return;
  }
  await repo.run(
    "UPDATE jobs SET status = ?, error = ?, next_run_at = NULL, updated_at = ? WHERE id = ?",
    [error ? "failed" : "done", error ?? null, now, id],
  );
}

export async function listJobs(repo: Repository, status?: string, limit = 50): Promise<JobRecord[]> {
  const rows = status
    ? await repo.raw("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?", [status, limit])
    : await repo.raw("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows.map(rowToJob);
}

export async function getJob(repo: Repository, id: string): Promise<JobRecord | null> {
  const rows = await repo.raw("SELECT * FROM jobs WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function cancelJob(repo: Repository, id: string): Promise<boolean> {
  const now = Date.now();
  await repo.run(
    "UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending', 'running')",
    [now, id],
  );
  return true;
}

export async function retryJob(repo: Repository, id: string): Promise<JobRecord | null> {
  const job = await repo.getJob(id);
  if (!job) return null;
  const now = Date.now();
  await repo.run(
    "UPDATE jobs SET status = 'pending', attempts = 0, error = NULL, next_run_at = NULL, updated_at = ? WHERE id = ?",
    [now, id],
  );
  return repo.getJob(id);
}

export async function pruneJobs(repo: Repository, olderThanDays = 7, statuses: string[] = ["done", "failed", "cancelled"]): Promise<{ pruned: number }> {
  const cutoff = Date.now() - olderThanDays * 86400_000;
  if (statuses.length === 0) return { pruned: 0 };
  const placeholders = statuses.map(() => "?").join(",");
  const countRow = (await repo.raw(
    "SELECT COUNT(*) AS c FROM jobs WHERE status IN (" + placeholders + ") AND updated_at <= ?",
    [...statuses, cutoff],
  ))[0];
  const pruned = Number(countRow?.c ?? 0);
  if (pruned > 0) {
    await repo.run(
      "DELETE FROM jobs WHERE status IN (" + placeholders + ") AND updated_at <= ?",
      [...statuses, cutoff],
    );
  }
  return { pruned };
}

export async function purgeExpiredDeletedSites(repo: Repository, olderThanMs: number): Promise<number> {
  const threshold = Date.now() - olderThanMs;
  const rows = await repo.raw("SELECT id FROM sites WHERE deleted_at IS NOT NULL AND deleted_at < ?", [threshold]);
  let count = 0;
  for (const r of rows) {
    if (r.id) {
      await repo.purgeSite(String(r.id));
      count++;
    }
  }
  return count;
}
