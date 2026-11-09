/**
 * 插件市场路由 · 分段 1/5：市场浏览（列表 / 搜索 / 我的 / 作者）
 *
 * 自 routes/plugins.ts 按**原声明顺序**切出（连续区间），未做主题重排——
 * 路由顺序会影响路由表，保序切分让「改造前后 app.printRoutes() 逐字节一致」成立。
 * 本文件由 plugins.ts 的 pluginRoutes 直接调用（不经 register：register 会把路由
 * 延后到父级 ready 之后，改变注册顺序）。
 */
import type { FastifyPluginAsync } from "fastify";
import { seedPluginDefs } from "../../seed-plugins.ts";
import { indexPluginsBatch, indexItemFromManifest, type IndexPluginItem } from "../../index-plugin.ts";
import { searchPluginsSemantic } from "../../plugins-search.ts";
import {
  validatePluginManifestWithCatalog,
  summarizePluginManifest,
  comparePluginVersions,
  canonicalJsonStringify,
  } from "@navhub/core";
import { safeDecodeParam,
  badRequest,
  identityTrusted,
  notFound,
  unauthorized,
} from "../shared.ts";
import {
  extractPluginIdentity,
  publicPlugin,
  } from "../plugin-presentation.ts";
import type { AppContext } from "../../context.ts";

