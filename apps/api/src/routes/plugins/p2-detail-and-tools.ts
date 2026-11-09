/**
 * 插件市场路由 · 分段 2/5：插件详情与工具（详情 / 徽标 / 相似 / 对比 / 校验）
 *
 * 自 routes/plugins.ts 按**原声明顺序**切出（连续区间），未做主题重排——
 * 路由顺序会影响路由表，保序切分让「改造前后 app.printRoutes() 逐字节一致」成立。
 * 本文件由 plugins.ts 的 pluginRoutes 直接调用（不经 register：register 会把路由
 * 延后到父级 ready 之后，改变注册顺序）。
 */
import type { FastifyPluginAsync } from "fastify";
import { similarPlugins } from "../../plugins-search.ts";
import { guardedFetch } from "@navhub/ai";
import {
  validateAndCleanPluginManifest,
  validatePluginManifestWithCatalog,
  summarizePluginManifest,
  diffPluginManifests,
  comparePluginVersions,
  type PluginManifest,
} from "@navhub/core";
import { safeDecodeParam,
  badRequest,
  requestIdentityOf,
  isAdminScope,
  identityTrusted,
  notFound,
  unauthorized,
} from "../shared.ts";
import {
  pluginIdentity,
  publicPlugin,
  renderBadgeSvg,
} from "../plugin-presentation.ts";
import type { AppContext } from "../../context.ts";

export const pluginRoutesPart2: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;


  /**
   * 获取当前用户已安装的插件清单
   */
  app.get(
    "/api/plugins/installed",
    { config: { scope: "public" } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const identity = requestIdentityOf(req as never);
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

      /**
       * 分批并发（每批 5 个）。
       *
       * 原实现一次 Promise.all 放 30 个出网请求：路由限流 30 次/分钟，
       * 单 IP 每分钟就能打出约 900 个连接，既可做反射探测，也会挤占
       * 健康巡检与富化的连接池。批内并发保留「一批走完再下一批」的
       * 背压，总耗时上限仍在 30/5 × 3.5s 的可接受区间。
       */
      const FETCH_CONCURRENCY = 5;
      const results: Awaited<(typeof tasks)[number]>[] = [];
      for (let i = 0; i < tasks.length; i += FETCH_CONCURRENCY) {
        results.push(...(await Promise.all(tasks.slice(i, i + FETCH_CONCURRENCY))));
      }
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
      const slug = safeDecodeParam(rawSlug);
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
      const slug = safeDecodeParam(rawSlug);
      const q = req.query as Record<string, string | undefined>;
      const metric = q.metric?.toLowerCase().trim() || "version";
      const customLabel = q.label?.trim() || "山羊胡";

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
      const slug = safeDecodeParam(rawSlug);
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
};
