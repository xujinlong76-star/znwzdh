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

export async function updateSiteHealth(repo: Repository, siteId: string, health: {
    httpStatus: number | null
    ok: boolean
    latencyMs: number
    redirectTo: string | null
    error: string | null
    /** 失败时是否把 status 置为 broken */
    markBroken?: boolean
    currentStatus?: string
  }): Promise<void> {
  const now = Date.now();
  await repo.run(
    `UPDATE sites SET http_status = ?, health_ok = ?, latency_ms = ?, redirect_to = ?,
            health_error = ?, last_checked_at = ?, status = ? WHERE id = ?`,
    [
      health.httpStatus, health.ok, health.latencyMs, health.redirectTo, health.error, now,
      health.ok ? (health.currentStatus ?? "active") : (health.markBroken === false ? (health.currentStatus ?? "active") : "broken"),
      siteId,
    ],
  );
  await repo.run(
    "INSERT INTO health_checks (site_id, checked_at, ok, http_status, latency_ms, redirect_to, error) VALUES (?,?,?,?,?,?,?)",
    [siteId, now, health.ok, health.httpStatus, health.latencyMs, health.redirectTo, health.error],
  );
}

export async function healthCheckSeries(repo: Repository, since: number, limit = 5000): Promise<Array<{ siteId: string; checkedAt: number; ok: boolean; latencyMs: number | null }>> {
  const rows = await repo.raw(
    "SELECT site_id, checked_at, ok, latency_ms FROM health_checks WHERE checked_at >= ? ORDER BY checked_at ASC LIMIT ?",
    [since, limit],
  );
  return rows.map((r) => ({
    siteId: String(r.site_id),
    checkedAt: Number(r.checked_at ?? 0),
    ok: r.ok === null || r.ok === undefined ? false : Boolean(r.ok),
    latencyMs: r.latency_ms === null || r.latency_ms === undefined ? null : Number(r.latency_ms),
  }));
}

export async function bumpVisit(repo: Repository, siteId: string): Promise<void> {
  const now = Date.now();
  await repo.run(
    "UPDATE sites SET visit_count = visit_count + 1, last_visited_at = ?, updated_at = ? WHERE id = ?",
    [now, now, siteId],
  );
}

export async function setTrendScores(repo: Repository, scores: Array<{ id: string; trendScore: number }>): Promise<void> {
  await repo.withTransaction(async () => {
    const now = Date.now();
    for (const s of scores) {
      await repo.run("UPDATE sites SET trend_score = ?, weight = ?, updated_at = ? WHERE id = ?", [s.trendScore, s.trendScore, now, s.id]);
    }
  });
}
