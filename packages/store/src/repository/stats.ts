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

export async function stats(repo: Repository): Promise<{ sites: number; categories: number; tags: number; broken: number; pending: number; trashed: number }> {
  const one = async (q: string, p: unknown[] = []) => Number((await repo.raw(q, p))[0]?.c ?? 0);
  return {
    sites: await one("SELECT COUNT(*) AS c FROM sites WHERE deleted_at IS NULL"),
    categories: await one("SELECT COUNT(*) AS c FROM categories"),
    tags: await one("SELECT COUNT(*) AS c FROM tags"),
    broken: await one("SELECT COUNT(*) AS c FROM sites WHERE status = ? AND deleted_at IS NULL", ["broken"]),
    pending: await one("SELECT COUNT(*) AS c FROM sites WHERE status = ? AND deleted_at IS NULL", ["pending"]),
    // 回收站里的数量——让运营者知道还有可恢复的数据
    trashed: await one("SELECT COUNT(*) AS c FROM sites WHERE deleted_at IS NOT NULL"),
  };
}
