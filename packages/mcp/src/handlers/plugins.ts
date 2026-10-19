/**
 * 插件市场域工具：list_plugins / search_plugins（读）/ install_plugin（写）。
 *
 * 与 REST 路由（apps/api/src/routes/plugins.ts）共用同一仓储（ctx.repo），
 * 保证 Agent 与网页端看到的清单、安装结果完全一致：网址包安装后同样
 * 以增量去重方式写库，并补建检索向量索引（模型不可用时静默跳过，
 * 只影响语义检索，不影响安装结果）。
 */
import { summarizePluginManifest } from "@navhub/core";
import { indexSitesBatch, searchPluginsSemantic } from "@navhub/api";
import {
  InstallPluginInput,
  ListPluginsInput,
  SearchPluginsInput,
  requireScope,
  type ToolContext,
} from "../tools.ts";
import { fail, ok, type Handler, type HandlerDeps } from "./shared.ts";

export const pluginHandlers = {
  async list_plugins(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = ListPluginsInput.parse(args ?? {});

    const res = await ctx.repo.listPlugins({
      status: "published",
      kind: input.kind,
      q: input.query,
      sort: input.sort,
      limit: input.limit,
      offset: input.offset,
    });

    return ok({
      count: res.items.length,
      total: res.total,
      plugins: res.items.map((p) => ({
        slug: p.slug,
        kind: p.kind,
        name: p.name,
        description: p.description,
        version: p.version,
        author: p.author,
        tags: p.tags,
        installCount: p.installCount,
        starCount: p.starCount,
        publishedAt: p.publishedAt,
        summary: summarizePluginManifest(p.manifest),
        installHint: '安装：install_plugin { "slug": "' + p.slug + '" }',
      })),
    });
  },

  async search_plugins(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "read");
    const input = SearchPluginsInput.parse(args ?? {});

    const res = await searchPluginsSemantic(ctx, {
      q: input.query,
      kind: input.kind,
      limit: input.limit,
    });

    return ok({
      count: res.items.length,
      total: res.total,
      mode: res.mode,
      degraded: res.degraded,
      plugins: res.items.map((p) => ({
        slug: p.slug,
        kind: p.kind,
        name: p.name,
        description: p.description,
        version: p.version,
        author: p.author,
        tags: p.tags,
        installCount: p.installCount,
        starCount: p.starCount,
        publishedAt: p.publishedAt,
        score: p.score ?? null,
        summary: p.summary,
        installHint: '安装：install_plugin { "slug": "' + p.slug + '" }',
      })),
    });
  },

  async install_plugin(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "write");
    const input = InstallPluginInput.parse(args ?? {});
    const identity = input.identity ?? "mcp:" + tc.actor;

    try {
      return await deps.withIdempotency(input.idempotencyKey, async () => {
        const plugin = await ctx.repo.getPluginBySlug(input.slug);
        if (!plugin) throw new Error("插件不存在: " + input.slug);
        if (plugin.status !== "published") {
          throw new Error("插件当前处于 " + plugin.status + " 状态，未上架插件不可安装");
        }

        const result = await ctx.repo.installPlugin(input.slug, identity, {
          actor: tc.actor,
          actorKind: "token",
        });

        // 与 REST 路由同口径：新建站点补向量索引（失败不影响安装结果）
        if (result.applied.createdSiteIds.length > 0) {
          const sites = (
            await Promise.all(result.applied.createdSiteIds.map((id) => ctx.repo.getSite(id)))
          )
            .filter((s): s is NonNullable<typeof s> => !!s)
            .map((s) => ({ id: s.id, title: s.title, description: s.description ?? null, url: s.url }));
          await indexSitesBatch(ctx, sites);
        }

        return {
          slug: plugin.slug,
          name: plugin.name,
          kind: plugin.kind,
          version: plugin.version,
          identity,
          ...result,
        };
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
} satisfies Record<string, Handler>;
