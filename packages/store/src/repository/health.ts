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
  // 两条写必须同生同死：只写了 sites 而没写进 health_checks，
  // 连续失败判定（recentHealthChecks）就少算一次，站点会被误判或漏判为 broken
  return repo.withTransaction(async () => {
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
  });
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

/**
 * 最近 N 次巡检结果（新→旧）。
 *
 * 用途：健康判定从「单次失败即 broken」改为「连续 N 次失败才 broken」。
 * 实测背景：50 个站点里 15 个被标 broken，其中 kubernetes.io / figma.com /
 * npmjs.com 全部可正常访问 —— 单次探测遇到 403/429/超时就会把健康站点打进
 * 冷宫，前台还可能显示「已失效」。连续失败阈值能过滤掉绝大多数抖动。
 */
export async function recentHealthChecks(
  repo: Repository,
  siteId: string,
  limit = 5,
): Promise<Array<{ ok: boolean; checkedAt: number }>> {
  const rows = await repo.raw(
    "SELECT ok, checked_at FROM health_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ?",
    [siteId, limit],
  );
  return rows.map((r) => ({
    ok: r.ok === null || r.ok === undefined ? false : Boolean(r.ok),
    checkedAt: Number(r.checked_at ?? 0),
  }));
}

/**
 * 删除 before 之前的巡检历史，返回删除条数。
 *
 * 这张表每个站点每天一行，长期只增不删；它不承载用户内容，
 * 与 llm_usage 同属"可以按 TTL 自动清理"的内部遥测。
 * 用 checked_at 而不是 created_at —— 该表没有 created_at 列。
 */
export async function pruneHealthChecks(repo: Repository, before: number): Promise<number> {
  return repo.runCount("DELETE FROM health_checks WHERE checked_at < ?", [before]);
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
