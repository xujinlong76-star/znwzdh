/**
 * 检索（关键词/拼音/全文/语义多通道融合）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { recordSearchChannels } from "../metrics.ts";

import { badRequest, clampFacets } from "./shared.ts";
import { refreshUserProfile } from "../profile-service.ts";
import type { AppContext } from "../context.ts";

export const searchRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------ 检索 ------------------------------ */

  /**
   * 注意：同一个 schema 要同时服务于 GET（query string，值全是字符串）
   * 和 POST（JSON，值有原生类型）。
   * 因此数字与布尔必须用 coerce 解析，否则 GET /api/search?limit=3 会因为
   * "expected number, received string" 被直接拒绝 —— 这是最容易漏掉的坑。
   */
  const queryBool = z.union([z.boolean(), z.enum(["true", "false", "1", "0"])]).transform((v) => v === true || v === "true" || v === "1");

  const searchBody = z.object({
    q: z.string().default(""),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    /** 分页偏移（0 = 第一页）。翻页时必须带上原查询，保证 RRF 输入一致。 */
    offset: z.coerce.number().int().min(0).max(1000).optional(),
    categoryId: z.string().optional(),
    tag: z.string().optional(),
    /**
     * 站点状态过滤（可选）。分类 hub 只需要 active 站点；不传时保持原行为
     * （排除 archived，包含 broken/pending）。既往调用方不受影响。
     */
    status: z.enum(["active", "pending", "broken", "archived"]).optional(),
    /**
     * facets 的校验交给 clampFacets（结构 + 预算：键数、每键值数、值类型）。
     * 这里只留 unknown：以前是 union + 静默 transform，「非法 JSON」会退化成
     * undefined → 客户端以为在按分面筛选，实际拿到的是未过滤的全量结果；
     * 而且 GET 的 JSON 字符串分支绕过 `.max(200)`，值个数完全由客户端决定
     * （一次 IN 查询的绑定参数数量 = 客户端给的个数）。
     */
    facets: z.unknown().optional(),
    excludedTerms: z.union([
      z.array(z.string()),
      z.string().transform((str) => str.split(",").map((s) => s.trim()).filter(Boolean)),
    ]).optional(),
    disableSemantic: queryBool.optional(),
    disablePersonal: queryBool.optional(),
    /** 身份标识：登录用户传 canonical userId，匿名传 anonId（前端 localStorage 生成）。
     *  服务端据此解析个性化信号——调用方不传 signals，避免伪造与多端不一致。 */
    userId: z.string().max(64).optional(),
    anonId: z.string().max(64).optional(),
    personalize: z.object({
      topCategories: z.array(z.string()).max(200).optional(),
      topTags: z.array(z.string()).max(200).optional(),
      visitedSiteIds: z.array(z.string()).max(200).optional(),
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
    // 个性化信号服务端解析：身份 -> user_profiles -> personalize。
    // 显式传 personalize 的调用方（测试 / MCP）优先，保持向后兼容。
    // 检索前顺手刷新画像（节流 60s）：第一次搜索没有画像就没有个性化，符合预期。
    const identity = input.userId ?? input.anonId ?? null;
    let personalizationEnabled = true;
    if (identity) {
      // 用户关闭个性化后既不再更新画像，也不再注入 personal 通道。
      // 显式传 personalize 的调用方（测试 / MCP）不受开关影响。
      personalizationEnabled = (await ctx.repo.getUserSettings(identity)).personalizationEnabled;
      if (personalizationEnabled) void refreshUserProfile(ctx, identity);
    }

    let personalize = input.personalize;
    if (!personalize && identity && personalizationEnabled) {
      const profile = await ctx.repo.getUserProfile(identity);
      if (profile && (profile.topCategories.length > 0 || profile.topTags.length > 0 || profile.visitedSiteIds.length > 0)) {
        personalize = {
          topCategories: profile.topCategories,
          topTags: profile.topTags,
          visitedSiteIds: profile.visitedSiteIds,
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
    // Query Planner 观测：每次检索后记一次决策与通道耗时（/metrics 透出）。
    // 必须读本次 result 上的 channelTimings —— ctx.search 是单例，
    // getLastTimings() 在并发请求下会把别的请求的耗时记到这一次头上。
    const timings = result.channelTimings;
    if (timings) {
      try { recordSearchChannels(timings, result.planner === "early-exit" ? "early-exit" : "full"); } catch { /* 观测不影响主链路 */ }
    }
    // 批量取站点：旧实现 Promise.all(hits.map(getSite)) 是 N+1 查询，hits=100 时打 100 次 DB。
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
      // 事件只记第一页：翻页（offset>0）是同一次查询的延续，
      // 若不区分，加载更多 3 次就把 search/topQueries 计数灌水 3 倍。
      if (isFirstPage) {
        await ctx.repo.recordEvent("search", { query: q }).catch(() => undefined);
      }
      // 知识图谱对标与实体方案召回（如搜 "figma" 召回其开源平替 "Penpot"）
      if (q.length >= 2) {
        relationHits = await ctx.repo.findRelationsByQuery(q, 3).catch(() => []);
      }
      // 零结果建议只对第一页有意义（翻到头的空页不是「没搜到」）
      if (result.hits.length === 0 && isFirstPage) {
        await ctx.repo.recordEvent("zero_result", { query: q }).catch(() => undefined);
        // 零结果兜底：给「别人搜什么能搜到」而不是空白。
        // topQueries 是所有搜索词，用 zeroResultQueries 差集剔除「同样搜不到的词」——
        // 否则会把用户带进另一个死胡同。
        const [top, zero] = await Promise.all([
          ctx.repo.topQueries(180, 30),
          ctx.repo.zeroResultQueries(180, 30),
        ]);
        const zeroSet = new Set(zero.map((z) => z.query));
        suggestions = top.filter((t) => !zeroSet.has(t.query) && t.query !== q).slice(0, 5).map((t) => t.query);
        popular = top.filter((t) => !zeroSet.has(t.query)).slice(0, 8).map((t) => t.query);
      }
      if (identity && isFirstPage) {
        await ctx.repo.recordSearch(identity, q, result.hits.length).catch(() => undefined);
      }
    }
    return {
      ...result,
      hits,
      items: hits,
      // 仅零结果时携带（字段缺席 = 正常结果，前端无需判断）
      ...(result.hits.length === 0 && q && isFirstPage ? { suggestions, popular } : {}),
      ...(relationHits.length > 0 ? { relationHits } : {}),
    };
  }

};
