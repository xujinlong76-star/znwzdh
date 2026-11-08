/**
 * 热度重算任务（recompute_rank）。
 *
 * 职责：
 * 聚合近 7 天点击量与收藏量，结合收录时长进行衰减评分，更新全站 sites.trend_score。
 */

import { ageInDays, trendScore } from "@navhub/core";
import type { AppContext } from "../../context.ts";

/**
 * 把 `sites.created_at` 归一成 epoch 毫秒。
 *
 * 为什么需要：schema 与两个驱动都把该列声明成 `INTEGER/BIGINT NOT NULL`，
 * 但实测库里有 3 行是 **TEXT 日期串**（`"2026-11-07 06:47:11"`，来自早期导入路径），
 * `Number()` 之后是 NaN。旧代码把 NaN 直接喂给 ageInDays → trendScore → SQL 参数，
 * 结果整个任务每小时因 `NOT NULL constraint failed: sites.weight` 失败。
 *
 * 这里做两层兜底：先按数字解析，失败再按日期串解析；都失败则回落到 now（年龄 0 天）。
 * 脏行的**物理修正**由迁移负责，本函数只保证任务不会被它拖垮。
 */
function toEpochMs(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(String(raw ?? "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function handleRecomputeRank(ctx: AppContext): Promise<void> {
  const now = Date.now();
  const since7d = now - 7 * 86_400_000;
  const [clicks, favorites, rankRows] = await Promise.all([
    ctx.repo.clickCountsSince(since7d),
    ctx.repo.favoriteCountsSince(since7d),
    ctx.repo.raw("SELECT id, created_at FROM sites WHERE deleted_at IS NULL"),
  ]);
  const scores = rankRows.map((r) => {
    const id = String(r.id);
    return {
      id,
      trendScore: trendScore(
        {
          visits7d: clicks.get(id) ?? 0,
          favorites7d: favorites.get(id) ?? 0,
          ageDays: ageInDays(toEpochMs(r.created_at, now), now),
        },
        now
      ),
    };
  });
  await ctx.repo.setTrendScores(scores);
  await ctx.repo.recordEvent("recompute_rank", { meta: { sites: scores.length } }).catch(() => undefined);
}
