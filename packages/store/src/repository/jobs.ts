import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import {
  buildFtsTokens,
  canonicalizeUrl,
  pinyinTraits,
  type Category,
  type Collection,
  type Site,
  type SiteStatus,
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  FavoriteFolderRecord,
  FavoriteRecord,
  JobRecord,
  SiteInput,
  TagWithCount,
  UserProfileRecord,
  UserRecord,
  UserVaultRecord,
} from "./records.ts";
import {
  bindSqlite,
  buildIndexFields,
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
