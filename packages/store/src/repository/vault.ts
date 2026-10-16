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

export async function getUserVault(repo: Repository, userId: string): Promise<UserVaultRecord | null> {
  const rows = await repo.raw(
    "SELECT user_id, payload, version, updated_at AS updatedat FROM user_vault_sync WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: String(row.user_id),
    payload: String(row.payload),
    version: Number(row.version ?? 1),
    updatedAt: Number(row.updatedat ?? 0),
  };
}

export async function saveUserVault(repo: Repository, userId: string, payload: string): Promise<{ version: number; updatedAt: number }> {
  const now = Date.now();
  await repo.run(
    `INSERT INTO user_vault_sync (user_id, payload, version, updated_at)
     VALUES (?,?, 1, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       payload = excluded.payload,
       version = user_vault_sync.version + 1,
       updated_at = excluded.updated_at`,
    [userId, payload, now],
  );
  const updated = await repo.getUserVault(userId);
  return {
    version: updated?.version ?? 1,
    updatedAt: updated?.updatedAt ?? now,
  };
}

export async function deleteUserVault(repo: Repository, userId: string): Promise<boolean> {
  await repo.run("DELETE FROM user_vault_sync WHERE user_id = ?", [userId]);
  return true;
}
