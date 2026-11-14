/**
 * 短剧开播日历只读接口：
 *  - GET /api/drama/calendar   快照视图（未来 14 天按日 + 月份待定 + 过期未兑现）
 *
 * 口径：
 *  - 前端只读缓存：抓取由 drama_calendar_refresh 任务每日完成，源站挂了
 *    不拖垮页面——失败时继续下发上一日快照并标 stale，时间如实透传；
 *  - 从未抓到过时返回 status "empty"、各区为空，不编日期、不拿旧数据冒充；
 *  - 全部日期都是平台方“预计”，以官方为准——前端顶部必须写明。
 */
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import {
  buildDramaCalendarView,
  DRAMA_CALENDAR_SNAPSHOT_KEY,
  type DramaCalendarSnapshot,
} from "../drama/calendar.ts";

export const dramaCalendarRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get(
    "/api/drama/calendar",
    { config: { scope: "public", cache: { maxAge: 300, etag: true } } },
    async () => {
      const snapshot = await ctx.repo
        .getSystemState<DramaCalendarSnapshot>(DRAMA_CALENDAR_SNAPSHOT_KEY)
        .catch(() => null);
      const view = buildDramaCalendarView(snapshot, Date.now());
      return { ok: true as const, ...view };
    },
  );
};