export const pluginRoutesPart1: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
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
    async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const kind = q.kind?.trim();
      const search = q.q?.trim();
      const sort = q.sort?.trim() || "new";
      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 24)) : 24;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;
      const featured = q.featured === "true" ? true : q.featured === "false" ? false : undefined;
      const ownerKey = (q.ownerKey ?? q.author)?.trim() || undefined;

      const res = await ctx.repo.listPlugins({
        status: "published",
        kind: kind || undefined,
        q: search || undefined,
        featured,
        ownerKey,
        sort,
        limit,
        offset,
      });

      /**
       * 列表瘦身（2026-10 实测）：一页 24 条的响应 **1.16MB**，其中 730KB 是
       * site-pack 的 manifest（单个约 34KB，内含最多 200 个站点 + 20 个分类）。
       *
       * 客户端在列表页从不读 site-pack 的 manifest：
       *  - 卡片只用 `summary`（siteCount / categoryCount / hosts）；
       *  - 详情页与安装弹窗都走 `/api/plugins/:slug` 拿完整清单；
       *  - 安装动作由服务端按 slug 读库，不需要浏览器上传清单。
       * 只有「复制 JSON 清单」这类工具场景需要（Raycast 扩展），
       * 它们显式带 `?manifest=1` 即可拿回全量——默认精简、按需完整。
       */
      const includeManifest = q.manifest === "1" || q.manifest === "true";
      const items = res.items.map((plugin) => {
        const item: Record<string, unknown> = {
          ...publicPlugin(plugin),
          summary: summarizePluginManifest(plugin.manifest),
        };
        if (!includeManifest && plugin.kind === "site-pack") delete item.manifest;
        return item;
      });

      return {
        items,
        total: res.total,
        limit,
        offset,
      };
    }
  );

  /**
   * 我的插件（作者中心）：按发布身份列出全部状态，含待审说明与待审变更日志。
   * 身份从 query/body identity 或网关注入的 anonId/userId 解析。
   */
  app.get(
    "/api/plugins/mine",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const identity = extractPluginIdentity(req);
      if (!identity) return badRequest(reply, "缺少用户身份标识 (identity/anonId)");
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 24)) : 24;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;
      const res = await ctx.repo.listPluginsByOwner(identity, { sort: "updated", limit, offset });
      return {
        items: res.items.map((plugin) => ({
          ...publicPlugin(plugin, { ownerView: true }),
          summary: summarizePluginManifest(plugin.manifest),
          editable: true,
        })),
        total: res.total,
        limit,
        offset,
      };
    }
  );

  /**
   * 公开作者页：只暴露 published 插件与聚合计数；ownerKey 为身份不可逆哈希。
   */
  app.get(
    "/api/plugins/author/:key",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const key = ((req.params as { key: string }).key ?? "").trim();
      if (!/^[a-f0-9]{8,64}$/i.test(key)) return badRequest(reply, "作者 key 格式不合法");
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 24)) : 24;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;
      const [res, all] = await Promise.all([
        ctx.repo.listPluginsByOwnerKey(key, { limit, offset }),
        ctx.repo.listPluginsByOwnerKey(key, { limit: 100 }),
      ]);
      if (res.total === 0) return notFound(reply, "作者不存在或暂无已上架插件");
      const first = all.items[0];
      return {
        ownerKey: key,
        author: first?.author ?? "匿名作者",
        authorKind: first?.authorKind ?? null,
        stats: {
          plugins: res.total,
          installs: all.items.reduce((sum, p) => sum + p.installCount, 0),
          stars: all.items.reduce((sum, p) => sum + p.starCount, 0),
        },
        items: res.items.map((plugin) => ({
          ...publicPlugin(plugin),
          summary: summarizePluginManifest(plugin.manifest),
        })),
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
    async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const status = q.status?.trim();
      const kind = q.kind?.trim();
      const search = q.q?.trim();
      const sort = q.sort?.trim() || "new";
      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 24)) : 24;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;
      const featured = q.featured === "true" ? true : q.featured === "false" ? false : undefined;

      const res = await ctx.repo.listPlugins({
        status: status || undefined,
        kind: kind || undefined,
        q: search || undefined,
        featured,
        sort,
        limit,
        offset,
      });

      const pendingRes = await ctx.repo.listPlugins({ status: "pending", limit: 1 });

      const items = res.items.map((plugin) => ({
        ...publicPlugin(plugin),
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

  /** 市场漏斗：浏览 → 安装点击 → 安装成功 → 卸载/举报（按日） */
  app.get(
    "/api/admin/plugins/funnel",
    { config: { scope: "read", cache: { maxAge: 0 } } },
    async (req, _reply) => {
      const q = req.query as Record<string, string | undefined>;
      const days = q.days ? Math.min(90, Math.max(1, parseInt(q.days, 10) || 30)) : 30;
      return await ctx.repo.getPluginFunnel(days);
    }
  );

  /** 治理告警：待审 SLA、插件举报、评价举报（只读建议） */
  app.get(
    "/api/admin/plugins/governance",
    { config: { scope: "read", cache: { maxAge: 0 } } },
    async (_req, _reply) => {
      return { alerts: await ctx.repo.getPluginGovernanceAlerts(), generatedAt: Date.now() };
    }
  );


  /** 获取官方内置插件资源库同步状态与可用版本统计 */
  app.get(
    "/api/admin/plugins/seed-status",
    { config: { scope: "admin" } },
    async () => {
      const defs = seedPluginDefs();
      let needUpdateCount = 0;
      let missingCount = 0;
      let upToDateCount = 0;

      for (const def of defs) {
        const existing = await ctx.repo.getPluginBySlug(def.slug);
        const manifest = def.manifest as { version?: string };
        if (!existing) {
          missingCount++;
        } else if (manifest?.version && comparePluginVersions(manifest.version, existing.version) > 0) {
          needUpdateCount++;
        } else {
          upToDateCount++;
        }
      }

      return {
        ok: true,
        catalogVersion: "2026.10",
        totalCatalog: defs.length,
        missingCount,
        needUpdateCount,
        upToDateCount,
        hasAvailableUpdates: missingCount > 0 || needUpdateCount > 0,
      };
    }
  );

  /**
   * 官方插件资源库在线无损热同步 (Official Seed Catalog Hot-Sync)
   * 支持管理员在 Web 端一键把代码库最新内置插件同步至数据库，新包自动上架，已有包升级版本，非破坏性保护用户自定义数据。
   */
  app.post(
    "/api/admin/plugins/seed-sync",
    { config: { scope: "admin" } },
    async (req) => {
      const defs = seedPluginDefs();
      const orderedDefs = [
        ...defs.filter((d) => (d.manifest as { kind?: string } | null)?.kind !== "bundle"),
        ...defs.filter((d) => (d.manifest as { kind?: string } | null)?.kind === "bundle"),
      ];

      let added = 0;
      let updated = 0;
      let upToDate = 0;
      let failed = 0;
      const details: Array<{ slug: string; action: "added" | "updated" | "up_to_date" | "failed"; version: string; error?: string }> = [];
      const pendingIndex: IndexPluginItem[] = [];

      for (const def of orderedDefs) {
        const validated = validatePluginManifestWithCatalog(def.manifest);
        if (!validated.ok) {
          failed++;
          details.push({ slug: def.slug, action: "failed", version: "unknown", error: validated.errors.join("; ") });
          continue;
        }

        try {
          const existing = await ctx.repo.getPluginBySlug(def.slug);
          if (!existing) {
            const created = await ctx.repo.createPlugin(
              {
                manifest: validated.manifest,
                author: validated.manifest.author ?? "山羊胡官方",
                authorKind: "seed",
                ownerIdentity: "seed",
                source: "seed",
                status: def.status,
                slug: def.slug,
              },
              { actor: (req as any).auth?.actor || "admin", actorKind: "admin", ip: req.ip }
            );
            if (def.status === "published") {
              pendingIndex.push(indexItemFromManifest(created.slug, created.manifest));
            }
            added++;
            details.push({ slug: def.slug, action: "added", version: validated.manifest.version });
          } else {
            const versionBumped = comparePluginVersions(validated.manifest.version, existing.version) > 0;
            // 比内容而非比字节：清单键序不是承诺过的不变量（自由结构的 config/tokens
            // 保留源对象键序，清理函数跨版本重建时字段顺序也会变），
            // JSON.stringify 会把语义相同的清单判成 updated（重置待审 + 重新入索引）。
            const contentChanged =
              canonicalJsonStringify(existing.manifest) !== canonicalJsonStringify(validated.manifest);
            if (versionBumped || contentChanged) {
              await ctx.repo.updatePlugin(def.slug, validated.manifest, {
                actor: (req as any).auth?.actor || "admin",
                actorKind: "admin",
                ip: req.ip,
              });
              if (def.status === "published") {
                await ctx.repo.reviewPlugin(def.slug, "approve", "官方种子资源在线同步自动上架", {
                  actor: (req as any).auth?.actor || "admin",
                  actorKind: "admin",
                  ip: req.ip,
                });
                pendingIndex.push(indexItemFromManifest(def.slug, validated.manifest));
              }
              updated++;
              details.push({ slug: def.slug, action: "updated", version: validated.manifest.version });
            } else {
              upToDate++;
              details.push({ slug: def.slug, action: "up_to_date", version: existing.version });
            }
          }
        } catch (err) {
          failed++;
          details.push({ slug: def.slug, action: "failed", version: validated.manifest.version, error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (pendingIndex.length > 0) {
        await indexPluginsBatch(ctx, pendingIndex);
      }

      await ctx.repo.audit({
        actor: (req as any).auth?.actor || "admin",
        actorKind: "admin",
        action: "plugin.seed_sync",
        target: "catalog",
        diff: { added, updated, upToDate, failed, total: defs.length },
        ip: req.ip,
      });

      return {
        ok: true,
        summary: {
          total: defs.length,
          added,
          updated,
          upToDate,
          failed,
        },
        details,
        syncedAt: Date.now(),
      };
    }
  );

  /** 评价治理列表：默认全部状态，支持 status=visible|hidden 过滤 */
  app.get(
    "/api/admin/plugin-reviews",
    { config: { scope: "read", cache: { maxAge: 0 } } },
    async (req, _reply) => {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 30)) : 30;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;
      const status = q.status === "visible" || q.status === "hidden" ? q.status : undefined;
      const res = await ctx.repo.listPluginReviewsForAdmin({ status, limit, offset });
      return { ...res, limit, offset };
    }
  );

  /** 隐藏/恢复评价（管理台）；隐藏后立即退出公开列表与评分统计 */
  app.patch(
    "/api/admin/plugin-reviews/:id",
    { config: { scope: "write" } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = (req.body ?? {}) as { action?: string; note?: string };
      if (body.action !== "hide" && body.action !== "restore") {
        return badRequest(reply, "action 必须为 hide 或 restore");
      }
      try {
        const review = await ctx.repo.moderatePluginReview(
          id,
          body.action,
          typeof body.note === "string" ? body.note : null,
          { actor: (req as any).auth?.actor ?? "admin", actorKind: "admin", ip: req.ip },
        );
        return { ok: true, review };
      } catch (err) {
        return notFound(reply, err instanceof Error ? err.message : "评价不存在");
      }
    }
  );

  /** 编辑精选开关（管理台） */
  app.patch(
    "/api/plugins/:slug/featured",
    { config: { scope: "write" } },
    async (req, reply) => {
      const slug = safeDecodeParam((req.params as { slug: string }).slug);
      const body = (req.body ?? {}) as { featured?: unknown; rank?: unknown };
      if (typeof body.featured !== "boolean") return badRequest(reply, "featured 必须为布尔值");
      const rank = typeof body.rank === "number" && Number.isFinite(body.rank) ? body.rank : 0;
      try {
        const plugin = await ctx.repo.setPluginFeatured(slug, body.featured, rank, {
          actor: (req as any).auth?.actor ?? "admin",
          actorKind: "admin",
          ip: req.ip,
        });
        return { ok: true, plugin: publicPlugin(plugin) };
      } catch (err) {
        return notFound(reply, err instanceof Error ? err.message : "插件不存在");
      }
    }
  );
};
