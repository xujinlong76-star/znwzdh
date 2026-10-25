/**
 * 搜索（全站核心高频路径）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { recordSearchChannels, recordSearchWriteFailure } from "../metrics.ts";
import { refreshUserProfile } from "../profile-service.ts";
import { badRequest, clampFacets, FACET_MAX_JSON_LENGTH, identityTrusted, requestIdentityOf } from "./shared.ts";

import { z } from "zod";
import type { AppContext } from "../context.ts";

/**
 * 搜索响应的缓存键必须包含的字段（写进 `Vary`，见 server.ts 的 CachePolicy.vary）。
 *
 * 为什么搜索特别需要：`/api/search` 是全站唯一「响应内容按身份变化、却允许被缓存 20 秒」的
 * 公开 GET —— 命中个性化时（`personalize` 来自 user_profiles 的类目/标签/收藏/访问）
 * 甲与乙的排序不同。身份可以只走 Header（web 端经 hub 代理就是 `X-Navhub-Anon-Id` + 签名头，
 * 扩展与脚本可带 `Authorization`），Header 不改变 URL ⇒ 不声明 Vary 时，同一浏览器上
 * 「登录前 / 登录后」或「甲 / 乙」搜同一个词会直接复用彼此的个性化结果，服务端毫无察觉。
 * query 里的 `userId/anonId` 会改变 URL，天然分键，不必列进来。
 */
const SEARCH_VARY = ["x-navhub-anon-id", "x-navhub-user-id", "authorization", "cookie"];

