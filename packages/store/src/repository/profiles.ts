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

export async function getUserProfile(repo: Repository, userId: string): Promise<UserProfileRecord | null> {
  const row = (await repo.raw("SELECT * FROM user_profiles WHERE user_id = ?", [userId]))[0];
  return row ? rowToProfile(row) : null;
}

export async function deleteUserProfile(repo: Repository, userId: string): Promise<void> {
  await repo.run("DELETE FROM user_profiles WHERE user_id = ?", [userId]);
}

export async function deleteBehaviorEvents(repo: Repository, identity: string): Promise<number> {
  const rows = await repo.raw(
    "SELECT COUNT(*) AS c FROM events WHERE kind IN ('click','favorite') AND identity = ?",
    [identity],
  );
  const removed = Number(rows[0]?.c ?? 0);
  await repo.run("DELETE FROM events WHERE kind IN ('click','favorite') AND identity = ?", [identity]);
  return removed;
}

export async function saveUserProfile(repo: Repository, userId: string, profile: Omit<UserProfileRecord, "userId" | "updatedAt">): Promise<void> {
  const now = Date.now();
  await repo.run(
    `INSERT INTO user_profiles (user_id, top_categories, top_tags, visited_site_ids, favorite_site_ids, search_count, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (user_id) DO UPDATE SET
       top_categories = excluded.top_categories,
       top_tags = excluded.top_tags,
       visited_site_ids = excluded.visited_site_ids,
       favorite_site_ids = excluded.favorite_site_ids,
       search_count = excluded.search_count,
       updated_at = excluded.updated_at`,
    [
      userId,
      JSON.stringify(profile.topCategories),
      JSON.stringify(profile.topTags),
      JSON.stringify(profile.visitedSiteIds),
      JSON.stringify(profile.favoriteSiteIds),
      profile.searchCount,
      now,
    ],
  );
}
