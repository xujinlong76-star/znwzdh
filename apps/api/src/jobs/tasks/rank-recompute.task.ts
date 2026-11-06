/**
 * 热度重算任务（recompute_rank）。
 *
 * 职责：
 * 聚合近 7 天点击量与收藏量，结合收录时长进行衰减评分，更新全站 sites.trend_score。
 */

import { ageInDays, trendScore } from "@navhub/core";
import type { AppContext } from "../../context.ts";

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
          ageDays: ageInDays(Number(r.created_at), now),
        },
        now
      ),
    };
  });
  await ctx.repo.setTrendScores(scores);
  await ctx.repo.recordEvent("recompute_rank", { meta: { sites: scores.length } }).catch(() => undefined);
}
