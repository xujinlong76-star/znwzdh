/**
 * 目录域工具：类目 / 标签 / 统计 / 热度榜。均为只读。
 */
import {
  GetTrendingInput,
  ListCategoriesInput,
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
    const all = await ctx.repo.listSites();
    const counts = new Map<string, number>();
    for (const s of all) counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1);
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
} satisfies Record<string, Handler>;
