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

export async function listFavorites(repo: Repository, userId: string): Promise<FavoriteRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
  );
  return rows.map(rowToFavorite);
}

export async function addFavorite(repo: Repository, input: { userId: string; siteId: string; folderId?: string | null; note?: string | null }): Promise<{ favorite: FavoriteRecord; existed: boolean }> {
  const existing = await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? AND site_id = ? LIMIT 1",
    [input.userId, input.siteId],
  );
  const existingRow = existing[0];
  if (existingRow) return { favorite: rowToFavorite(existingRow), existed: true };
  const id = randomUUID();
  const now = Date.now();
  await repo.run(
    "INSERT INTO favorites (id, user_id, site_id, folder_id, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    [id, input.userId, input.siteId, input.folderId ?? null, input.note ?? null, now, now],
  );
  const row = (await repo.raw("SELECT * FROM favorites WHERE id = ?", [id]))[0];
  if (!row) throw new Error("创建收藏后无法读回");
  return { favorite: rowToFavorite(row), existed: false };
}

export async function removeFavorite(repo: Repository, userId: string, siteId: string): Promise<boolean> {
  const changes = await repo.runCount("DELETE FROM favorites WHERE user_id = ? AND site_id = ?", [userId, siteId]);
  return changes > 0;
}

export async function listFavoriteFolders(repo: Repository, userId: string): Promise<FavoriteFolderRecord[]> {
  const rows = await repo.raw(
    "SELECT * FROM favorite_folders WHERE user_id = ? ORDER BY sort ASC, created_at ASC",
    [userId],
  );
  return rows.map(rowToFolder);
}

export async function createFavoriteFolder(repo: Repository, userId: string, name: string): Promise<FavoriteFolderRecord> {
  const id = randomUUID();
  const now = Date.now();
  await repo.run(
    "INSERT INTO favorite_folders (id, user_id, name, sort, created_at) VALUES (?,?,?,?,?)",
    [id, userId, name.trim(), 0, now],
  );
  const row = (await repo.raw("SELECT * FROM favorite_folders WHERE id = ?", [id]))[0];
  if (!row) throw new Error("创建收藏夹后无法读回");
  return rowToFolder(row);
}

export async function deleteFavoriteFolder(repo: Repository, userId: string, folderId: string): Promise<void> {
  const now = Date.now();
  await repo.run(
    "UPDATE favorites SET folder_id = NULL, updated_at = ? WHERE user_id = ? AND folder_id = ?",
    [now, userId, folderId],
  );
  await repo.run("DELETE FROM favorite_folders WHERE id = ? AND user_id = ?", [folderId, userId]);
}

export type FavoriteUpdateResult =
  | { ok: true; favorite: FavoriteRecord }
  | { ok: false; reason: "not_found" | "folder_not_found" };

/**
 * 更新收藏的文件夹 / 备注。
 *
 * 文件夹归属必须校验：folderId 是客户端传的，不校验就能把收藏挂到别人的文件夹上
 * （列表按 user_id 读，挂错后用户自己的文件夹树里就会出现不属于自己的项）。
 */
export async function updateFavorite(
  repo: Repository,
  userId: string,
  siteId: string,
  patch: { folderId?: string | null; note?: string | null },
): Promise<FavoriteUpdateResult> {
  const row = (await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? AND site_id = ? LIMIT 1",
    [userId, siteId],
  ))[0];
  if (!row) return { ok: false, reason: "not_found" };

  if (patch.folderId) {
    const folder = (await repo.raw(
      "SELECT id FROM favorite_folders WHERE id = ? AND user_id = ? LIMIT 1",
      [patch.folderId, userId],
    ))[0];
    if (!folder) return { ok: false, reason: "folder_not_found" };
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.folderId !== undefined) {
    sets.push("folder_id = ?");
    params.push(patch.folderId);
  }
  if (patch.note !== undefined) {
    sets.push("note = ?");
    params.push(patch.note);
  }
  if (sets.length === 0) return { ok: true, favorite: rowToFavorite(row) };

  sets.push("updated_at = ?");
  params.push(Date.now(), userId, siteId);
  await repo.run(`UPDATE favorites SET ${sets.join(", ")} WHERE user_id = ? AND site_id = ?`, params);
  const updated = (await repo.raw(
    "SELECT * FROM favorites WHERE user_id = ? AND site_id = ? LIMIT 1",
    [userId, siteId],
  ))[0];
  if (!updated) return { ok: false, reason: "not_found" };
  return { ok: true, favorite: rowToFavorite(updated) };
}

/** 清空云端收藏（本地 localStorage 由前端自行处理） */
export async function clearFavorites(repo: Repository, userId: string): Promise<number> {
  return repo.runCount("DELETE FROM favorites WHERE user_id = ?", [userId]);
}

export type FavoriteFolderUpdateResult =
  | { ok: true; folder: FavoriteFolderRecord }
  | { ok: false; reason: "not_found" };

/** 文件夹改名 / 排序；只允许操作自己的文件夹 */
export async function updateFavoriteFolder(
  repo: Repository,
  userId: string,
  folderId: string,
  patch: { name?: string; sort?: number },
): Promise<FavoriteFolderUpdateResult> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, reason: "not_found" };
    sets.push("name = ?");
    params.push(name.slice(0, 30));
  }
  if (patch.sort !== undefined) {
    sets.push("sort = ?");
    params.push(Math.trunc(patch.sort));
  }
  if (sets.length === 0) {
    const existing = (await repo.raw(
      "SELECT * FROM favorite_folders WHERE id = ? AND user_id = ? LIMIT 1",
      [folderId, userId],
    ))[0];
    return existing ? { ok: true, folder: rowToFolder(existing) } : { ok: false, reason: "not_found" };
  }
  params.push(folderId, userId);
  const changes = await repo.runCount(
    `UPDATE favorite_folders SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
    params,
  );
  if (changes === 0) return { ok: false, reason: "not_found" };
  const row = (await repo.raw("SELECT * FROM favorite_folders WHERE id = ? LIMIT 1", [folderId]))[0];
  if (!row) return { ok: false, reason: "not_found" };
  return { ok: true, folder: rowToFolder(row) };
}
