/**
 * 插件市场 REST 路由 (Plugin Marketplace Routes)
 *
 * 遵循 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md 设计规范与 apps/api/test/plugins-api.test.ts 契约：
 * 1. 声明式优先：全量消费 @navhub/core 的 validateAndCleanPluginManifest 纯函数校验；
 *    写入路径（发布/更新/订阅导入）再叠加模块目录核对，避免装出渲染不出来的空卡；
 * 2. 状态机闭环：pending -> published / rejected / delisted，更新必须重置为 pending；
 * 3. 审计留痕：publish, import, update, review, install, uninstall, report 均记录审计日志；
 * 4. 幂等与防刷：内置细粒度限流，星标/安装均具备去重与幂等保证。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { indexSitesBatch } from "../index-site.ts";
import { indexPluginsBatch, indexItemFromManifest, removePluginIndex, type IndexPluginItem } from "../index-plugin.ts";
import { searchPluginsSemantic, similarPlugins } from "../plugins-search.ts";
import { guardedFetch, assertUrlShape, isBlockedIp } from "@navhub/ai";
import { isIP } from "node:net";
import {
  executeAutoAuditAndPublish,
  evaluatePluginAudit,
  autoRemediatePluginManifest,
} from "../ai-plugin-auditor.ts";
import { randomBytes } from "node:crypto";
import {
  validateAndCleanPluginManifest,
  validatePluginManifestWithCatalog,
  summarizePluginManifest,
  diffPluginManifests,
  comparePluginVersions,
  httpUrl,
  isInternalShortLinkTarget,
  isSafeUrl,
  type PluginManifest,
} from "@navhub/core";

import type { AppContext } from "../context.ts";
import {
  badRequest,
  conflict,
  forbidden,
  identityOf,
  isAdminScope,
  identityTrusted,
  notFound,
  unauthorized,
} from "./shared.ts";
import {
  extractPluginIdentity,
  pluginIdentity,
  publicPlugin,
  renderBadgeSvg,
} from "./plugin-presentation.ts";

/**
 * 单次订阅源同步最多处理多少条清单条目（NAVHUB_TAP_IMPORT_MAX 可调）。
 * 清单长度来自远端，属于外部输入；处理上限必须在本侧成立。
 */
