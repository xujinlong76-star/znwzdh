/**
 * 算法域工具：架构配方 / 技术对比 / 自治修复 / 技术路径 / 栈兼容 / 站点聚类。
 * 这些是 @navhub/core 里预设知识库（配方、技术图）的只读投影，除了 heal 会审计。
 */
import {
  analyzeStackCompatibility,
  autoClusterSites,
  findMatchingArchitectureRecipe,
  findShortestTechPath,
  parseTechComparisonQuery,
  PRESET_RECIPES,
  PRESET_TECH_GRAPH,
  runAutonomousHealing,
} from "@navhub/core";
import {
  AnalyzeStackCompatibilityInput,
  ClusterSitesInput,
  CompareTechnologiesInput,
  FindTechPathInput,
  GetArchitectureRecipeInput,
  HealBrokenSiteInput,
  requireScope,
  type ToolContext,
} from "../tools.ts";
import { fail, ok, type Handler, type HandlerDeps } from "./shared.ts";

export const algorithmHandlers = {
  async get_architecture_recipe(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = GetArchitectureRecipeInput.parse(args ?? {});
    const matched = findMatchingArchitectureRecipe(input.query);
    if (!matched) {
      return ok({ matched: false, query: input.query, availableRecipes: PRESET_RECIPES.map((r) => ({ id: r.id, title: r.title, targetGoal: r.targetGoal })) });
    }
    return ok({ matched: true, recipe: matched });
  },

  async compare_technologies(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = CompareTechnologiesInput.parse(args ?? {});
    const matrix = parseTechComparisonQuery(input.query);
    if (!matrix) {
      return ok({ matched: false, query: input.query, note: "未找到预设对比矩阵，请尝试 'react vs vue', 'cursor vs vscode', 'pnpm vs bun', 'ollama vs vllm'" });
    }
    return ok({ matched: true, matrix });
  },

  async heal_broken_site(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "write");
    const input = HealBrokenSiteInput.parse(args ?? {});
    const site = await ctx.repo.getSite(input.idOrUrl);
    if (!site) return fail("未找到站点：" + input.idOrUrl);

    const peers = await ctx.repo.listSites({ categoryId: site.categoryId, status: "active", limit: 20 });
    const report = runAutonomousHealing({
      siteId: site.id,
      url: site.url,
      title: site.title,
      categoryId: site.categoryId,
      tags: site.tags,
      availablePeers: peers,
    });

    await ctx.repo.audit({
      actor: tc.actor,
      actorKind: "mcp",
      action: "site.heal",
      target: site.id,
      diff: {
        recommendedAction: report.recommendedAction,
        waybackFallbackUrl: report.waybackFallbackUrl,
        suggestedCount: report.suggestedReplacements.length,
      },
    });

    return ok({ healed: true, report });
  },

  async find_tech_path(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = FindTechPathInput.parse(args ?? {});
    const pathResult = findShortestTechPath(input.from, input.to, PRESET_TECH_GRAPH);
    return ok({ success: true, ...pathResult });
  },

  async analyze_stack_compatibility(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = AnalyzeStackCompatibilityInput.parse(args ?? {});
    const report = analyzeStackCompatibility(input.techs, PRESET_TECH_GRAPH);
    return ok({ success: true, ...report });
  },

  async cluster_sites(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = ClusterSitesInput.parse(args ?? {});
    const list = await ctx.repo.listSites({
      categoryId: input.categoryId,
      limit: 100,
      status: "active",
    });
    const items = list.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      tags: s.tags || [],
    }));
    const result = autoClusterSites(items, input.targetK);
    return ok({ success: true, ...result });
  },
} satisfies Record<string, Handler>;
