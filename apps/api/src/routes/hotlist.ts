/**
 * 全网热榜 + 每日简报只读接口：
 *  - GET /api/hotlist        全源热榜缓存（标题+链接+热度+来源+时间）
 *  - GET /api/brief/today    今日简报（公共版落库缓存；在追提醒按身份现算）
 *
 * 口径：
 *  - 前端只读缓存：抓取由 hotlist_refresh 任务低频完成，源站挂了不拖垮
 *    页面——失败源继续下发上次成功条目并标 stale，时间如实透传；
 *  - 未覆盖的源（知乎/快手）也下发（带原因），让「为什么没有知乎」在
 *    页面上有据可查，而不是悄悄缺席；
 *  - 简报按天生成一次并落库，不是每次访问现算；?date= 可回看往期，
 *    往期不存在就如实 404，不拿今天的冒充。
 */
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { HOTLIST_SOURCES } from "../hotlist/sources.ts";
import {
  briefDateKey,
  getOrGenerateTodayBrief,
  watchSectionForUser,
  type BriefPayload,
} from "../brief/brief.ts";
import { identityTrusted, notFound, requestIdentityOf, resolveCanonicalIdentity } from "./shared.ts";

/** 同一天的并发首访只生成一次（落库后都走缓存） */
const inflight = new Map<string, Promise<unknown>>();

export const hotlistRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get(
    "/api/hotlist",
    { config: { scope: "public", cache: { maxAge: 300, etag: true } } },
    async () => {
      const [states, entries] = await Promise.all([
        ctx.repo.listHotlistSources(),
        ctx.repo.listAllHotlistEntries(),
      ]);
      const stateById = new Map(states.map((s) => [s.source, s]));
      const itemsBySource = new Map<string, typeof entries>();
      for (const entry of entries) {
        const list = itemsBySource.get(entry.source) ?? [];
        list.push(entry);
        itemsBySource.set(entry.source, list);
      }
      const sources = HOTLIST_SOURCES.filter((def) => def.covered).map((def) => {
        const state = stateById.get(def.id);
        const items = itemsBySource.get(def.id) ?? [];
        const fetchedAt = items[0]?.fetchedAt ?? state?.lastOkAt ?? null;
        return {
          id: def.id,
          name: def.name,
          homeUrl: def.homeUrl,
          // ok = 最近一次抓取成功；stale = 最近一次失败、下发的是上次缓存；empty = 还没抓到过
          status: items.length === 0 ? ("empty" as const) : state?.status === "failed" ? ("stale" as const) : ("ok" as const),
          fetchedAt,
          items: items.map((item) => ({
            rank: item.rank,
            title: item.title,
            url: item.url,
            hotValue: item.hotValue,
            hotLabel: item.hotLabel,
          })),
        };
      });
      const lastOkAts = states.map((s) => s.lastOkAt ?? 0).filter((n) => n > 0);
      return {
        ok: true,
        generatedAt: lastOkAts.length > 0 ? Math.max(...lastOkAts) : null,
        sources,
        uncovered: HOTLIST_SOURCES.filter((def) => !def.covered).map((def) => ({
          id: def.id,
          name: def.name,
          homeUrl: def.homeUrl,
          reason: def.uncoveredReason ?? "",
        })),
      };
    },
  );

  app.get(
    "/api/brief/today",
    { config: { scope: "public" } },
    async (req, reply) => {
      const now = new Date();
      const query = (req.query ?? {}) as Record<string, string>;
      const requestedDate = typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
        ? query.date
        : null;
      const today = briefDateKey(now.getTime());

      let brief: { date: string; generatedAt: number; opening: string; openingMode: "ai" | "template"; payload: BriefPayload };
      if (requestedDate && requestedDate !== today) {
        const stored = await ctx.repo.getDailyBrief(requestedDate);
        if (!stored) return notFound(reply, `这一天还没有简报：${requestedDate}`);
        brief = {
          date: stored.date,
          generatedAt: stored.generatedAt,
          opening: stored.opening,
          openingMode: stored.openingMode,
          payload: JSON.parse(stored.payload) as BriefPayload,
        };
      } else {
        const key = `brief:${today}`;
        let pending = inflight.get(key) as Promise<typeof brief> | undefined;
        if (!pending) {
          pending = getOrGenerateTodayBrief(ctx, { now });
          inflight.set(key, pending);
          void pending.finally(() => inflight.delete(key)).catch(() => undefined);
        }
        brief = await pending;
      }

      // 在追提醒是唯一的用户维度内容：有可信身份才现算，无身份给通用版（watch=null）
      let watch = null;
      if (identityTrusted(ctx, req as never)) {
        const rawIdentity = requestIdentityOf(req as never);
        if (rawIdentity) {
          const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
          watch = await watchSectionForUser(ctx, identity, now).catch(() => null);
        }
      }

      return {
        ok: true,
        date: brief.date,
        isToday: brief.date === today,
        generatedAt: brief.generatedAt,
        opening: brief.opening,
        openingMode: brief.openingMode,
        hotPicks: brief.payload.hotPicks,
        newSitesScope: brief.payload.newSitesScope,
        newSites: brief.payload.newSites,
        watch,
      };
    },
  );
};
