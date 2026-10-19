/**
 * 插件市场 REST 路由 (Plugin Marketplace Routes)
 *
 * 遵循 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md 设计规范与 apps/api/test/plugins-api.test.ts 契约：
 * 1. 声明式优先：全量消费 @navhub/core 的 validateAndCleanPluginManifest 纯函数校验；
 * 2. 状态机闭环：pending -> published / rejected / delisted，更新必须重置为 pending；
 * 3. 审计留痕：publish, import, update, review, install, uninstall, report 均记录审计日志；
 * 4. 幂等与防刷：内置细粒度限流，星标/安装均具备去重与幂等保证。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { indexSitesBatch } from "../index-site.ts";
import { indexPluginsBatch, indexItemFromManifest, removePluginIndex } from "../index-plugin.ts";
import { searchPluginsSemantic, similarPlugins } from "../plugins-search.ts";
import {
  validateAndCleanPluginManifest,
  summarizePluginManifest,
  diffPluginManifests,
  comparePluginVersions,
  type PluginManifest,
  type PluginStatus,
  type PluginKind,
} from "@navhub/core";

import type { AppContext } from "../context.ts";
import {
  badRequest,
  conflict,
  created,
  forbidden,
  identityOf,
  notFound,
} from "./shared.ts";

function extractPluginIdentity(req: any): string | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  if (typeof body.identity === "string" && body.identity.trim()) return body.identity.trim().slice(0, 120);
  if (typeof query.identity === "string" && query.identity.trim()) return query.identity.trim().slice(0, 120);
  return identityOf(req);
}

export const pluginRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------------------------------------------ *
   * 公开查询与校验
   * ------------------------------------------------------------------ */

  /**
   * 插件市场列表查询（默认仅返回 published 插件）
   */
  app.get(
    "/api/plugins",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const kind = q.kind?.trim();
      const search = q.q?.trim();
      const sort = q.sort?.trim() || "new";
      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 24)) : 24;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;

      const res = await ctx.repo.listPlugins({
        status: "published",
        kind: kind || undefined,
        q: search || undefined,
        sort,
        limit,
        offset,
      });

      const items = res.items.map((plugin) => ({
        ...plugin,
        summary: summarizePluginManifest(plugin.manifest),
      }));

      return {
        items,
        total: res.total,
        limit,
        offset,
      };
    }
  );

  /**
   * 插件语义检索：描述需求即可找到（模型不可用时自动关键词回退，degraded 标注）
   */
  app.get(
    "/api/plugins/search",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, _reply) => {
      const q = req.query as Record<string, string | undefined>;
      return await searchPluginsSemantic(ctx, {
        q: q.q?.trim() ?? "",
        kind: q.kind?.trim() || undefined,
        limit: q.limit ? parseInt(q.limit, 10) || undefined : undefined,
      });
    }
  );

  /**
   * 管理员查询全量/按状态筛选插件
   */
  app.get(
    "/api/admin/plugins",
    { config: { scope: "read" } },
    async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const status = q.status?.trim();
      const kind = q.kind?.trim();
      const search = q.q?.trim();
      const sort = q.sort?.trim() || "new";
      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 24)) : 24;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;

      const res = await ctx.repo.listPlugins({
        status: status || undefined,
        kind: kind || undefined,
        q: search || undefined,
        sort,
        limit,
        offset,
      });

      const pendingRes = await ctx.repo.listPlugins({ status: "pending", limit: 1 });

      const items = res.items.map((plugin) => ({
        ...plugin,
        summary: summarizePluginManifest(plugin.manifest),
      }));

      return {
        items,
        total: res.total,
        pending: pendingRes.total,
        limit,
        offset,
      };
    }
  );

  /**
   * 插件生态大盘遥测数据
   */
  app.get(
    "/api/admin/plugins/metrics",
    { config: { scope: "read" } },
    async (_req, _reply) => {
      const telemetry = await ctx.repo.getPluginTelemetry();
      return telemetry;
    }
  );


  /**
   * 获取当前用户已安装的插件清单
   */
  app.get(
    "/api/plugins/installed",
    { config: { scope: "public" } },
    async (req, reply) => {
      const identity = identityOf(req as any);
      if (!identity) {
        return badRequest(reply, "缺少用户身份标识 (identity/anonId)");
      }

      const rows = await ctx.repo.raw(
        `SELECT p.*, i.installed_at, i.version AS installed_version
         FROM plugin_installs i
         JOIN plugins p ON p.id = i.plugin_id
         WHERE i.identity = ? AND i.removed_at IS NULL
         ORDER BY i.installed_at DESC`,
        [identity]
      );

      const items = rows.map((r: any) => ({
        id: String(r.id),
        slug: String(r.slug),
        kind: String(r.kind),
        name: String(r.name),
        description: String(r.description),
        icon: r.icon,
        version: String(r.version),
        installedVersion: String(r.installed_version),
        installedAt: Number(r.installed_at),
        source: String(r.source),
      }));

      return { items, total: items.length };
    }
  );

  /**
   * 无副作用预检校验（供发布/导入向导使用）
   */
  app.post(
    "/api/plugins/validate",
    { config: { scope: "public", rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = req.body as { manifest?: unknown } | unknown;
      const manifestInput =
        typeof body === "object" && body !== null && "manifest" in body
          ? (body as { manifest: unknown }).manifest
          : body;

      const validated = validateAndCleanPluginManifest(manifestInput);
      if (!validated.ok) {
        reply.code(400);
        return {
          ok: false,
          error: "插件清单格式不合法",
          errors: validated.errors,
        };
      }

      const summary = summarizePluginManifest(validated.manifest);
      return {
        ok: true,
        manifest: validated.manifest,
        summary,
      };
    }
  );

  /**
   * 插件详情查询
   * 未上架插件对普通访客返回 404；已上架返回完整信息及安装/星标状态
   */
  app.get(
    "/api/plugins/:slug",
    { config: { scope: "public" } },
    async (req, reply) => {
      const rawSlug = (req.params as { slug: string }).slug;
      const slug = decodeURIComponent(rawSlug);
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);

      // 状态门禁：非 published 仅授权身份/管理台可见，普通访客直接 404
      if (plugin.status !== "published") {
        const callerAuth = (req as { auth?: { scopes?: string[] } }).auth;
        const isAdmin = callerAuth?.scopes?.includes("admin");
        if (!isAdmin) {
          return notFound(reply, `插件未上架或不存在: ${slug}`);
        }
      }

      const identity = extractPluginIdentity(req);
      let isInstalled = false;
      let isStarred = false;
      let installRecord = null;
      let upgradeDiff = null;

      if (identity) {
        installRecord = await ctx.repo.getPluginInstall(plugin.id, identity);
        isInstalled = Boolean(installRecord && installRecord.removedAt === null);
        isStarred = await ctx.repo.hasUserStarredPlugin(plugin.id, identity);
        if (
          isInstalled &&
          installRecord?.version &&
          comparePluginVersions(plugin.version, installRecord.version) > 0
        ) {
          const installedManifest = await ctx.repo.getPluginInstalledManifest(plugin.id, identity);
          if (installedManifest) {
            upgradeDiff = diffPluginManifests(installedManifest, plugin.manifest);
          }
        }
      }

      const hasUpgrade = Boolean(
        isInstalled &&
        installRecord?.version &&
        comparePluginVersions(plugin.version, installRecord.version) > 0
      );

      const reviewStats = await ctx.repo.getPluginReviewStats(plugin.id);
      const myReview = identity ? await ctx.repo.getUserPluginReview(plugin.id, identity) : null;

      return {
        plugin: {
          ...plugin,
          installed: isInstalled,
          starred: isStarred,
          installedVersion: isInstalled ? installRecord?.version : null,
          installedAt: isInstalled ? installRecord?.installedAt : null,
          hasUpgrade,
          upgradeDiff,
          reviewStats,
          myReview,
        },
        summary: summarizePluginManifest(plugin.manifest),
      };
    }
  );

  /**
   * 相似插件（详情页发现回路）：语义向量近邻，排除自身与未上架项
   */
  app.get(
    "/api/plugins/:slug/similar",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const rawSlug = (req.params as { slug: string }).slug;
      const slug = decodeURIComponent(rawSlug);
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin || plugin.status !== "published") {
        return notFound(reply, `插件未上架或不存在: ${slug}`);
      }
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? parseInt(q.limit, 10) || 6 : 6;
      return await similarPlugins(ctx, slug, limit);
    }
  );

  /**
   * 任意两份插件清单差异比对 (供发布/更新/升级前预览使用)
   */
  app.post(
    "/api/plugins/diff",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        baseManifest?: unknown;
        targetManifest?: unknown;
        slug?: string;
      };

      let base: PluginManifest | null = null;
      let target: PluginManifest | null = null;

      if (body.slug && !body.baseManifest) {
        const p = await ctx.repo.getPluginBySlug(body.slug);
        if (p) base = p.manifest;
      } else if (body.baseManifest) {
        const vBase = validateAndCleanPluginManifest(body.baseManifest);
        if (!vBase.ok) {
          return badRequest(reply, "基准清单格式不合法: " + vBase.errors.join(", "));
        }
        base = vBase.manifest;
      }

      if (body.targetManifest) {
        const vTarget = validateAndCleanPluginManifest(body.targetManifest);
        if (!vTarget.ok) {
          return badRequest(reply, "目标清单格式不合法: " + vTarget.errors.join(", "));
        }
        target = vTarget.manifest;
      }

      if (!base || !target) {
        return badRequest(reply, "比对需要提供基准清单与目标清单（或合法 slug）");
      }

      const diff = diffPluginManifests(base, target);
      return { ok: true, diff };
    }
  );

  /**
   * 查询插件所有已发布的版本历史时间线
   */
  app.get(
    "/api/plugins/:slug/versions",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);

      const versions = await ctx.repo.listPluginVersions(plugin.id);
      return {
        slug: plugin.slug,
        currentVersion: plugin.version,
        versions: versions.map((v) => ({
          version: v.version,
          changelog: v.changelog,
          checksum: v.checksum,
          publishedAt: v.publishedAt,
          createdAt: v.createdAt,
        })),
      };
    }
  );

  /**
   * 查询指定历史版本的清单快照与对比当前版本的差异
   */
  app.get(
    "/api/plugins/:slug/versions/:version",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const { slug, version } = req.params as { slug: string; version: string };
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);

      const vRecord = await ctx.repo.getPluginVersion(plugin.id, version);
      if (!vRecord) return notFound(reply, `未找到该版本历史: v${version}`);

      const diffAgainstCurrent = diffPluginManifests(vRecord.manifest, plugin.manifest);

      return {
        slug: plugin.slug,
        version: vRecord.version,
        manifest: vRecord.manifest,
        changelog: vRecord.changelog,
        checksum: vRecord.checksum,
        publishedAt: vRecord.publishedAt,
        diffAgainstCurrent,
      };
    }
  );

  /**
   * 获取插件评价列表与评分大盘
   */
  app.get(
    "/api/plugins/:slug/reviews",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const q = req.query as Record<string, string | undefined>;
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);

      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20)) : 20;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;
      const identity = (q.identity?.trim() || identityOf(req as any) || "").slice(0, 120);

      const [reviewsResult, stats, myReview] = await Promise.all([
        ctx.repo.listPluginReviews(plugin.id, { limit, offset }),
        ctx.repo.getPluginReviewStats(plugin.id),
        identity ? ctx.repo.getUserPluginReview(plugin.id, identity) : null,
      ]);

      return {
        slug: plugin.slug,
        stats,
        myReview,
        items: reviewsResult.items,
        total: reviewsResult.total,
        limit,
        offset,
      };
    }
  );

  /**
   * 提交或更新插件评价（仅限活跃安装用户）
   */
  app.post(
    "/api/plugins/:slug/reviews",
    { config: { scope: "public", rateLimit: { max: 15, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const body = (req.body ?? {}) as { rating?: unknown; title?: unknown; content?: unknown; identity?: unknown };
      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      const identity = String(body.identity ?? callerAuth?.actor ?? identityOf(req as any) ?? "").trim();

      if (!identity) {
        return badRequest(reply, "缺少用户身份标识");
      }

      const rating = Number(body.rating);
      if (isNaN(rating) || rating < 1 || rating > 5) {
        return badRequest(reply, "评分必须为 1 到 5 之间的整数");
      }

      try {
        const review = await ctx.repo.createPluginReview(
          slug,
          identity,
          {
            rating,
            title: typeof body.title === "string" ? body.title : null,
            content: typeof body.content === "string" ? body.content : null,
          },
          {
            actor: identity,
            actorKind: callerAuth?.kind ?? "identity",
            ip: req.ip,
          }
        );

        const stats = await ctx.repo.getPluginReviewStats(review.pluginId);

        reply.code(201);
        return {
          success: true,
          review,
          stats,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, message);
      }
    }
  );


  /* ------------------------------------------------------------------ *
   * 投稿、导入与版本更新
   * ------------------------------------------------------------------ */

  /**
   * 社区发布插件
   * 默认进入 pending 待审队列
   */
  app.post(
    "/api/plugins",
    { config: { scope: "public", rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { manifest?: unknown } & Record<string, unknown>;
      const manifestInput = body.manifest ?? body;

      const validated = validateAndCleanPluginManifest(manifestInput);
      if (!validated.ok) {
        reply.code(400);
        return {
          error: "插件清单校验失败",
          errors: validated.errors,
        };
      }

      const callerAuth = (req as { auth?: { actor?: string; kind?: string; scopes?: string[] } }).auth;
      const actorName = callerAuth?.actor || identityOf(req as any) || validated.manifest.author || "anonymous";
      const actorKind = callerAuth?.kind || "user";

      try {
        const createdPlugin = await ctx.repo.createPlugin(
          {
            manifest: validated.manifest,
            author: validated.manifest.author || actorName,
            authorKind: actorKind,
            source: "user",
            status: "pending",
          },
          {
            actor: actorName,
            actorKind,
            ip: req.ip,
          }
        );

        reply.code(201);
        return {
          ...createdPlugin,
          success: true,
          summary: summarizePluginManifest(createdPlugin.manifest),
        };
      } catch (err) {
        console.error("[plugins route] createPlugin failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        return conflict(reply, message);
      }
    }
  );

  /**
   * 外部离线包一键导入 (Direct Import)
   * 直接标记为 published，重名冲突返回 409
   */
  app.post(
    "/api/plugins/import",
    { config: { scope: "write" } },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        manifest?: unknown;
        installNow?: boolean;
        slug?: string;
      } & Record<string, unknown>;

      const manifestInput = body.manifest ?? body;
      const validated = validateAndCleanPluginManifest(manifestInput);
      if (!validated.ok) {
        reply.code(400);
        return { error: "插件清单校验失败", errors: validated.errors };
      }

      // 重名检查：如果已有同名插件，返回 409
      const existingList = await ctx.repo.listPlugins({ q: validated.manifest.name, limit: 10 });
      if (existingList.items.some((p) => p.name === validated.manifest.name)) {
        return conflict(reply, `已存在同名插件: ${validated.manifest.name}`);
      }

      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      const actorName = callerAuth?.actor || identityOf(req as any) || "admin";
      const actorKind = callerAuth?.kind || "token";

      try {
        const imported = await ctx.repo.createPlugin(
          {
            manifest: validated.manifest,
            author: validated.manifest.author || actorName,
            authorKind: actorKind,
            source: "import",
            status: "published",
            slug: body.slug,
          },
          {
            actor: actorName,
            actorKind,
            ip: req.ip,
          }
        );

        // 直接上架：与审核 approve 同一条索引路径（失败只记 notes，不影响导入结果）
        await indexPluginsBatch(ctx, [indexItemFromManifest(imported.slug, imported.manifest)]);

        let installResult = null;
        if (body.installNow) {
          const identity = identityOf(req as any) || "admin";
          installResult = await ctx.repo.installPlugin(imported.slug, identity, {
            actor: actorName,
            actorKind,
            ip: req.ip,
          });
        }

        reply.code(201);
        return {
          ...imported,
          success: true,
          install: installResult,
          summary: summarizePluginManifest(imported.manifest),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return conflict(reply, message);
      }
    }
  );

  /**
   * 更新插件版本/清单 (PUT / PATCH)
   * 状态自动重置为 pending，清空 published_at
   */
  const updateHandler = async (req: any, reply: any) => {
    const { slug } = req.params as { slug: string };
    const body = (req.body ?? {}) as { manifest?: unknown } & Record<string, unknown>;
    const manifestInput = body.manifest ?? body;

    const validated = validateAndCleanPluginManifest(manifestInput);
    if (!validated.ok) {
      reply.code(400);
      return { error: "插件清单格式不合法", errors: validated.errors };
    }

    const callerAuth = req.auth;
    try {
      const updated = await ctx.repo.updatePlugin(
        slug,
        validated.manifest,
        {
          actor: callerAuth?.actor || "editor",
          actorKind: callerAuth?.kind,
          ip: req.ip,
        }
      );
      // 更新回到待审：摘掉旧版本语义向量，重新过审时按新内容重建
      await removePluginIndex(ctx, slug);
      return {
        ...updated,
        success: true,
        summary: summarizePluginManifest(updated.manifest),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return badRequest(reply, message);
    }
  };

  app.put("/api/plugins/:slug", { config: { scope: "write" } }, updateHandler);
  app.patch("/api/plugins/:slug", { config: { scope: "write" } }, updateHandler);

  /* ------------------------------------------------------------------ *
   * 管理员审核工作流 (Review Workflow)
   * ------------------------------------------------------------------ */

  /**
   * 审核插件：approve（上架）、reject（驳回）、delist（下架）
   * 重复 approve 返回 409
   */
  const reviewHandler = async (req: any, reply: any) => {
    const { slug } = req.params as { slug: string };
    const body = z
      .object({
        action: z.enum(["approve", "reject", "delist"]),
        note: z.string().max(500).nullable().optional(),
      })
      .safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "请指定合法的审核操作（approve / reject / delist）");
    }

    const existing = await ctx.repo.getPluginBySlug(slug);
    if (!existing) return notFound(reply, `插件不存在: ${slug}`);

    if (body.data.action === "approve" && existing.status === "published") {
      return conflict(reply, "该插件已处于上架状态，请勿重复通过");
    }

    const callerAuth = req.auth;
    try {
      const reviewed = await ctx.repo.reviewPlugin(
        slug,
        body.data.action,
        body.data.note ?? null,
        {
          actor: callerAuth?.actor || "admin",
          actorKind: callerAuth?.kind || "admin",
          ip: req.ip,
        }
      );
      // 上架 -> 建/重建语义索引；驳回/下架 -> 摘掉向量（检索仍以 published 为准）
      if (body.data.action === "approve") {
        await indexPluginsBatch(ctx, [indexItemFromManifest(reviewed.slug, reviewed.manifest)]);
      } else {
        await removePluginIndex(ctx, slug);
      }
      return {
        success: true,
        plugin: reviewed,
        action: body.data.action,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return badRequest(reply, message);
    }
  };

  app.post("/api/plugins/:slug/review", { config: { scope: "write" } }, reviewHandler);
  app.patch("/api/plugins/:slug/review", { config: { scope: "write" } }, reviewHandler);

  /* ------------------------------------------------------------------ *
   * 安装、卸载生命周期
   * ------------------------------------------------------------------ */

  /**
   * 安装插件
   * site-pack 服务端增量落库并标记 source=plugin:<slug>
   * 未上架插件拒绝安装（409），缺失 identity 返回 400
   */
  app.post(
    "/api/plugins/:slug/install",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const identity = extractPluginIdentity(req);
      if (!identity) {
        return badRequest(reply, "缺少用户身份标识 (anonId/userId/identity)");
      }

      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);
      if (plugin.status !== "published") {
        return conflict(reply, `插件当前处于 ${plugin.status} 状态，未上架插件不可安装`);
      }

      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      try {
        const result = await ctx.repo.installPlugin(slug, identity, {
          actor: callerAuth?.actor || identity,
          actorKind: callerAuth?.kind || "identity",
          ip: req.ip,
        });
        // 新建站点进检索向量索引（失败只记 capabilities.notes，不影响安装结果）
        if (result.applied.createdSiteIds.length > 0) {
          const sites = (await Promise.all(result.applied.createdSiteIds.map((id) => ctx.repo.getSite(id))))
            .filter((s): s is NonNullable<typeof s> => !!s)
            .map((s) => ({ id: s.id, title: s.title, description: s.description ?? null, url: s.url }));
          await indexSitesBatch(ctx, sites);
        }
        return {
          success: true,
          ...result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, message);
      }
    }
  );

  /**
   * 卸载插件 (DELETE & POST)
   * removeSites: true 可选将插件带来的站点软删除
   */
  const uninstallHandler = async (req: any, reply: any) => {
    const { slug } = req.params as { slug: string };
    const identity = extractPluginIdentity(req);
    if (!identity) {
      return badRequest(reply, "缺少用户身份标识 (anonId/userId/identity)");
    }

    const q = (req.query ?? {}) as Record<string, string>;
    const body = (req.body ?? {}) as { removeSites?: boolean };
    const removeSites = q.removeSites === "true" || Boolean(body.removeSites);

    const callerAuth = req.auth;
    try {
      const result = await ctx.repo.uninstallPlugin(
        slug,
        identity,
        { removeSites },
        {
          actor: callerAuth?.actor || identity,
          actorKind: callerAuth?.kind || "identity",
          ip: req.ip,
        }
      );
      return {
        success: true,
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return badRequest(reply, message);
    }
  };

  app.delete("/api/plugins/:slug/install", { config: { scope: "public" } }, uninstallHandler);
  app.post("/api/plugins/:slug/uninstall", { config: { scope: "public" } }, uninstallHandler);

  /* ------------------------------------------------------------------ *
   * 社区互动：星标与举报
   * ------------------------------------------------------------------ */

  /**
   * 点亮星标（幂等）
   */
  app.post(
    "/api/plugins/:slug/star",
    { config: { scope: "public", rateLimit: { max: 60, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const identity = extractPluginIdentity(req);
      if (!identity) return badRequest(reply, "缺少用户身份标识");

      try {
        const result = await ctx.repo.starPlugin(slug, identity);
        return { success: true, ...result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, message);
      }
    }
  );

  /**
   * 取消星标（幂等）
   */
  app.delete(
    "/api/plugins/:slug/star",
    { config: { scope: "public", rateLimit: { max: 60, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const identity = extractPluginIdentity(req);
      if (!identity) return badRequest(reply, "缺少用户身份标识");

      try {
        const result = await ctx.repo.unstarPlugin(slug, identity);
        return { success: true, ...result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, message);
      }
    }
  );

  /**
   * 违规举报（理由不能为空）
   */
  app.post(
    "/api/plugins/:slug/report",
    { config: { scope: "public", rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const body = (req.body ?? {}) as { reason?: string };
      const reason = (body.reason ?? "").trim();

      if (!reason) {
        return badRequest(reply, "请填写举报理由（不能为空）");
      }

      const identity = identityOf(req as any) || undefined;
      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      try {
        const result = await ctx.repo.reportPlugin(
          slug,
          {
            reason,
            identity,
          },
          {
            actor: callerAuth?.actor || identity || "anonymous",
            actorKind: callerAuth?.kind,
            ip: req.ip,
          }
        );
        return {
          success: true,
          message: "举报已受理",
          ...result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, message);
      }
    }
  );
};
