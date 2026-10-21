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

/**
 * 全站计数。
 *
 * 性能约束：这个函数被 `/api/stats`、管理台总览以及 **3 秒一次的管理台 SSE 心跳**
 * 反复调用（见 routes/stats.ts）。旧实现串行发 6 条 COUNT，一次心跳就是 6 次往返；
 * 页面开一天 = 17 万次查询。这里合并成 1 条语句：sites 的三项共用一次扫描
 * （deleted_at IS NULL 部分索引），categories/tags 走各自的覆盖索引。
 */
export async function stats(repo: Repository): Promise<{ sites: number; categories: number; tags: number; broken: number; pending: number; trashed: number }> {
  const row = (await repo.raw(
    `SELECT
       (SELECT COUNT(*) FROM sites WHERE deleted_at IS NULL) AS sites,
       (SELECT COUNT(*) FROM categories) AS categories,
       (SELECT COUNT(*) FROM tags) AS tags,
       (SELECT COUNT(*) FROM sites WHERE status = ? AND deleted_at IS NULL) AS broken,
       (SELECT COUNT(*) FROM sites WHERE status = ? AND deleted_at IS NULL) AS pending,
       (SELECT COUNT(*) FROM sites WHERE deleted_at IS NOT NULL) AS trashed`,
    ["broken", "pending"],
  ))[0];
  // PG 的 COUNT 是 bigint（驱动返回字符串），SQLite 是 number —— 统一收敛成 number
  const num = (v: unknown): number => Number(v ?? 0);
  return {
    sites: num(row?.sites),
    categories: num(row?.categories),
    tags: num(row?.tags),
    broken: num(row?.broken),
    pending: num(row?.pending),
    trashed: num(row?.trashed),
  };
}
