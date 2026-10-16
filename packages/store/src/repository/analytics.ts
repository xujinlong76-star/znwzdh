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

export async function topQueries(repo: Repository, days = 30, limit = 20): Promise<Array<{ query: string; count: number }>> {
  const since = Date.now() - days * 86_400_000;
  const rows = await repo.raw(
    "SELECT query, COUNT(*) AS cnt FROM events " +
      "WHERE kind = 'search' AND query IS NOT NULL AND query != '' AND created_at >= ? " +
      "GROUP BY query ORDER BY cnt DESC LIMIT ?",
    [since, limit],
  );
  return rows.map((r) => ({ query: String(r.query), count: Number(r.cnt ?? 0) }));
}

export async function zeroResultQueries(repo: Repository, days = 30, limit = 20): Promise<Array<{ query: string; count: number; lastAt: number }>> {
  const since = Date.now() - days * 86_400_000;
  const rows = await repo.raw(
    "SELECT query, COUNT(*) AS cnt, MAX(created_at) AS lastat FROM events " +
      "WHERE kind = 'zero_result' AND created_at >= ? " +
      "GROUP BY query ORDER BY cnt DESC LIMIT ?",
    [since, limit],
  );
  return rows.map((r) => ({ query: String(r.query), count: Number(r.cnt ?? 0), lastAt: Number(r.lastat ?? 0) }));
}

export async function hotSites(repo: Repository, limit = 20): Promise<Site[]> {
  const rows = await repo.raw(
    repo.selectSitesSql() +
      " WHERE s.enabled = " + repo.enabledLiteral + " AND s.status != 'archived' AND s.deleted_at IS NULL" +
      " GROUP BY s.id ORDER BY s.trend_score DESC, s.visit_count DESC, s.sort ASC LIMIT ?",
    [limit],
  );
  return rows.map(rowToSite);
}

export async function newestSites(repo: Repository, limit = 20): Promise<Site[]> {
  const rows = await repo.raw(
    repo.selectSitesSql() +
      " WHERE s.enabled = " + repo.enabledLiteral + " AND s.status != 'archived' AND s.deleted_at IS NULL" +
      " GROUP BY s.id ORDER BY s.created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(rowToSite);
}

export async function getEmbedding(repo: Repository, siteId: string): Promise<Float32Array | null> {
  const row = (await repo.raw("SELECT vector FROM embeddings WHERE site_id = ?", [siteId]))[0];
  const raw = row?.vector;
  if (!raw) return null;
  const buf = raw instanceof Uint8Array ? Buffer.from(raw) : Buffer.from(raw as ArrayBuffer);
  if (buf.byteLength < 4) return null;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}
