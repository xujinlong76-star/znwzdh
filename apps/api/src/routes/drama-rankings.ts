/**
 * 短剧真榜单只读接口：
 *  - GET /api/drama/rankings   三榜快照视图（热播 / 热搜 / 收藏，各前 30 部）
 *
 * 口径（与 /api/drama/calendar 一致）：
 *  - 前端只读缓存：抓取由 drama_rankings_refresh 任务每日完成，源站挂了
 *    不拖垮页面——失败时继续下发上次成功快照并标 stale；
 *  - 从未抓到过时返回 status "empty"、各榜为空，不编榜单、不拿旧数据冒充；
 *  - 榜单与数字全部来自搜短剧公开榜单页，缺失的数字留空、绝不编热度。
 */
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import {
  buildDramaRankingsView,
  DRAMA_RANKINGS_SNAPSHOT_KEY,
  type DramaRankingsSnapshot,
} from "../drama/ranking-lists.ts";

export const dramaRankingsRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get(
    "/api/drama/rankings",
    { config: { scope: "public", cache: { maxAge: 300, etag: true } } },
    async () => {
      const snapshot = await ctx.repo
        .getSystemState<DramaRankingsSnapshot>(DRAMA_RANKINGS_SNAPSHOT_KEY)
        .catch(() => {
          // 可选读取：读不到按缺省值处理，调用方已处理空值。
          return null;
        });
      const view = buildDramaRankingsView(snapshot);
      return { ok: true as const, ...view };
    },
  );
};
