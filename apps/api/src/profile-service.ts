/**
 * 个性化画像刷新服务。
 *
 * 职责：把用户的近期行为（click/favorite）聚合成 user_profiles，
 * 供 /api/search 注入 personal 通道信号。这是「越用越懂你」的唯一生产方；
 * 消费方（SearchEngine 的 personalCandidates）零改动。
 *
 * 节流：同一身份 60 秒内不重复聚合——点击是高频事件，
 * 而画像只需要「足够新」，不需要「精确到每一次」。
 */

import { buildProfile } from "@navhub/core";
import type { AppContext } from "./context.ts";

/** 聚合窗口：近 30 天的行为（更早的被半衰期衰减掉，没有统计意义） */
const WINDOW_MS = 30 * 86_400_000;
/** 同一身份的最小刷新间隔 */
const THROTTLE_MS = 60_000;

const lastRefresh = new Map<string, number>();

/**
 * 节流表容量上限。
 *
 * 身份多为匿名 id（每次清空 localStorage 就是新身份），逐条 reset 不现实，
 * 所以只能在写入路径上惰性淘汰：满了先清过期的，仍满再按插入顺序丢最旧的一批
 * （Map 保持插入顺序 ≈ 最久未被刷新的身份）。没有这一步，长期运行的表会一直涨。
 */
export const THROTTLE_MAX_ENTRIES = 10_000;

/** 测试用：当前节流表条目数 */
export function profileThrottleSize(): number {
  return lastRefresh.size;
}

function evictThrottle(now: number): void {
  if (lastRefresh.size < THROTTLE_MAX_ENTRIES) return;
  for (const [key, at] of lastRefresh) {
    if (now - at >= THROTTLE_MS) lastRefresh.delete(key);
  }
  let overflow = lastRefresh.size - THROTTLE_MAX_ENTRIES + 1;
  for (const key of lastRefresh.keys()) {
    if (overflow-- <= 0) break;
    lastRefresh.delete(key);
  }
}

export function isProfileStale(identity: string, now: number = Date.now()): boolean {
  const last = lastRefresh.get(identity) ?? 0;
  return now - last >= THROTTLE_MS;
}

/**
 * 刷新画像。失败静默（画像缺失只意味着没有个性化，不影响搜索）。
 * 返回是否真正执行了聚合（节流命中时 false）。
 */
export async function refreshUserProfile(ctx: AppContext, identity: string): Promise<boolean> {
  if (!identity) return false;
  const now = Date.now();
  if (!isProfileStale(identity, now)) return false;
  evictThrottle(now);
  lastRefresh.set(identity, now);

  try {
    const since = now - WINDOW_MS;
    const [events, favorites, searchCount] = await Promise.all([
      ctx.repo.behaviorEvents(identity, since),
      ctx.repo.listFavorites(identity),
      ctx.repo.countSearches(identity),
    ]);
    const built = buildProfile(events, { now });
    await ctx.repo.saveUserProfile(identity, {
      topCategories: built.topCategories ?? [],
      topTags: built.topTags ?? [],
      visitedSiteIds: built.visitedSiteIds ?? [],
      favoriteSiteIds: favorites.map((f) => f.siteId),
      searchCount,
    });
    return true;
  } catch {
    // 画像聚合失败不该影响主流程
    return false;
  }
}

/** 测试用：清空节流表 */
export function resetProfileThrottle(): void {
  lastRefresh.clear();
}

/**
 * 重置某身份的个性化画像（「我的偏好」页面的重置按钮）。
 *
 * 两件都清，缺一不可——只删 user_profiles 行没用：
 * 下一次搜索触发 refreshUserProfile 就会从残留行为事件把画像重建出来。
 *  - user_profiles                  画像本身
 *  - events(click/favorite 带 identity)  聚合素材
 *
 * 不动的两类数据：
 *  - **收藏夹**：用户主动保存的书签，不是「被推断的偏好」（删了就没法恢复）
 *  - **搜索历史**：界面上有自己的清空入口（DELETE /api/search-history），不混进来
 *
 * 重置后画像会随新行为重新积累（favorites 参与的部分会立刻由 rebuild 恢复，符合预期）。
 */
export async function resetUserProfile(ctx: AppContext, identity: string): Promise<{ profileCleared: boolean; eventsRemoved: number }> {
  if (!identity) return { profileCleared: false, eventsRemoved: 0 };
  const profileCleared = (await ctx.repo.getUserProfile(identity)) !== null;
  const eventsRemoved = await ctx.repo.deleteBehaviorEvents(identity);
  await ctx.repo.deleteUserProfile(identity);
  lastRefresh.delete(identity); // 节流表同步清掉，避免残留节流让新行为延迟生效
  return { profileCleared, eventsRemoved };
}
