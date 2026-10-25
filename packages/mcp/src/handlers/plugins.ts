/**
 * 插件市场域工具：list_plugins / search_plugins（读）/ install_plugin（写）。
 *
 * 与 REST 路由（apps/api/src/routes/plugins.ts）共用同一仓储（ctx.repo），
 * 保证 Agent 与网页端看到的清单、安装结果完全一致：网址包安装后同样
 * 以增量去重方式写库，并补建检索向量索引（模型不可用时静默跳过，
 * 只影响语义检索，不影响安装结果）。
 */
import { summarizePluginManifest, validateAndCleanPluginManifest, validatePluginManifestWithCatalog } from "@navhub/core";
import { indexSitesBatch, removePluginIndex, searchPluginsSemantic } from "@navhub/api";
import {
  InstallPluginInput,
  ListPluginsInput,
  SearchPluginsInput,
  StarPluginInput,
  UpdatePluginInput,
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
      featured: input.featured,
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
        ratingAvg: p.ratingAvg,
        reviewCount: p.reviewCount,
        featured: p.featured,
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
        ratingAvg: p.ratingAvg,
        reviewCount: p.reviewCount,
        featured: p.featured,
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

        // 与 REST 路由同口径：新建站点补向量索引（批量查询，消除 N+1）
        if (result.applied.createdSiteIds.length > 0) {
          const siteMap = await ctx.repo.getSitesByIds(result.applied.createdSiteIds);
          const sites = Array.from(siteMap.values())
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

  async star_plugin(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "write");
    const input = StarPluginInput.parse(args ?? {});
    try {
      const result = input.starred
        ? await ctx.repo.starPlugin(input.slug, "mcp:" + tc.actor)
        : await ctx.repo.unstarPlugin(input.slug, "mcp:" + tc.actor);
      return ok({ slug: input.slug, starred: result.starred, starCount: result.starCount });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },

  async update_plugin(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    const { ctx } = deps;
    requireScope(tc, "write");
    const input = UpdatePluginInput.parse(args ?? {});
    const validated = validatePluginManifestWithCatalog(input.manifest);
    if (!validated.ok) {
      return fail("插件清单校验失败: " + validated.errors.join("; "));
    }

    try {
      const plugin = await ctx.repo.getPluginBySlug(input.slug);
      if (!plugin) return fail(`插件不存在: ${input.slug}`);
      const isAdmin = tc.has("admin");
      const actorIdentity = tc.ownerIdentity ?? ("mcp:" + tc.actor);
      const isOwner = Boolean(plugin.ownerIdentity && (plugin.ownerIdentity === actorIdentity || plugin.ownerIdentity === tc.actor));
      if (!isAdmin && !isOwner) {
        return fail("越权拦截：只有插件作者或管理员可以更新插件版本");
      }

      return await deps.withIdempotency(input.idempotencyKey, async () => {
        const actor = { actor: "mcp:" + tc.actor, actorKind: "token" };
        // 规则统一收敛在 store：pending/rejected 允许同版本修正；已上架必须严格递增。
        const updated = await ctx.repo.submitPluginVersion(
          input.slug,
          validated.manifest,
          input.changelog ?? null,
          actor,
        );
        if (updated.status !== "published") {
          await removePluginIndex(ctx, input.slug);
        }
        return {
          success: true,
          slug: updated.slug,
          version: updated.pendingVersion ?? updated.version,
          status: updated.status,
          hasPendingVersion: Boolean(updated.pendingVersion),
          summary: summarizePluginManifest(updated.pendingManifest ?? updated.manifest),
          reviewHint: "已进入待审队列；通过后版本历史会记录本次变更",
        };
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
} satisfies Record<string, Handler>;
