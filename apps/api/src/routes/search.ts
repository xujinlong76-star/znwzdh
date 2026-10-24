/**
 * 搜索（全站核心高频路径）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { recordSearchChannels } from "../metrics.ts";
import { refreshUserProfile } from "../profile-service.ts";
import { badRequest } from "./shared.ts";

import { z } from "zod";
import type { AppContext } from "../context.ts";

export const searchRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* -------------------------------- 搜索 -------------------------------- */

  /** 分面输入预算：最多 16 个分面键、每键最多 16 个值、键值 ≤64 字符，防止超大分面条件把 SQL IN 撑爆 */
  function clampFacets(raw: unknown): { facets?: Record<string, string[]>; error?: string } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > 16) return { error: "facets 键数量超过上限 (16)" };
    const out: Record<string, string[]> = {};
    for (const [key, val] of entries) {
      if (!key || key.length > 64) return { error: "facet 键名过长" };
      const list = Array.isArray(val) ? val : typeof val === "string" ? val.split(",") : [];
      if (list.length > 16) return { error: `facet "${key}" 取值数量超过上限 (16)` };
      const cleaned: string[] = [];
      for (const item of list) {
        const s = String(item ?? "").trim();
        if (!s) continue;
        if (s.length > 64) return { error: `facet "${key}" 取值过长` };
        cleaned.push(s);
      }
      if (cleaned.length > 0) out[key] = cleaned;
    }
    return { facets: Object.keys(out).length > 0 ? out : undefined };
  }

  const searchBody = z.object({
    q: z.string().max(256).default(""),
    categoryId: z.string().max(64).optional(),
    tags: z
      .union([z.array(z.string().max(40)).max(20), z.string().max(400)])
      .optional()
      .transform((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20) : v)),
    status: z.enum(["active", "pending", "broken", "archived"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(1000).optional(),
    mode: z.enum(["hybrid", "keyword", "semantic"]).optional(),
    facets: z.record(z.string(), z.union([z.array(z.string()), z.string()])).optional(),
    userId: z.string().max(64).optional(),
    anonId: z.string().max(64).optional(),
    personalize: z.object({
      topCategories: z.array(z.string()).max(50).optional(),
      topTags: z.array(z.string()).max(100).optional(),
      visitedSiteIds: z.array(z.string()).max(200).optional(),
      // 与 core 的 PersonalizationSignals 同形：schema 少一个字段，zod 会把它静默剥掉，
      // 画像侧「收藏站点参与重排」（T17）就永远进不了排序器。
      favoriteSiteIds: z.array(z.string()).max(200).optional(),
    }).optional(),
  });

  app.get("/api/search", { config: { rateLimit: { max: 120, timeWindow: "1 minute" }, cache: { maxAge: 20, etag: true } } }, async (req, reply) => {
    const parsed = searchBody.safeParse(req.query ?? {});
    if (!parsed.success) return badRequest(reply, "参数无效", parsed.error.issues);
    const facetFilter = clampFacets(parsed.data.facets);
    if (facetFilter.error) return badRequest(reply, "参数无效", facetFilter.error);
    return runSearch(parsed.data, facetFilter.facets);
  });

  app.post("/api/search", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = searchBody.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(reply, "参数无效", parsed.error.issues);
    const facetFilter = clampFacets(parsed.data.facets);
    if (facetFilter.error) return badRequest(reply, "参数无效", facetFilter.error);
    return runSearch(parsed.data, facetFilter.facets);
  });

  async function runSearch(input: z.infer<typeof searchBody>, facets?: Record<string, string[]>) {
    // 个性化信号服务端解析：身份 -> resolveIdentity -> user_profiles -> personalize。
    const rawIdentity = input.userId ?? input.anonId ?? null;
    const identity = rawIdentity ? await ctx.repo.resolveIdentity(rawIdentity) : null;
    let personalizationEnabled = true;
    let searchHistoryEnabled = true;
    if (identity) {
      const userSettings = await ctx.repo.getUserSettings(identity);
      personalizationEnabled = userSettings.personalizationEnabled;
      searchHistoryEnabled = userSettings.searchHistoryEnabled !== false;
      if (personalizationEnabled) void refreshUserProfile(ctx, identity);
    }

    let personalize = input.personalize;
    if (!personalize && identity && personalizationEnabled) {
      const profile = await ctx.repo.getUserProfile(identity);
      if (profile && (profile.topCategories.length > 0 || profile.topTags.length > 0 || profile.visitedSiteIds.length > 0 || profile.favoriteSiteIds.length > 0)) {
        // favoriteSiteIds 此前只采集不消费——preferences 页「收藏站点参与重排」
        // 的承诺由此兑现（T17），打分档位见 fusion.personalCandidates。
        personalize = {
          topCategories: profile.topCategories,
          topTags: profile.topTags,
          visitedSiteIds: profile.visitedSiteIds,
          favoriteSiteIds: profile.favoriteSiteIds,
        };
      }
    }

    const { status, ...searchInput } = input;
    const result = await ctx.search.search({
      ...searchInput,
      statuses: status ? [status] : undefined,
      facets,
      personalize,
    });
    const timings = result.channelTimings;
    if (timings) {
      try { recordSearchChannels(timings, result.planner === "early-exit" ? "early-exit" : "full"); } catch { /* 观测不影响主链路 */ }
    }
    const siteIds = [...new Set(result.hits.map((h) => h.siteId))];
    const siteMap = await ctx.repo.getSitesByIds(siteIds);
    const hits = result.hits.map((h) => ({
      ...h,
      site: siteMap.get(h.siteId) ?? null,
    }));

    const q = input.q.trim();
    const isFirstPage = (input.offset ?? 0) === 0;
    let suggestions: string[] = [];
    let popular: string[] = [];
    let relationHits: unknown[] = [];
    if (q) {
      if (isFirstPage) {
        await ctx.repo.recordEvent("search", { query: q }).catch(() => undefined);
      }
      if (q.length >= 2) {
        relationHits = await ctx.repo.findRelationsByQuery(q, 3).catch(() => []);
      }
      if (result.hits.length === 0 && isFirstPage) {
        await ctx.repo.recordEvent("zero_result", { query: q }).catch(() => undefined);
        const [top, zero] = await Promise.all([
          ctx.repo.topQueries(180, 30),
          ctx.repo.zeroResultQueries(180, 30),
        ]);
        const zeroSet = new Set(zero.map((z) => z.query));
        suggestions = top.filter((t) => !zeroSet.has(t.query) && t.query !== q).slice(0, 5).map((t) => t.query);
        popular = top.filter((t) => !zeroSet.has(t.query)).slice(0, 8).map((t) => t.query);
      }
      if (identity && isFirstPage && searchHistoryEnabled) {
        await ctx.repo.recordSearch(identity, q, result.hits.length).catch(() => undefined);
      }
    }
    return {
      ...result,
      hits,
      items: hits,
      ...(result.hits.length === 0 && q && isFirstPage ? { suggestions, popular } : {}),
      ...(relationHits.length > 0 ? { relationHits } : {}),
    };
  }

};