export const searchRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* -------------------------------- 搜索 -------------------------------- */

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
    // 对象形态（POST body / qs）与整段 JSON 字符串（GET query；Fastify 默认
    // query parser 不解析 facets[pricing] 的方括号嵌套）都收，预算由 clampFacets 统一。
    facets: z
      .union([
        z.record(z.string(), z.union([z.array(z.string()), z.string()])),
        z.string().max(FACET_MAX_JSON_LENGTH),
      ])
      .optional(),
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

  app.get("/api/search", { config: { rateLimit: { max: 120, timeWindow: "1 minute" }, cache: { maxAge: 20, etag: true, vary: SEARCH_VARY } } }, async (req, reply) => {
    const parsed = searchBody.safeParse(req.query ?? {});
    if (!parsed.success) return badRequest(reply, "参数无效", parsed.error.issues);
    const facetFilter = clampFacets(parsed.data.facets);
    if (facetFilter.error) return badRequest(reply, "参数无效", facetFilter.error);
    return runSearch(parsed.data, facetFilter.facets, req);
  });

  app.post("/api/search", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = searchBody.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(reply, "参数无效", parsed.error.issues);
    const facetFilter = clampFacets(parsed.data.facets);
    if (facetFilter.error) return badRequest(reply, "参数无效", facetFilter.error);
    return runSearch(parsed.data, facetFilter.facets, req);
  });

  async function runSearch(
    input: z.infer<typeof searchBody>,
    facets?: Record<string, string[]>,
    req?: FastifyRequest,
  ) {
    /**
     * 请求的有效身份：**一个** identity 同时服务个性化、搜索历史与事件归属。
     *
     * 取法：requestIdentityOf（与 preValidation 验签同一条 identityOf 链路：
     * 用户级令牌 owner 优先，其次 Header→Query→Body）。不能再用
     * `input.userId ?? input.anonId`：那只看 Body/Query，带签名 Header 或持票的
     * 调用方会被 Body 里的自称顶掉——同一次请求「按 A 的画像重排、把行为记进
     * B 的可删除列」，而只带 Header 的调用方则完全拿不到个性化。
     * 没有 req 的内部调用才退回入参。
     *
     * 闸门：与事件归属同一条 identityTrusted。鉴权模式下的匿名自称既不读画像
     * （否则可借排序结果反推他人偏好）、也不写历史；开放模式 / 有效签名 / 持票
     * 调用不受影响。
     */
    const requestRawIdentity = req ? requestIdentityOf(req as never) : null;
    const rawIdentity = requestRawIdentity ?? input.userId ?? input.anonId ?? null;
    const identityUsable = !req || identityTrusted(ctx, req as never);
    const identity = rawIdentity && identityUsable ? await ctx.repo.resolveIdentity(rawIdentity) : null;
    let personalizationEnabled = true;
    let searchHistoryEnabled = true;
    let telemetryEnabled = true;
    if (identity) {
      const userSettings = await ctx.repo.getUserSettings(identity);
      personalizationEnabled = userSettings.personalizationEnabled;
      searchHistoryEnabled = userSettings.searchHistoryEnabled !== false;
      telemetryEnabled = userSettings.telemetryEnabled !== false;
      if (personalizationEnabled) void refreshUserProfile(ctx, identity);
    }

    /**
     * 事件归属身份：search / zero_result 两行要写进 events.identity。
     *
     * 为什么必须写：注销与导出都按这一列圈定范围（user-data.ts:148/248/285）。
     * 此前这两条从不带身份 —— 实测本机库 141 行 search、4 行 zero_result 全部
     * identity=NULL，于是用户「删除全部个人数据」删不掉自己的搜索行为，导出里
     * 也看不见它（承诺比实现大），零结果榜也无法按人排重。
     *
     * 与上面的 identity 同源（取法 + 可信闸门都已合并），这里只多一道遥测闸门：
     * 关掉遥测的用户不留身份 —— 与 /api/events 同一口径（telemetry.ts:78-86）。
     * 没有 req 的内部调用不写归属（没有可归属的 HTTP 请求）。
     */
    const attributedIdentity = req && identity && telemetryEnabled ? identity : null;

    /**
     * HEAD 只探测元信息，不是一次用户搜索。
     *
     * Fastify 的 exposeHeadRoutes 默认开启（server.ts:127），HEAD 因而复用本处理器；
     * 于是「探一下长度/etag」的请求会：写一行 events.search、可能写一行 zero_result，
     * 并往**个人搜索历史**（search_history：可导出、可删除、UI 里也展示）塞一条用户
     * 根本没搜过的词。热榜与零结果榜按行数计次（topQueries / zeroResultQueries），
     * 预取与探活灌进来的行会直接改变用户看到的「大家在搜什么」。
     * 归属、个性化、响应本身照旧算——只关掉「记账」这一段。
     */
    const isProbe = req?.method === "HEAD";

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
      try { recordSearchChannels(timings, result.planner === "early-exit" ? "early-exit" : "full"); } catch { recordSearchWriteFailure("channels"); }
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
      if (isFirstPage && !isProbe) {
        await ctx.repo
          .recordEvent("search", { query: q, identity: attributedIdentity ?? undefined })
          .catch(() => recordSearchWriteFailure("event_search"));
      }
      if (q.length >= 2) {
        relationHits = await ctx.repo.findRelationsByQuery(q, 3).catch(() => []);
      }
      if (result.hits.length === 0 && isFirstPage) {
        // 只关掉「写零结果行」这一段；建议/热门仍照算，
        // 否则 HEAD 与 GET 的 payload 不同 → 同一 URL 的 ETag 会不一致（RFC 9110 §9.3.2 要求 HEAD 的头与 GET 相同）。
        if (!isProbe) {
          await ctx.repo
            .recordEvent("zero_result", { query: q, identity: attributedIdentity ?? undefined })
            .catch(() => recordSearchWriteFailure("event_zero_result"));
        }
        const [top, zero] = await Promise.all([
          ctx.repo.topQueries(180, 30),
          ctx.repo.zeroResultQueries(180, 30),
        ]);
        const zeroSet = new Set(zero.map((z) => z.query));
        suggestions = top.filter((t) => !zeroSet.has(t.query) && t.query !== q).slice(0, 5).map((t) => t.query);
        popular = top.filter((t) => !zeroSet.has(t.query)).slice(0, 8).map((t) => t.query);
      }
      if (identity && isFirstPage && searchHistoryEnabled && !isProbe) {
        await ctx.repo.recordSearch(identity, q, result.hits.length).catch(() => recordSearchWriteFailure("history"));
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
