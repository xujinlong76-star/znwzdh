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

export async function recordSearch(repo: Repository, userId: string, query: string, resultCount: number): Promise<void> {
  const q = query.trim();
  if (!q) return;
  // id 自增：同毫秒的多条记录也能按插入顺序稳定排序
  await repo.run(
    "INSERT INTO search_history (user_id, query, result_count, created_at) VALUES (?,?,?,?)",
    [userId, q, resultCount, Date.now()],
  );
}

export async function listSearchHistory(repo: Repository, userId: string, limit = 10): Promise<Array<{ query: string; resultCount: number; createdAt: number }>> {
  // 自增 id 作次级排序键：created_at 同毫秒时按真实插入顺序
  const rows = await repo.raw(
    "SELECT query, result_count AS resultcount, created_at AS createdat FROM search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    [userId, limit],
  );
  return rows.map((r) => ({
    query: String(r.query),
    resultCount: Number(r.resultcount ?? 0),
    createdAt: Number(r.createdat ?? 0),
  }));
}

export async function clearSearchHistory(repo: Repository, userId: string): Promise<void> {
  await repo.run("DELETE FROM search_history WHERE user_id = ?", [userId]);
}
