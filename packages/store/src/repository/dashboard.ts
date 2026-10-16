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

export async function dashboardOverview(repo: Repository): Promise<DashboardOverview> {
  const one = async (q: string, p: unknown[] = []) => Number((await repo.raw(q, p))[0]?.c ?? 0);
  const now = Date.now();
  const since24h = now - 86_400_000;

  const [
    totalSites, activeSites, brokenSites, pendingSites, archivedSites, trashedSites,
    categoriesCount, tagsCount, collectionsCount, favoritesCount,
    newSites24h,
    healthStats24h,
    jobsTotal24h, jobsCompleted24h, jobsFailed24h, jobsPending, jobsRunning,
    auditLogs24h, authFailures24h,
    eventsTotal24h, searches24h, clicks24h, zeroResults24h,
    storageMetrics,
  ] = await Promise.all([
    one("SELECT COUNT(*) AS c FROM sites WHERE deleted_at IS NULL"),
    one("SELECT COUNT(*) AS c FROM sites WHERE status = 'active' AND enabled = " + repo.enabledLiteral + " AND deleted_at IS NULL"),
    one("SELECT COUNT(*) AS c FROM sites WHERE status = 'broken' AND deleted_at IS NULL"),
    one("SELECT COUNT(*) AS c FROM sites WHERE status = 'pending' AND deleted_at IS NULL"),
    one("SELECT COUNT(*) AS c FROM sites WHERE status = 'archived' AND deleted_at IS NULL"),
    one("SELECT COUNT(*) AS c FROM sites WHERE deleted_at IS NOT NULL"),
    one("SELECT COUNT(*) AS c FROM categories"),
    one("SELECT COUNT(*) AS c FROM tags"),
    one("SELECT COUNT(*) AS c FROM collections"),
    one("SELECT COUNT(*) AS c FROM favorites"),
    one("SELECT COUNT(*) AS c FROM sites WHERE created_at >= ? AND deleted_at IS NULL", [since24h]),
    (async () => {
      const rows = await repo.raw(
        "SELECT ok, latency_ms FROM health_checks WHERE checked_at >= ?",
        [since24h]
      );
      const total = rows.length;
      let okCount = 0;
      let latencySum = 0;
      let latencyN = 0;
      for (const r of rows) {
        if (r.ok) okCount++;
        if (r.latency_ms !== null && r.latency_ms !== undefined) {
          latencySum += Number(r.latency_ms);
          latencyN++;
        }
      }
      const rate = total > 0 ? Math.round((okCount / total) * 1000) / 10 : null;
      const avgLatencyMs = latencyN > 0 ? Math.round(latencySum / latencyN) : null;
      return { total, failed: total - okCount, rate, avgLatencyMs };
    })(),
    one("SELECT COUNT(*) AS c FROM jobs WHERE created_at >= ?", [since24h]),
    one("SELECT COUNT(*) AS c FROM jobs WHERE status = 'completed' AND created_at >= ?", [since24h]),
    one("SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed' AND created_at >= ?", [since24h]),
    one("SELECT COUNT(*) AS c FROM jobs WHERE status = 'pending'"),
    one("SELECT COUNT(*) AS c FROM jobs WHERE status = 'running'"),
    one("SELECT COUNT(*) AS c FROM audit_logs WHERE created_at >= ?", [since24h]),
    one("SELECT COUNT(*) AS c FROM audit_logs WHERE action LIKE 'auth.%' AND created_at >= ?", [since24h]),
    one("SELECT COUNT(*) AS c FROM events WHERE created_at >= ?", [since24h]),
    one("SELECT COUNT(*) AS c FROM events WHERE kind = 'search' AND created_at >= ?", [since24h]),
    one("SELECT COUNT(*) AS c FROM events WHERE kind = 'click' AND created_at >= ?", [since24h]),
    one("SELECT COUNT(*) AS c FROM events WHERE kind = 'zero_result' AND created_at >= ?", [since24h]),
    repo.dbStorageMetrics(),
  ]);

  return {
    overview: {
      totalSites,
      activeSites,
      brokenSites,
      pendingSites,
      archivedSites,
      trashedSites,
      categories: categoriesCount,
      tags: tagsCount,
      collections: collectionsCount,
      favorites: favoritesCount,
    },
    metrics24h: {
      newSites: newSites24h,
      healthChecks: healthStats24h.total,
      healthFailed: healthStats24h.failed,
      healthRate: healthStats24h.rate,
      avgLatencyMs: healthStats24h.avgLatencyMs,
      jobsTotal: jobsTotal24h,
      jobsCompleted: jobsCompleted24h,
      jobsFailed: jobsFailed24h,
      jobsPending,
      jobsRunning,
      auditLogs: auditLogs24h,
      authFailures: authFailures24h,
      eventsTotal: eventsTotal24h,
      searches: searches24h,
      clicks: clicks24h,
      zeroResults: zeroResults24h,
    },
    storage: storageMetrics,
  };
}

