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

export async function upsertOauthUser(repo: Repository, input: { id?: string; username: string; email?: string | null; avatar?: string | null; source?: string }): Promise<UserRecord> {
  let row = (await repo.raw("SELECT * FROM users WHERE username = ? LIMIT 1", [input.username]))[0];
  if (!row && input.email) {
    row = (await repo.raw("SELECT * FROM users WHERE email = ? LIMIT 1", [input.email]))[0];
  }
  if (row) {
    await repo.run(
      "UPDATE users SET email = COALESCE(?, email), avatar = COALESCE(?, avatar), source = ? WHERE id = ?",
      [input.email ?? null, input.avatar ?? null, input.source ?? "github", String(row.id)],
    );
    const updated = (await repo.raw("SELECT * FROM users WHERE id = ?", [String(row.id)]))[0];
    if (!updated) throw new Error("更新用户后无法读回");
    return rowToUser(updated);
  }
  const id = input.id ?? randomUUID();
  // password_hash 为 NOT NULL；OAuth 用户无密码，置空串（本系统登录走 next-auth 会话，不查密码）
  await repo.run(
    "INSERT INTO users (id, username, password_hash, role, email, avatar, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, input.username, "", "user", input.email ?? null, input.avatar ?? null, input.source ?? "github", Date.now()],
  );
  return { id, username: input.username, role: "user", email: input.email ?? null, avatar: input.avatar ?? null, source: input.source ?? "github" };
}

export async function getUser(repo: Repository, idOrUsername: string): Promise<UserRecord | null> {
  const row = (await repo.raw("SELECT * FROM users WHERE id = ? OR username = ? LIMIT 1", [idOrUsername, idOrUsername]))[0];
  return row ? rowToUser(row) : null;
}
