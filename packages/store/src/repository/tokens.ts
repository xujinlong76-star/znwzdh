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

/** last_used_at 的写入节流窗口：同 id 在这个间隔内只写一次 */

export const TOKEN_TOUCH_THROTTLE_MS = 60_000;



export async function createApiToken(repo: Repository, input: {
    name: string;
    tokenHash: string;
    scopes?: string;
    expiresAt?: number | null;
    /** 明文前缀（不含可还原部分），供列表页区分凭据 */
    tokenPrefix?: string | null;
  }): Promise<ApiTokenRecord> {
  const id = randomUUID();
  const now = Date.now();
  // 归一化：小写 + 去重 + 丢弃非法值。即使调用方绕过路由层直接传大写/非法 scope，
  // 落库也始终是干净的 "read,write,admin" 集合。
  const scopes = normalizeTokenScopes(input.scopes);
  await repo.run(
    "INSERT INTO api_tokens (id, name, token_hash, scopes, expires_at, created_at, token_prefix) VALUES (?,?,?,?,?,?,?)",
    [id, input.name, input.tokenHash, scopes, input.expiresAt ?? null, now, input.tokenPrefix ?? null],
  );
  return {
    id,
    name: input.name,
    scopes: scopes.split(","),
    expiresAt: input.expiresAt ?? null,
    lastUsedAt: null,
    createdAt: now,
    revokedAt: null,
    rotatedAt: null,
    tokenPrefix: input.tokenPrefix ?? null,
  };
}

export async function updateApiToken(repo: Repository, id: string, patch: { name?: string; scopes?: string; expiresAt?: number | null }): Promise<ApiTokenRecord | null> {
  const existing = (await repo.raw("SELECT * FROM api_tokens WHERE id = ? LIMIT 1", [id]))[0];
  if (!existing) return null;
  const name = patch.name ?? String(existing.name);
  const scopes = patch.scopes !== undefined ? normalizeTokenScopes(patch.scopes) : String(existing.scopes ?? "read");
  const expiresAt = patch.expiresAt !== undefined ? patch.expiresAt : (existing.expires_at == null ? null : Number(existing.expires_at));
  await repo.run("UPDATE api_tokens SET name = ?, scopes = ?, expires_at = ? WHERE id = ?", [name, scopes, expiresAt, id]);
  const row = (await repo.raw("SELECT * FROM api_tokens WHERE id = ? LIMIT 1", [id]))[0]!;
  return rowToApiToken(row);
}

export async function rotateApiToken(repo: Repository, id: string,
    tokenHash: string,
    expiresAt?: number | null,
    tokenPrefix?: string | null): Promise<ApiTokenRecord | null> {
  const existing = (await repo.raw("SELECT * FROM api_tokens WHERE id = ? LIMIT 1", [id]))[0];
  if (!existing) return null;
  const finalExpiresAt = expiresAt !== undefined ? expiresAt : (existing.expires_at == null ? null : Number(existing.expires_at));
  const finalPrefix = tokenPrefix !== undefined ? tokenPrefix : (existing.token_prefix == null ? null : String(existing.token_prefix));
  const now = Date.now();
  await repo.run(
    "UPDATE api_tokens SET token_hash = ?, expires_at = ?, token_prefix = ?, last_used_at = NULL, rotated_at = ? WHERE id = ?",
    [tokenHash, finalExpiresAt, finalPrefix, now, id],
  );
  const row = (await repo.raw("SELECT * FROM api_tokens WHERE id = ? LIMIT 1", [id]))[0]!;
  return rowToApiToken(row);
}

export async function revokeApiToken(repo: Repository, id: string): Promise<ApiTokenRecord | null> {
  const existing = (await repo.raw("SELECT * FROM api_tokens WHERE id = ? LIMIT 1", [id]))[0];
  if (!existing) return null;
  const now = Date.now();
  const already = existing.revoked_at != null;
  if (!already) {
    await repo.run("UPDATE api_tokens SET revoked_at = ? WHERE id = ?", [now, id]);
  }
  const row = (await repo.raw("SELECT * FROM api_tokens WHERE id = ? LIMIT 1", [id]))[0]!;
  return rowToApiToken(row);
}

export async function findApiTokenByHash(repo: Repository, tokenHash: string): Promise<ApiTokenRecord | null> {
  const row = (await repo.raw("SELECT * FROM api_tokens WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
  if (!row) return null;
  if (row.revoked_at != null) return null;
  if (row.expires_at != null && Number(row.expires_at) < Date.now()) return null;
  return rowToApiToken(row);
}

export async function touchApiToken(repo: Repository, id: string): Promise<void> {
  const now = Date.now();
  const last = repo.tokenTouchAt.get(id) ?? 0;
  if (now - last < TOKEN_TOUCH_THROTTLE_MS) return;
  // 先记后写：即使写失败也不会在下一毫秒重试，避免失败风暴
  repo.tokenTouchAt.set(id, now);
  await repo.run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [now, id]);
}

export async function listApiTokens(repo: Repository): Promise<ApiTokenRecord[]> {
  const rows = await repo.raw("SELECT * FROM api_tokens ORDER BY created_at DESC", []);
  return rows.map(rowToApiToken);
}

export async function deleteApiToken(repo: Repository, id: string): Promise<boolean> {
  const existed = (await repo.raw("SELECT id FROM api_tokens WHERE id = ? LIMIT 1", [id]))[0];
  await repo.run("DELETE FROM api_tokens WHERE id = ?", [id]);
  return Boolean(existed);
}