export async function categorySiteDistribution(repo: Repository, limit = 10): Promise<CategoryDistributionItem[]> {
  const totalRow = (await repo.raw("SELECT COUNT(*) AS c FROM sites WHERE deleted_at IS NULL", []))[0];
  const total = Number(totalRow?.c ?? 0);

  const rows = await repo.raw(
    "SELECT c.id, c.title, c.icon, COUNT(s.id) AS site_count " +
    "FROM categories c " +
    "LEFT JOIN sites s ON (s.category_id = c.id OR s.sub_category_id = c.id) AND s.deleted_at IS NULL " +
    "WHERE c.parent_id IS NULL " +
    "GROUP BY c.id ORDER BY site_count DESC LIMIT ?",
    [limit]
  );

  return rows.map((r) => {
    const siteCount = Number(r.site_count ?? 0);
    const percentage = total > 0 ? Math.round((siteCount / total) * 1000) / 10 : 0;
    return {
      id: String(r.id),
      title: String(r.title),
      icon: r.icon ? String(r.icon) : null,
      siteCount,
      percentage,
    };
  });
}

export async function dbStorageMetrics(repo: Repository): Promise<{ dbSizeBytes: number | null; walSizeBytes: number | null; tableCounts: Record<string, number> }> {
  let dbSizeBytes: number | null = null;
  let walSizeBytes: number | null = null;

  if (repo.db.dialect === "sqlite" && repo.db.sqlite) {
    try {
      const pageCount = Number((repo.db.sqlite.prepare("PRAGMA page_count").get() as any)?.["page_count"] ?? 0);
      const pageSize = Number((repo.db.sqlite.prepare("PRAGMA page_size").get() as any)?.["page_size"] ?? 4096);
      dbSizeBytes = pageCount * pageSize;
    } catch {
      // 兼容在非原生支持 PRAGMA 环境下的退化
    }
  } else if (repo.db.dialect === "pg" && repo.db.pg) {
    try {
      const res = await repo.raw("SELECT pg_database_size(current_database()) AS size", []);
      dbSizeBytes = Number(res[0]?.size ?? 0);
    } catch {
      // pg error fallback
    }
  }

  const one = async (table: string) => {
    try {
      const r = await repo.raw("SELECT COUNT(*) AS c FROM " + table, []);
      return Number(r[0]?.c ?? 0);
    } catch {
      return 0;
    }
  };

  const tables = ["sites", "categories", "tags", "events", "health_checks", "audit_logs", "jobs", "embeddings", "favorites", "api_tokens"];
  const counts = await Promise.all(tables.map(one));
  const tableCounts: Record<string, number> = {};
  for (let i = 0; i < tables.length; i++) {
    tableCounts[tables[i]!] = counts[i] ?? 0;
  }

  return { dbSizeBytes, walSizeBytes, tableCounts };
}

export async function securityOverview(repo: Repository, hours = 24): Promise<SecurityOverview> {
  const since = Date.now() - hours * 3600_000;
  const failuresRows = await repo.raw(
    "SELECT action, ip, COUNT(*) AS cnt, MAX(created_at) AS last_at FROM audit_logs WHERE action LIKE 'auth.%' AND created_at >= ? GROUP BY action, ip ORDER BY cnt DESC LIMIT 10",
    [since]
  );
  const totalFailuresRow = (await repo.raw(
    "SELECT COUNT(*) AS c FROM audit_logs WHERE action LIKE 'auth.%' AND created_at >= ?",
    [since]
  ))[0];

  const recentAudits = (await repo.raw(
    "SELECT id, actor, actor_kind AS actorKind, action, target, created_at AS createdAt FROM audit_logs ORDER BY created_at DESC LIMIT 10",
    []
  )).map((r) => ({
    id: Number(r.id),
    actor: String(r.actor),
    actorKind: String(r.actorKind),
    action: String(r.action),
    target: r.target ? String(r.target) : null,
    createdAt: Number(r.createdAt),
  }));

  const now = Date.now();
  const tokenRows = await repo.raw("SELECT expires_at, revoked_at FROM api_tokens", []);
  let activeTokens = 0;
  let expiredTokens = 0;
  let revokedTokens = 0;
  for (const t of tokenRows) {
    if (t.revoked_at !== null) {
      revokedTokens++;
    } else if (t.expires_at !== null && Number(t.expires_at) < now) {
      expiredTokens++;
    } else {
      activeTokens++;
    }
  }

  return {
    recentFailures: failuresRows.map((r) => ({
      action: String(r.action),
      ip: r.ip ? String(r.ip) : null,
      count: Number(r.cnt ?? 0),
      lastAt: Number(r.last_at ?? 0),
    })),
    totalAuthFailures24h: Number(totalFailuresRow?.c ?? 0),
    recentAudits,
    tokenStats: {
      total: tokenRows.length,
      active: activeTokens,
      expired: expiredTokens,
      revoked: revokedTokens,
    },
  };
}

export async function jobsQueueDepth(repo: Repository): Promise<{ pending: number; running: number }> {
  const one = async (q: string, p: unknown[] = []) => Number((await repo.raw(q, p))[0]?.c ?? 0);
  const [pending, running] = await Promise.all([
    one("SELECT COUNT(*) AS c FROM jobs WHERE status = 'pending'", []),
    one("SELECT COUNT(*) AS c FROM jobs WHERE status = 'running'", []),
  ]);
  return { pending, running };
}
