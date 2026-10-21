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

export async function behaviorEvents(repo: Repository, identity: string, since: number, limit = 500): Promise<Array<{ kind: string; siteId: string; categoryId: string | null; tags: string[]; createdAt: number }>> {
  const tagExpr = repo.db.dialect === "sqlite"
    ? "(SELECT group_concat(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = e.site_id)"
    : "(SELECT string_agg(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = e.site_id)";
  const rows = await repo.raw(
    `SELECT e.kind AS kind, e.site_id AS siteid, s.category_id AS categoryid,
            ${tagExpr} AS tagslugs, e.created_at AS createdat
       FROM events e LEFT JOIN sites s ON s.id = e.site_id
      WHERE e.kind IN ('click', 'favorite') AND e.created_at >= ?
        AND e.identity = ?
      ORDER BY e.created_at DESC LIMIT ?`,
    [since, identity, limit],
  );
  return rows
    .filter((r) => r.siteid)
    .map((r) => ({
      kind: String(r.kind),
      siteId: String(r.siteid),
      categoryId: r.categoryid ?? null,
      tags: r.tagslugs ? String(r.tagslugs).split(",").filter(Boolean) : [],
      createdAt: Number(r.createdat ?? 0),
    }));
}

export async function countSearches(repo: Repository, userId: string): Promise<number> {
  const rows = await repo.raw("SELECT COUNT(*) AS c FROM search_history WHERE user_id = ?", [userId]);
  return Number(rows[0]?.c ?? 0);
}

/** 画像解释：窗口内各信号的真实条数（一次分组 + 一次计数，不逐类往返） */
export async function signalCounts(
  repo: Repository,
  identity: string,
  since: number,
): Promise<{ click: number; favorite: number; searches: number }> {
  const events = await repo.raw(
    "SELECT kind, COUNT(*) AS c FROM events WHERE identity = ? AND kind IN ('click','favorite') AND created_at >= ? GROUP BY kind",
    [identity, since],
  );
  const byKind = new Map(events.map((r) => [String(r.kind), Number(r.c ?? 0)]));
  const search = await repo.raw(
    "SELECT COUNT(*) AS c FROM search_history WHERE user_id = ? AND created_at >= ?",
    [identity, since],
  );
  return {
    click: byKind.get("click") ?? 0,
    favorite: byKind.get("favorite") ?? 0,
    searches: Number(search[0]?.c ?? 0),
  };
}

export async function clickCountsSince(repo: Repository, since: number): Promise<Map<string, number>> {
  const rows = await repo.raw(
    "SELECT site_id AS siteid, COUNT(*) AS c FROM events WHERE kind = 'click' AND site_id IS NOT NULL AND created_at >= ? GROUP BY site_id",
    [since],
  );
  const out = new Map<string, number>();
  for (const r of rows) out.set(String(r.siteid), Number(r.c ?? 0));
  return out;
}

export async function favoriteCountsSince(repo: Repository, since: number): Promise<Map<string, number>> {
  const rows = await repo.raw(
    "SELECT site_id AS siteid, COUNT(*) AS c FROM favorites WHERE created_at >= ? GROUP BY site_id",
    [since],
  );
  const out = new Map<string, number>();
  for (const r of rows) out.set(String(r.siteid), Number(r.c ?? 0));
  return out;
}
