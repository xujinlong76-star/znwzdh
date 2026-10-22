import type { Repository } from "../repository.ts";
import type {
  UserProfileRecord,
} from "./records.ts";
import {
  rowToProfile,
} from "./dialect.ts";

export async function getUserProfile(repo: Repository, userId: string): Promise<UserProfileRecord | null> {
  const row = (await repo.raw("SELECT * FROM user_profiles WHERE user_id = ?", [userId]))[0];
  return row ? rowToProfile(row) : null;
}

export async function deleteUserProfile(repo: Repository, userId: string): Promise<void> {
  await repo.run("DELETE FROM user_profiles WHERE user_id = ?", [userId]);
}

/**
 * 删除行为事件。传 kind 时只删该类（画像信号清理），不传则清 click+favorite 两类。
 * 收藏本身（favorites 表）不在这里删——那是用户数据，不是被推断的偏好。
 */
export async function deleteBehaviorEvents(
  repo: Repository,
  identity: string,
  kind?: "click" | "favorite",
): Promise<number> {
  const where = kind
    ? "kind = ? AND identity = ?"
    : "kind IN ('click','favorite') AND identity = ?";
  const params = kind ? [kind, identity] : [identity];
  const rows = await repo.raw(`SELECT COUNT(*) AS c FROM events WHERE ${where}`, params);
  const removed = Number(rows[0]?.c ?? 0);
  await repo.run(`DELETE FROM events WHERE ${where}`, params);
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
