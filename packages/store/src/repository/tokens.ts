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

export async function createApiToken(repo: Repository, input: {
    name: string;
    tokenHash: string;
    scopes?: string;
    expiresAt?: number | null;
  }): Promise<ApiTokenRecord> {
  const id = randomUUID();
  const now = Date.now();
  await repo.run(
    "INSERT INTO api_tokens (id, name, token_hash, scopes, expires_at, created_at) VALUES (?,?,?,?,?,?)",
    [id, input.name, input.tokenHash, input.scopes ?? "read", input.expiresAt ?? null, now],
  );
  return { id, name: input.name, scopes: (input.scopes ?? "read").split(",").map((s) => s.trim()).filter(Boolean), expiresAt: input.expiresAt ?? null, lastUsedAt: null, createdAt: now };
}

export async function findApiTokenByHash(repo: Repository, tokenHash: string): Promise<ApiTokenRecord | null> {
  const row = (await repo.raw("SELECT * FROM api_tokens WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
  if (!row) return null;
  if (row.expires_at != null && Number(row.expires_at) < Date.now()) return null;
  return rowToApiToken(row);
}

export async function touchApiToken(repo: Repository, id: string): Promise<void> {
  await repo.run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [Date.now(), id]);
}

export async function listApiTokens(repo: Repository): Promise<ApiTokenRecord[]> {
  const rows = await repo.raw("SELECT * FROM api_tokens ORDER BY created_at DESC", []);
  return rows.map(rowToApiToken);
}

export async function deleteApiToken(repo: Repository, id: string): Promise<boolean> {
  await repo.run("DELETE FROM api_tokens WHERE id = ?", [id]);
  return true;
}