const MAX_TAP_IMPORT_ITEMS = Math.max(1, Number(process.env.NAVHUB_TAP_IMPORT_MAX || 500));

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
      const slug = decodeURIComponent((req.params as { slug: string }).slug);
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


  /**
   * 获取当前用户已安装的插件清单
   */
  app.get(
    "/api/plugins/installed",
    { config: { scope: "public" } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const identity = identityOf(req as never);
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

      const validated = validatePluginManifestWithCatalog(manifestInput);
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
   * 插件死链嗅探与健康检查：受限出网体检
   * 采用 SSRF 保护与严格超时，单次最多并发检测 30 个站点
   */
  app.post(
    "/api/plugins/check-urls",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = req.body as { urls?: unknown };
      if (!body || !Array.isArray(body.urls)) {
        return badRequest(reply, "缺少 urls 数组参数");
      }
      const rawUrls = body.urls as unknown[];
      if (rawUrls.length === 0) {
        return badRequest(reply, "urls 不能为空");
      }
      if (rawUrls.length > 30) {
        return badRequest(reply, "单次最多支持检测 30 个 URL");
      }

      const tasks = rawUrls.map(async (item) => {
        const urlStr = typeof item === "string" ? item.trim() : "";
        if (!urlStr) {
          return { url: urlStr, ok: false, status: 0, error: "URL 为空" };
        }
        try {
          const parsed = new URL(urlStr);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return { url: urlStr, ok: false, status: 0, error: "仅支持 HTTP(S) 协议" };
          }
        } catch {
          return { url: urlStr, ok: false, status: 0, error: "URL 格式不合法" };
        }

        try {
          const res = await guardedFetch(urlStr, {
            timeoutMs: 3500,
            maxBytes: 1024,
            maxRedirects: 3,
          });
          const ok = res.status >= 200 && res.status < 400;
          return {
            url: urlStr,
            ok,
            status: res.status,
            error: ok ? undefined : `HTTP ${res.status}`,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            url: urlStr,
            ok: false,
            status: 0,
            error: message,
          };
        }
      });

      const results = await Promise.all(tasks);
      const okCount = results.filter((r) => r.ok).length;
      return {
        success: true,
        total: results.length,
        okCount,
        failedCount: results.length - okCount,
        results,
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

      // 私有视图（归属/安装状态/我的评价）只跟随「配得上该身份」的调用方：
      // 无票请求降级为 null，插件本体仍按公开可见性返回。
      const identity = pluginIdentity(ctx, req);
      const isOwner = Boolean(identity && plugin.ownerIdentity && identity === plugin.ownerIdentity);

      // 状态门禁：非 published 仅作者/管理台可见，普通访客直接 404
      if (plugin.status !== "published") {
        // 不能直接读 req.auth.scopes：鉴权模式下的无票调用方带着 ANONYMOUS_IDENTITY
        // 的全量 scopes（hook 只在有效 token 时覆写），只有 kind 可信。
        const isAdmin = isAdminScope(ctx, req as never);
        if (!isAdmin && !isOwner) {
          return notFound(reply, `插件未上架或不存在: ${slug}`);
        }
      }

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
      const bundleItems = plugin.kind === "bundle" ? await ctx.repo.getPluginBundleMembers(plugin) : undefined;

      return {
        plugin: {
          ...publicPlugin(plugin, { ownerView: isOwner }),
          installed: isInstalled,
          starred: isStarred,
          installedVersion: isInstalled ? installRecord?.version : null,
          installedAt: isInstalled ? installRecord?.installedAt : null,
          hasUpgrade,
          upgradeDiff,
          reviewStats,
          myReview,
          isOwner,
          ...(bundleItems
            ? {
                bundleItems,
                bundleReady: bundleItems.every((member) => member.available),
              }
            : {}),
        },
        summary: summarizePluginManifest(plugin.manifest),
      };
    }
  );

  /**
   * 插件动态 SVG 徽章服务（供 README、文档与官网展示）：
   * 支持 metric: version | installs | rating | stars
   *
   * 缓存必须在 route config 里声明：onSend 钩子对「未声明 cache 的 GET」一律改写
   * `cache-control: no-store`，此前在这里手写 `public, max-age=300` 会被整行覆盖。
   * 徽章挂在 README / 官网首页上，no-store 意味着每次页面加载都回源打 2 次库，
   * 还要和全局 300/min IP 桶抢额度——高峰期直接表现为 429 碎图。
   * ETag 让超时后的再验证走 304，不必重新渲染 SVG。
   */
  app.get(
    "/api/plugins/:slug/badge.svg",
    { config: { scope: "public", cache: { maxAge: 300, etag: true } } },
    async (req, reply) => {
      const rawSlug = (req.params as { slug: string }).slug;
      const slug = decodeURIComponent(rawSlug);
      const q = req.query as Record<string, string | undefined>;
      const metric = q.metric?.toLowerCase().trim() || "version";
      const customLabel = q.label?.trim() || "navhub";

      reply.header("Content-Type", "image/svg+xml; charset=utf-8");

      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin || plugin.status !== "published") {
        reply.code(404);
        return renderBadgeSvg(customLabel, "not found", "#e05d44");
      }

      let rightText = `v${plugin.version}`;
      let rightColor = "#007ec6";

      if (metric === "installs") {
        rightText = `${plugin.installCount} installs`;
        rightColor = "#4c1";
      } else if (metric === "stars") {
        rightText = `${plugin.starCount} ★`;
        rightColor = "#dfb317";
      } else if (metric === "rating") {
        const stats = await ctx.repo.getPluginReviewStats(plugin.id);
        rightText = stats.reviewCount > 0 ? `${stats.avgRating.toFixed(1)} ★` : "unrated";
        rightColor = stats.reviewCount > 0 ? "#fe7d37" : "#9f9f9f";
      }

      return renderBadgeSvg(customLabel, rightText, rightColor);
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
          // 前端时间轴用 id 做 React key 与短标识；漏传会让 v.id.slice() 直接崩溃
          id: v.id,
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
      // myReview 属私有视图：统一走身份闸门 + identityOf 口径（64 字符），
      // 不再单独放宽到 120——写入侧（安装/星标/评价）一直按 identityOf 取值，
      // 这里读更长的串只会查不到自己的评价，或与签名校验的取值错位。
      const identity = pluginIdentity(ctx, req);

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
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      // 取值口径必须与签名 hook 同源（identityOf：Header → Query → Body，截 64）。
      // 旧的 `body.identity` 优先正是 `identity-plugin-impersonation.test.ts` 记过的那类
      // 破口：签自己的头 + body 塞受害者身份，校验通过却以受害者身份落评价，
      // 而评价还要求「活跃安装」，等于顺手把受害者的安装记录也用了。
      const identity = String(identityOf(req as never) ?? callerAuth?.actor ?? "").trim();

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
            title: typeof body.title === "string" ? body.title.slice(0, 200) : null,
            content: typeof body.content === "string" ? body.content.slice(0, 4000) : null,
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


  /**
   * 举报评价：只累计计数并进入治理队列，不自动隐藏（防恶意举报）。
   */
  app.post(
    "/api/plugins/:slug/reviews/:id/report",
    { config: { scope: "public", rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug, id } = req.params as { slug: string; id: string };
      const body = (req.body ?? {}) as { reason?: unknown };
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 2 || reason.length > 200) {
        return badRequest(reply, "举报原因需为 2-200 字");
      }
      // 匿名举报本来就允许（actor 回退 anonymous），但归属字段不能由无票调用方指定，
      // 否则可以把自己对某条评价的举报记到任意用户名下，污染其「我的举报」与治理队列。
      const identity = pluginIdentity(ctx, req);
      try {
        const review = await ctx.repo.reportPluginReview(slug, id, reason, identity, {
          actor: identity ?? "anonymous",
          actorKind: "identity",
          ip: req.ip,
        });
        return { ok: true, reportCount: review.reportCount };
      } catch (err) {
        return notFound(reply, err instanceof Error ? err.message : "评价不存在");
      }
    }
  );

  /* ------------------------------------------------------------------ *
   * 投稿、导入与版本更新
   * ------------------------------------------------------------------ */

  /**
   * 社区发布插件
   * 默认进入 pending 待审队列；若指定 autoAudit=true 则由 AI 智能审查中枢执行多维严审并自动批准上架
   */
  app.post(
    "/api/plugins",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { manifest?: unknown; autoAudit?: boolean } & Record<string, unknown>;
      const manifestInput = body.manifest ?? body;
      const q = req.query as Record<string, string | undefined>;
      const shouldAutoAudit = body.autoAudit === true || q?.autoAudit === "true" || q?.autoAudit === "1";

      const validated = validatePluginManifestWithCatalog(manifestInput);
      if (!validated.ok) {
        reply.code(400);
        return {
          error: "插件清单校验失败",
          errors: validated.errors,
        };
      }

      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const callerAuth = (req as { auth?: { actor?: string; kind?: string; scopes?: string[] } }).auth;
      // F0：发布必须能建立作者归属。不能用 req.auth.actor 兜底——开放模式下它是
      // anonymous，会把所有匿名投稿都算成同一个作者，/mine 与作者页随之失真。
      const identity = extractPluginIdentity(req);
      if (!identity) {
        return badRequest(reply, "缺少用户身份标识，无法建立作者归属");
      }
      const actorName = callerAuth?.actor || identity;
      const actorKind = callerAuth?.kind || "user";

      try {
        const createdPlugin = await ctx.repo.createPlugin(
          {
            manifest: validated.manifest,
            author: validated.manifest.author || identity,
            authorKind: actorKind,
            ownerIdentity: identity,
            source: "user",
            status: "pending",
          },
          {
            actor: actorName,
            actorKind,
            ip: req.ip,
          }
        );

        // AI 智能自动化审核与即时上架流水线
        if (shouldAutoAudit) {
          try {
            const { plugin: auditedPlugin, audit } = await executeAutoAuditAndPublish(ctx, createdPlugin, {
              actorIp: req.ip,
              identity,
            });
            reply.code(201);
            return {
              ...publicPlugin(auditedPlugin, { ownerView: true }),
              success: true,
              summary: summarizePluginManifest(auditedPlugin.manifest),
              audit,
            };
          } catch (auditErr) {
            console.error("[plugins route] executeAutoAuditAndPublish failed:", auditErr);
          }
        }

        reply.code(201);
        return {
          ...publicPlugin(createdPlugin, { ownerView: true }),
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
   * AI 智能自动审查与即时审批上架端点
   */
  app.post(
    "/api/plugins/:slug/ai-audit",
    { config: { scope: "public", rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const rawSlug = (req.params as { slug: string }).slug;
      const slug = decodeURIComponent(rawSlug);
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);

      // AI 审核会把插件直接推向 published，并按 identity 取用其**个人 LLM 密钥**
      // （resolveLlm → readStoredUser → openKey）。无票自称他人身份 = 白拿别人的额度，
      // 还能替别人上架。
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const identity = extractPluginIdentity(req);
      // 同上：无票调用方的 admin scope 是 ANONYMOUS_IDENTITY 的默认值，不是真凭据。
      // AI 审核会把插件直接推向 published，绝不能让「配了签名密钥的普通访客」蒙过这一关。
      const isAdmin = isAdminScope(ctx, req as never);
      const isOwner = Boolean(identity && plugin.ownerIdentity && identity === plugin.ownerIdentity);

      if (!isAdmin && !isOwner) {
        return forbidden(reply, "只有插件作者或管理员可发起 AI 自动化审核");
      }

      try {
        const { plugin: auditedPlugin, audit } = await executeAutoAuditAndPublish(ctx, plugin, {
          actorIp: req.ip,
          identity: identity || undefined,
        });

        return {
          success: true,
          plugin: publicPlugin(auditedPlugin, { ownerView: true }),
          summary: summarizePluginManifest(auditedPlugin.manifest),
          audit,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, `AI 审核执行失败: ${message}`);
      }
    }
  );

  /**
   * 插件清单提交前 AI 预检 (Pre-flight Audit)
   * 不写入数据库，直接返回全真静态沙箱扫描、外链探活、AI 伦理合规与四维评分雷达
   */
  app.post(
    "/api/plugins/pre-audit",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { manifest?: unknown } & Record<string, unknown>;
      const manifestInput = body.manifest ?? body;
      const validated = validatePluginManifestWithCatalog(manifestInput);
      if (!validated.ok) {
        return badRequest(reply, "插件清单格式不合法: " + validated.errors.join(", "));
      }

      // identity 在这里决定用谁的 LLM 配置（resolveLlm），无票调用方不得借用他人密钥，
      // 降级为系统配置即可，预检本身仍然可用。
      const identity = pluginIdentity(ctx, req);
      try {
        const audit = await evaluatePluginAudit(ctx, validated.manifest, {
          slug: validated.manifest.name,
          identity: identity || undefined,
        });

        return {
          ok: true,
          audit,
          summary: summarizePluginManifest(validated.manifest),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, `预检执行失败: ${message}`);
      }
    }
  );

  /**
   * AI 驱动的清单自动化深度修复与规范化 (Auto-Remediate)
   * 自动修复 HTTPS 协议、去重站点、规范分类与标签，并返回修复后的清单及修复日志
   */
  app.post(
    "/api/plugins/auto-fix",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { manifest?: unknown } & Record<string, unknown>;
      const manifestInput = body.manifest ?? body;
      const validated = validatePluginManifestWithCatalog(manifestInput);
      if (!validated.ok) {
        return badRequest(reply, "插件清单格式不合法: " + validated.errors.join(", "));
      }

      const identity = pluginIdentity(ctx, req);
      try {
        const { fixedManifest, changes } = autoRemediatePluginManifest(validated.manifest);
        const audit = await evaluatePluginAudit(ctx, fixedManifest, {
          slug: fixedManifest.name,
          identity: identity || undefined,
        });

        return {
          ok: true,
          manifest: fixedManifest,
          changes,
          audit,
          summary: summarizePluginManifest(fixedManifest),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, `自动修复失败: ${message}`);
      }
    }
  );

  /**
   * 外部离线包一键导入 (Direct Import)
   * 直接标记为 published，重名冲突返回 409
   */
  app.post(
    "/api/plugins/import",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        manifest?: unknown;
        installNow?: boolean;
        slug?: string;
      } & Record<string, unknown>;

      const manifestInput = body.manifest ?? body;
      const validated = validatePluginManifestWithCatalog(manifestInput);
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
      const actorName = callerAuth?.actor || identityOf(req as never) || "admin";
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
          const identity = identityOf(req as never) || "admin";
          installResult = await ctx.repo.installPlugin(imported.slug, identity, {
            actor: actorName,
            actorKind,
            ip: req.ip,
          });
        }

        reply.code(201);
        return {
          ...publicPlugin(imported),
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

    const validated = validatePluginManifestWithCatalog(manifestInput);
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
        ...publicPlugin(updated, { ownerView: true }),
        success: true,
        summary: summarizePluginManifest(updated.manifest),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return badRequest(reply, message);
    }
  };

  // 插件清单可直接进入市场并被安装，编辑/覆盖属于供应链写操作；
  // 作者自助发版走 /versions（带归属校验），这里只允许管理面。
  app.put("/api/plugins/:slug", { config: { scope: "admin" } }, updateHandler);
  app.patch("/api/plugins/:slug", { config: { scope: "admin" } }, updateHandler);

  /**
   * 作者自助提交新版本：仅归属作者或管理员；类型不可变、版本号严格递增。
   * 提交后回到 pending，旧语义向量立即失效，避免未审内容被检索命中。
   */
  app.post(
    "/api/plugins/:slug/versions",
    { config: { scope: "public", rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const slug = decodeURIComponent((req.params as { slug: string }).slug);
      const body = (req.body ?? {}) as { manifest?: unknown; changelog?: unknown } & Record<string, unknown>;
      const manifestInput = body.manifest ?? body;
      const validated = validatePluginManifestWithCatalog(manifestInput);
      if (!validated.ok) {
        reply.code(400);
        return { error: "插件清单格式不合法", errors: validated.errors };
      }

      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const identity = extractPluginIdentity(req);
      const callerAuth = (req as { auth?: { actor?: string; kind?: string; scopes?: string[] } }).auth;
      // 开放模式的匿名身份也带 admin scope，不能据此绕过归属校验；
      // 管理员更新走 PUT /api/plugins/:slug，本接口只服务作者自助提交。
      const isAdmin = Boolean(callerAuth?.scopes?.includes("admin")) && callerAuth?.kind !== "anonymous";
      if (!identity) return badRequest(reply, "缺少用户身份标识");
      if (!plugin.ownerIdentity || (plugin.ownerIdentity !== identity && !isAdmin)) {
        return forbidden(reply, "只有插件作者可以提交新版本");
      }

      const changelog = typeof body.changelog === "string" ? body.changelog.trim().slice(0, 2000) : null;
      const q = req.query as Record<string, string | undefined>;
      const shouldAutoAudit = (body as { autoAudit?: boolean }).autoAudit === true || q?.autoAudit === "true" || q?.autoAudit === "1";

      try {
        const updated = await ctx.repo.submitPluginVersion(slug, validated.manifest, changelog, {
          actor: callerAuth?.actor || identity,
          actorKind: callerAuth?.kind ?? "owner",
          ip: req.ip,
        });
        await removePluginIndex(ctx, slug);

        // 若请求要求由 AI 自动审核，则执行全链路严审并自动批准上架
        if (shouldAutoAudit) {
          try {
            const { plugin: auditedPlugin, audit } = await executeAutoAuditAndPublish(ctx, updated, {
              actorIp: req.ip,
              identity: identity || undefined,
            });
            reply.code(200);
            return {
              ...publicPlugin(auditedPlugin, { ownerView: true }),
              success: true,
              summary: summarizePluginManifest(auditedPlugin.manifest),
              audit,
            };
          } catch (auditErr) {
            console.error("[versions route] executeAutoAuditAndPublish failed:", auditErr);
          }
        }

        reply.code(202);
        return {
          ...publicPlugin(updated, { ownerView: true }),
          success: true,
          summary: summarizePluginManifest(updated.manifest),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return badRequest(reply, message);
      }
    }
  );

  /* ------------------------------------------------------------------ *
   * 管理员审核工作流 (Review Workflow)
   * ------------------------------------------------------------------ */

  /**
   * 审核插件：approve（上架）、reject（驳回）、delist（下架）
   * 重复 approve 返回 409
   *
   * 设计决策：审核态变更**刻意不写入 `events`**。events 是用户行为时间序列
   * （画像、活跃度、行为分析都从它聚合），管理员的上架/驳回属于管理动作，
   * 混进去会污染用户侧统计。可追溯性由 `audit_logs`（action='plugin.review'）
   * 承担——`GET /api/me/activity` 读的也是它，用户能看到与自己相关的审核记录。
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

  app.post("/api/plugins/:slug/review", { config: { scope: "admin" } }, reviewHandler);
  app.patch("/api/plugins/:slug/review", { config: { scope: "admin" } }, reviewHandler);

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
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
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
          // 一次 IN 查询取回整批站点，避免逐条 getSite 的 N+1
          const siteMap = await ctx.repo.getSitesByIds(result.applied.createdSiteIds);
          const sites = result.applied.createdSiteIds
            .map((id) => siteMap.get(id))
            .filter((s): s is NonNullable<typeof s> => !!s)
            .map((s) => ({ id: s.id, title: s.title, description: s.description ?? null, url: s.url }));
          await indexSitesBatch(ctx, sites);
        }
        // 服务端漏斗：重复安装/升级不计入“新安装”，避免转化率虚高
        if (!result.alreadyInstalled) {
          void ctx.repo.recordEvent("plugin_install_success", {
            identity,
            meta: { slug, kind: plugin.kind, version: plugin.version },
          }).catch((err) => console.error("[plugins] install event failed:", err));
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
    // 卸载会按 identity 找安装记录，并默认把该用户「由插件带入」的站点**软删除**
    // （removeSites 缺省为 true）。无票自称他人身份 =  anyone 可以清空他人的库。
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    const identity = extractPluginIdentity(req);
    if (!identity) {
      return badRequest(reply, "缺少用户身份标识 (anonId/userId/identity)");
    }

    const q = (req.query ?? {}) as Record<string, string>;
    const body = (req.body ?? {}) as { removeSites?: boolean };
    const removeSites = q.removeSites !== undefined ? q.removeSites === "true" : body.removeSites !== undefined ? Boolean(body.removeSites) : true;

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
      if (result.removed) {
        void ctx.repo.recordEvent("plugin_uninstall", {
          identity,
          meta: { slug, version: result.plugin.version },
        }).catch((err) => console.error("[plugins] uninstall event failed:", err));
      }
      return {
        success: true,
        ...result,
        sitesRemoved: result.removedSites,
        categoriesRemoved: result.removedCategories,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return badRequest(reply, message);
    }
  };

  app.delete(
    "/api/plugins/:slug/install",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } },
    uninstallHandler,
  );
  app.post(
    "/api/plugins/:slug/uninstall",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } },
    uninstallHandler,
  );

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
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
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
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
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
        return badRequest(reply, "请填写举报理由（不可为空）");
      }
      if (reason.length > 500) {
        return badRequest(reply, "举报理由长度不能超过 500 字");
      }

      const identity = pluginIdentity(ctx, req) || undefined;
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

  /* ------------------------------------------------------------------ *
   * 分享短链 (Short Links)
   * ------------------------------------------------------------------ */

  /**
   * 创建插件分享短链：只允许 /marketplace/ 内部目标，防开放重定向。
   * 前端用返回的 path 拼 origin 生成可复制链接。
   */
  app.post(
    "/api/shortlinks",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { slug?: unknown; target?: unknown; install?: unknown };
      const slug = typeof body.slug === "string" ? body.slug.trim() : "";
      let target = typeof body.target === "string" ? body.target.trim() : "";
      if (slug) {
        const plugin = await ctx.repo.getPluginBySlug(slug);
        if (!plugin || plugin.status !== "published") return notFound(reply, `插件未上架或不存在: ${slug}`);
        // 分享深链保留 ?install=1：接收方落地即弹安装确认（与长链兜底一致）
        target = `/marketplace/${encodeURIComponent(plugin.slug)}${body.install === true ? "?install=1" : ""}`;
      }
      if (!isInternalShortLinkTarget(target)) {
        return badRequest(reply, "短链目标必须是站内 /marketplace/ 路径");
      }
      try {
        const link = await ctx.repo.createShortLink({ target, pluginSlug: slug || null });
        return { success: true, code: link.code, path: `/s/${link.code}`, target: link.target };
      } catch (err) {
        return badRequest(reply, err instanceof Error ? err.message : "创建短链失败");
      }
    }
  );

  /** 解析短链并累计点击（Next /s/[code] 与外部调用共用） */
  app.get(
    "/api/shortlinks/:code",
    { config: { scope: "public", cache: { maxAge: 0 } } },
    async (req, reply) => {
      const code = (req.params as { code: string }).code;
      const link = await ctx.repo.resolveShortLink(code);
      if (!link) return notFound(reply, "短链不存在或已失效");
      return { code: link.code, target: link.target, clicks: link.clicks };
    }
  );

  /* ------------------------------ 开放生态 2.0: Taps 远程订阅源 ------------------------------ */

  /**
   * 获取已配置的远程插件市场订阅源 (Taps)。
   *
   * 原先是 `public`，与同一组里的 POST / DELETE / sync（全部 `write`）不一致：
   * 匿名访客能读出管理员配置的第三方源 URL 清单。Taps 只服务于「订阅源管理中心」
   * 这一个管理面弹窗——市场列表本身读的是已导入的插件，不会实时拉取订阅清单——
   * 而这些 URL 常带访问凭据（GitHub raw 的 `?token=` 一类），属于不该外发的配置。
   */
  app.get(
    "/api/plugins/taps",
    { config: { scope: "admin" } },
    async () => {
      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      return { ok: true, items: taps };
    }
  );

  /** 添加远程插件市场订阅源 (Taps) */
  app.post(
    "/api/plugins/taps",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const body = z.object({
        name: z.string().min(1).max(50),
        url: httpUrl().max(500),
        description: z.string().max(200).optional(),
      }).safeParse(req.body ?? {});

      if (!body.success) {
        return badRequest(reply, "参数无效", body.error.issues);
      }

      // 安全校验：防止 SSRF（协议、凭据、高危内网端口、IPv4/IPv6 映射及 nip.io 泛解析私网域名）
      const cleanUrl = body.data.url.trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(cleanUrl);
        assertUrlShape(cleanUrl);
      } catch (err) {
        return badRequest(reply, err instanceof Error ? err.message : "Taps 源地址格式不合法");
      }
      const rawHost = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const safeCheck = isSafeUrl(cleanUrl, false);
      if (
        !safeCheck.safe ||
        (isIP(rawHost) !== 0 && isBlockedIp(rawHost)) ||
        rawHost.includes("::")
      ) {
        return badRequest(reply, "禁止添加私有网络地址或本地回环作为 Taps 插件源");
      }

      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      if (taps.some((t) => t.url.toLowerCase() === cleanUrl.toLowerCase())) {
        return conflict(reply, "已存在相同 URL 的 Taps 订阅源");
      }

      const newTap = {
        id: `tap-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
        name: body.data.name.trim(),
        url: cleanUrl,
        description: body.data.description?.trim(),
        enabled: true,
        pluginCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      taps.push(newTap);
      await ctx.repo.setSystemState("plugins:taps", taps);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "plugin.tap_create",
        target: newTap.id,
        diff: newTap,
      });

      return { ok: true, tap: newTap };
    }
  );

  /** 移除远程插件订阅源 */
  app.delete(
    "/api/plugins/taps/:id",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      const filtered = taps.filter((t) => t.id !== id);
      if (filtered.length === taps.length) {
        return notFound(reply, "订阅源不存在");
      }
      await ctx.repo.setSystemState("plugins:taps", filtered);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "plugin.tap_delete",
        target: id,
      });
      return { ok: true };
    }
  );

  /** 同步远程插件订阅源并更新本地索引 */
  app.post(
    "/api/plugins/taps/:id/sync",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const taps = (await ctx.repo.getSystemState<any[]>("plugins:taps")) ?? [];
      const targetTap = taps.find((t) => t.id === id);
      if (!targetTap) {
        return notFound(reply, "订阅源不存在");
      }

      let fetchedCount = 0;
      let processedCount = 0;
      let importedCount = 0;
      let skippedDuplicate = 0;
      let rejectedInvalid = 0;
      let failedWrite = 0;
      let truncated = false;
      try {
        const res = await guardedFetch(targetTap.url, { timeoutMs: 8000 });
        if (res.status !== 200) {
          return badRequest(reply, `订阅源响应异常 (HTTP ${res.status})`);
        }
        const data = JSON.parse(res.body);
        const pluginList: unknown[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.plugins)
          ? data.plugins
          : [];

        fetchedCount = pluginList.length;
        // 远端清单长度是外部输入，而下面每条都要写库 + 向量化：不设上限时
        // 一个「10 万条」的订阅源会把这一个请求变成几小时的后台任务。
        const items = pluginList.slice(0, MAX_TAP_IMPORT_ITEMS);
        truncated = pluginList.length > items.length;
        processedCount = items.length;

        // 已存在的插件名一次取全，代替"每条跑一次 LIKE + limit 5、再要求精确同名"：
        // 前者是 N 次无法走索引的全表 LIKE；后者还会因为同名插件被 5 条上限挤出
        // 结果窗口而重复导入（common-name 订阅源下市场里出现成对同名插件）。
        const existingNames = new Set<string>(
          (await ctx.repo.raw("SELECT name FROM plugins")).map((r) => String(r.name)),
        );

        const pendingIndex: IndexPluginItem[] = [];
        for (const item of items) {
          const validated = validatePluginManifestWithCatalog(item);
          // 每一条被跳过的原因都要计数：以前 `continue` 什么都不留，
          // 管理员只看到「发现 40 个、导入 3 个」，无从判断剩下 37 个是重复、不合规还是写库失败。
          if (!validated.ok) {
            rejectedInvalid += 1;
            continue;
          }
          if (existingNames.has(validated.manifest.name)) {
            skippedDuplicate += 1;
            continue;
          }

          try {
            const imported = await ctx.repo.createPlugin({
              manifest: validated.manifest,
              author: validated.manifest.author || targetTap.name,
              authorKind: "tap",
              source: "tap",
              status: "published",
            });
            // 同一份清单里的重名也要挡住（原来靠每次都查库才碰巧挡住）
            existingNames.add(validated.manifest.name);
            pendingIndex.push(indexItemFromManifest(imported.slug, imported.manifest));
            importedCount++;
          } catch {
            // 单条导入失败不阻断整批，但条数必须报出来
            failedWrite += 1;
          }
        }
        // 向量化批量做（内部已经吞掉模型不可用的错误，索引可由 reindex 任务重建）
        await indexPluginsBatch(ctx, pendingIndex);
      } catch (err) {
        return badRequest(reply, `获取订阅源失败: ${err instanceof Error ? err.message : String(err)}`);
      }

      targetTap.lastSyncedAt = Date.now();
      // 徽标上写的是「N 个插件」，那 N 就必须是本源在市场里真的可见的条数。
      // 用 fetchedCount 等于把「不合规清单 + 重名 + 写库失败」也算成已上架。
      targetTap.pluginCount = importedCount + skippedDuplicate;
      targetTap.updatedAt = Date.now();
      await ctx.repo.setSystemState("plugins:taps", taps);

      return {
        ok: true,
        fetchedCount,
        /** 实际进入处理流程的条数（= min(fetchedCount, importCap)） */
        processedCount,
        importedCount,
        /** 市场里已有同名插件，本源这次没新增 */
        skippedDuplicate,
        /** 清单校验不通过（缺字段 / 不在目录 / 名称非法） */
        rejectedInvalid,
        /** 校验通过但写库失败 */
        failedWrite,
        // 清单被处理上限截断时必须说出来：否则调用方看到 importedCount 远小于
        // fetchedCount 会以为订阅源里都是重复项。
        truncated,
        importCap: MAX_TAP_IMPORT_ITEMS,
        tap: targetTap,
      };
    }
  );

  /* ------------------------------ 开放生态 2.0: 插件安全沙盒扫描 ------------------------------ */

  /** 插件全自动安全扫描评估与作者认证 */
  app.get(
    "/api/plugins/:slug/audit",
    { config: { scope: "public" } },
    async (req, reply) => {
      const slug = (req.params as { slug: string }).slug;
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, "插件不存在");

      const manifest = plugin.manifest as PluginManifest;
      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];
      let deductions = 0;

      // 1. 作者认证检查
      const author = (manifest.author || "").toLowerCase();
      const isVerifiedAuthor =
        author.includes("official") ||
        author.includes("navhub") ||
        author.includes("verified") ||
        plugin.authorKind === "token";
      checks.push({
        name: "开发者认证 (Author Authenticity)",
        passed: isVerifiedAuthor,
        detail: isVerifiedAuthor ? "官方已认证或已授权凭据作者" : "社区自建未签名作者（建议仔细甄别）",
      });
      if (!isVerifiedAuthor) deductions += 10;

      // 2. URL 协议安全性扫描（覆盖全部 4 类插件的外部 URL 字段）
      const urls: string[] = [];
      if (manifest.icon) urls.push(manifest.icon);
      if (manifest.homepage) urls.push(manifest.homepage);
      const payloadAny = (manifest.payload ?? {}) as Record<string, any>;
      if (manifest.kind === "site-pack" && Array.isArray(payloadAny.sites)) {
        for (const s of payloadAny.sites) {
          if (s?.url) urls.push(String(s.url));
          if (s?.icon) urls.push(String(s.icon));
        }
      } else if (manifest.kind === "theme") {
        if (payloadAny.previewUrl) urls.push(String(payloadAny.previewUrl));
        if (payloadAny.backgroundImage) urls.push(String(payloadAny.backgroundImage));
      } else if (manifest.kind === "search-pack") {
        if (payloadAny.endpoint) urls.push(String(payloadAny.endpoint));
      }

      let allHttps = true;
      let dangerousScheme = false;
      let internalHost = false;

      for (const u of urls) {
        const lower = u.trim().toLowerCase();
        if (
          lower.startsWith("javascript:") ||
          lower.startsWith("vbscript:") ||
          lower.startsWith("data:") ||
          lower.startsWith("file:")
        ) {
          dangerousScheme = true;
        }
        if (lower.startsWith("http://")) {
          allHttps = false;
        }
        try {
          const parsed = new URL(u);
          const rawHost = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
          const safeCheck = isSafeUrl(u, false);
          if (!safeCheck.safe || (isIP(rawHost) !== 0 && isBlockedIp(rawHost))) {
            internalHost = true;
          }
        } catch {
          // not a valid URL format
        }
      }

      checks.push({
        name: "协议加密性 (HTTPS Enforcement)",
        passed: allHttps,
        detail: allHttps ? "所有外链与资源图标均强制采用 HTTPS 加密传输" : "检测到包含明文 HTTP 未加密外链",
      });
      if (!allHttps) deductions += 15;

      checks.push({
        name: "代码注入与 XSS 防护 (Script Injection Guard)",
        passed: !dangerousScheme,
        detail: !dangerousScheme ? "未检出危险伪协议 (javascript:, data: 等)" : "严重威胁：检测到恶意伪协议注入",
      });
      if (dangerousScheme) deductions += 50;

      checks.push({
        name: "内网穿透防护 (Anti-SSRF Guard)",
        passed: !internalHost,
        detail: !internalHost ? "所有链接均指向公网合法域名，无内网渗透特征" : "严重威胁：检测到包含私有内网或回环地址",
      });
      if (internalHost) deductions += 50;

      let parsedNote: any = null;
      if (plugin.reviewNote) {
        try {
          parsedNote = JSON.parse(plugin.reviewNote);
        } catch {
          // not json
        }
      }

      /**
       * 有没有真正的审理报告，决定这份数据能说什么、不能说什么。
       *
       * 上面这四项是**确实跑过**的静态检查，扣分本身是真的；假的地方在于
       * 「100 - 扣分」会被前端当成完整安全分并亮出「安全」徽章，好像合规、
       * 相关性、外链存活也都测过一样（它们没跑）。所以无报告时：
       *  - 只给 security 一维，其余显式 null（不是 0，0 是「测了且不及格」）；
       *  - level 不允许出现 safe，最高只能到 low_risk；
       *  - decision 固定 pending_review，不再用 status 反推「approve」。
       */
      const hasAuditNote = parsedNote !== null && typeof parsedNote.score === "number";

      if (!hasAuditNote) {
        const staticScore = Math.max(0, 100 - deductions);
        return {
          ok: true,
          report: {
            slug,
            score: staticScore,
            level: staticScore >= 85 ? "low_risk" : staticScore >= 60 ? "medium_risk" : "high_risk",
            decision: "pending_review",
            aiRationale: `本次仅完成 ${checks.length} 项静态清单检查（作者签名、协议、伪协议注入、内网穿透），未做模型合规研判与外链探活，结论待人工或 AI 复核。`,
            dimensionScores: { security: staticScore, availability: null, compliance: null, relevance: null },
            linkSurvivalRate: null,
            model: "none",
            llmReviewed: false,
            reviewSkipped: "not_audited",
            scoreBasis: "static_only",
            verifiedAuthor: isVerifiedAuthor,
            checks: checks.map((c) => ({ ...c, skipped: false })),
            auditedAt: plugin.reviewedAt || plugin.updatedAt || Date.now(),
          },
        };
      }

      return {
        ok: true,
        report: {
          slug,
          score: parsedNote.score,
          level: parsedNote.level,
          decision: parsedNote.decision ?? "pending_review",
          aiRationale: parsedNote.rationale,
          dimensionScores: parsedNote.dimensionScores,
          linkSurvivalRate: parsedNote.linkSurvivalRate,
          model: parsedNote.model,
          llmReviewed: parsedNote.llmReviewed === true,
          // 旧报告里没有这几个字段，缺省按「不确定 = 保守」解释：说没审理，而不是谎称审过
          reviewSkipped: parsedNote.reviewSkipped ?? (parsedNote.llmReviewed === true ? null : "error"),
          // scoreBasis 同理：没有标注时不能冒充「全维度已测」
          scoreBasis: parsedNote.scoreBasis ?? "static_plus_probe",
          quota: parsedNote.quota ?? null,
          verifiedAuthor: isVerifiedAuthor,
          checks: checks.map((c) => ({ ...c, skipped: false })),
          auditedAt: parsedNote.auditedAt || plugin.reviewedAt || Date.now(),
        },
      };
    }
  );
};
