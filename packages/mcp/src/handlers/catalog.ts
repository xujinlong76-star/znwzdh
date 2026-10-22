/**
 * 目录域工具：类目 / 标签 / 统计 / 热度榜。均为只读。
 */
import {
  GetTrendingInput,
  ListCategoriesInput,
  ListCollectionsInput,
  ListTagsInput,
  requireScope,
  type ToolContext,
} from "../tools.ts";
import { ok, type Handler, type HandlerDeps } from "./shared.ts";

export const catalogHandlers = {
  async list_categories(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = ListCategoriesInput.parse(args ?? {});
    const cats = await ctx.repo.listCategories();
    if (!input.includeCounts) return ok(cats);
    // 一条 GROUP BY 出计数。原先是 listSites()（默认 limit=100）再在 JS 里数：
    // 库超过 100 条时每个类目的 siteCount 都被截断（报告出来的数是假的），
    // 而且为"数个数"把整行连标签/分面关联子查询一起拉回来。口径与 listSites
    // 保持一致：软删站点不计。
    const countRows = await ctx.repo.raw(
      "SELECT category_id AS cid, COUNT(*) AS n FROM sites WHERE deleted_at IS NULL GROUP BY category_id",
    );
    const counts = new Map<string, number>();
    for (const r of countRows) counts.set(String(r.cid), Number(r.n));
    return ok(cats.map((c) => ({ ...c, siteCount: counts.get(c.id) ?? 0 })));
  },

  async get_stats(deps: HandlerDeps, _args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    return ok({ ...(await ctx.repo.stats()), capabilities: ctx.capabilities });
  },

  async get_trending(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = GetTrendingInput.parse(args ?? {});
    const sites = await ctx.repo.hotSites(input.limit);
    return ok({
      count: sites.length,
      // 带热度分量，Agent 可以解释「为什么排这儿」
      results: sites.map((s, i) => ({
        rank: i + 1,
        title: s.title,
        url: s.url,
        description: s.description,
        tags: s.tags,
        visits7d: s.visitCount ?? 0,
        trendScore: s.trendScore ?? 0,
      })),
    });
  },

  async list_tags(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = ListTagsInput.parse(args ?? {});
    const all = await ctx.repo.listTagsWithCounts(input.minCount);
    return ok({ count: Math.min(all.length, input.limit), tags: all.slice(0, input.limit) });
  },

  /**
   * 精选专题（合集）。管理端能 CRUD，但此前没有任何 Agent 侧的读入口 ——
   * 「有哪些专题推荐」只能靠人去看网页。默认只返回启用中的专题。
   */
  async list_collections(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = ListCollectionsInput.parse(args ?? {});
    const collections = await ctx.repo.listCollections(!input.all);
    return ok({ count: collections.length, collections });
  },
} satisfies Record<string, Handler>;
