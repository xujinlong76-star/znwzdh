/**
 * 插件市场路由 · 分段 4/5：上架与互动（更新 / 审核 / 安装 / 星标 / 举报）
 *
 * 自 routes/plugins.ts 按**原声明顺序**切出（连续区间），未做主题重排——
 * 路由顺序会影响路由表，保序切分让「改造前后 app.printRoutes() 逐字节一致」成立。
 * 本文件由 plugins.ts 的 pluginRoutes 直接调用（不经 register：register 会把路由
 * 延后到父级 ready 之后，改变注册顺序）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { indexSitesBatch } from "../../index-site.ts";
import { indexPluginsBatch, indexItemFromManifest, removePluginIndex } from "../../index-plugin.ts";
import { guardedFetch } from "@navhub/ai";
import {
  executeAutoAuditAndPublish,
  } from "../../ai-plugin-auditor.ts";
import { randomUUID } from "node:crypto";
import { ADMIN_NOTIFICATION_IDENTITY } from "../../notifications.ts";
import {
  validatePluginManifestWithCatalog,
  summarizePluginManifest,
  } from "@navhub/core";
import { safeDecodeParam,
  badRequest,
  conflict,
  forbidden,
  requestIdentityOf,
  identityTrusted,
  notFound,
  unauthorized,
} from "../shared.ts";
import {
  extractPluginIdentity,
  publicPlugin,
  } from "../plugin-presentation.ts";
import type { AppContext } from "../../context.ts";

export const pluginRoutesPart4: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

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
        url?: string;
      } & Record<string, unknown>;

      let manifestInput = body.manifest ?? body;
      if (typeof body.url === "string" && body.url.trim()) {
        let fetchUrl = body.url.trim();
        if (fetchUrl.includes("github.com/") && fetchUrl.includes("/blob/")) {
          fetchUrl = fetchUrl.replace("github.com/", "raw.githubusercontent.com/").replace("/blob/", "/");
        }
        const res = await guardedFetch(fetchUrl, { timeoutMs: 8000 });
        if (res.status < 200 || res.status >= 300) {
          return badRequest(reply, `从远程 URL 读取插件失败: HTTP ${res.status}`);
        }
        try {
          manifestInput = JSON.parse(res.body);
        } catch {
          return badRequest(reply, "远程 URL 返回的内容不是合法的 JSON 清单");
        }
      }
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
      const actorName = callerAuth?.actor || requestIdentityOf(req as never) || "admin";
      const actorKind = callerAuth?.kind || "token";

      try {
        const imported = await ctx.repo.createPlugin(
          {
            manifest: validated.manifest,
            author: validated.manifest.author || actorName,
            authorKind: actorKind,
            ownerIdentity: requestIdentityOf(req as never) || "admin",
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
          const identity = requestIdentityOf(req as never) || "admin";
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
      const slug = safeDecodeParam((req.params as { slug: string }).slug);
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
   * 审核插件：approve（上架）、reject（驳回）、delist（下架）、quarantine（隔离）
   * 重复 approve 返回 409
   *
   * R4-4（2026-11-16）：举报取消静默自动下架后，隔离只能由管理员人工决定。
   * 仓库层 quarantinePlugin 早已存在，但此前没有任何路由或管理入口调用它，
   * quarantined 状态实际不可达（「已隔离」标签与「审核解封并上架」按钮是死入口）。
   * 本路由把 quarantine 接到现有的审核通道上：published → quarantined，写
   * plugin.quarantine 审计、通知作者、摘掉语义索引，与 delist 同口径。
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
        action: z.enum(["approve", "reject", "delist", "quarantine"]),
        note: z.string().max(500).nullable().optional(),
      })
      .safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "请指定合法的审核操作（approve / reject / delist / quarantine）");
    }

    const callerAuth = req.auth;
    const transitionId = randomUUID();
    try {
      const result = await ctx.repo.withTransaction(async () => {
        await ctx.repo.raw(
          "SELECT id FROM plugins WHERE slug = ?" + ctx.repo.rowLockClause,
          [slug],
        );
        const existing = await ctx.repo.getPluginBySlug(slug);
        if (!existing) return { status: "missing" as const };
        if (body.data.action === "approve" && existing.status === "published" && !existing.pendingVersion) {
          return { status: "duplicate" as const };
        }
        if (body.data.action === "quarantine" && existing.status !== "published") {
          return {
            status: "invalid" as const,
            message: `插件当前状态为 ${existing.status}，只有已上架插件可以隔离`,
          };
        }
        // quarantine 走仓库层 quarantinePlugin（与 reviewPlugin 分开：隔离是人工
        // 处置，不经过 approve/reject/delist 的状态机分支）。
        const reviewed = body.data.action === "quarantine"
          ? await ctx.repo.quarantinePlugin(slug, body.data.note ?? "管理员人工隔离", {
              actor: callerAuth?.actor || "admin",
              actorKind: callerAuth?.kind || "admin",
              ip: req.ip,
            })
          : await ctx.repo.reviewPlugin(slug, body.data.action, body.data.note ?? null, {
              actor: callerAuth?.actor || "admin",
              actorKind: callerAuth?.kind || "admin",
              ip: req.ip,
            });
        // Shadow release 审核可保持 published；待审版本的消费同样是一次转换。
        const changed = existing.status !== reviewed.status || existing.version !== reviewed.version ||
          existing.pendingVersion !== reviewed.pendingVersion;
        const owner = existing.ownerIdentity ? await ctx.repo.resolveIdentity(existing.ownerIdentity) : null;
        if (changed && owner && owner !== ADMIN_NOTIFICATION_IDENTITY) {
          const kind = { approve: "plugin_approved", reject: "plugin_rejected", delist: "plugin_delisted", quarantine: "plugin_quarantined" }[body.data.action];
          const title = { approve: "插件审核已通过", reject: "插件审核未通过", delist: "插件已下架", quarantine: "插件已被隔离" }[body.data.action];
          // C-4：通知体写成人话（不再是 {"pluginId":…} 原始 JSON），并带插件链接——
          // 已上架链公开详情页，非已上架链作者预览页（/marketplace/<slug>/preview，
          // 绝不链向公开 404）。审核备注是管理员写给作者的理由，驳回/下架/隔离时一并带上。
          const reviewedVersion = existing.pendingVersion ?? existing.version;
          const note = typeof body.data.note === "string" && body.data.note.trim() ? body.data.note.trim() : null;
          const pluginName = reviewed.name || reviewed.slug;
          const bodyText =
            body.data.action === "approve"
              ? `「${pluginName}」v${reviewedVersion} 已通过审核并上架，现在可以在市场中找到了。`
              : body.data.action === "reject"
                ? `「${pluginName}」v${reviewedVersion} 未通过审核${note ? `，原因：${note}` : ""}。修改后可以重新提交。`
                : body.data.action === "quarantine"
                  ? `「${pluginName}」v${reviewedVersion} 已被管理员隔离${note ? `，原因：${note}` : ""}。处理完成后会重新上架。`
                  : `「${pluginName}」v${reviewedVersion} 已被管理员下架${note ? `，原因：${note}` : ""}。`;
          const link =
            body.data.action === "approve"
              ? `/marketplace/${encodeURIComponent(reviewed.slug)}`
              : `/marketplace/${encodeURIComponent(reviewed.slug)}/preview`;
          await ctx.repo.emitNotification({
            identity: owner,
            idempotencyKey: `plugin:${reviewed.id}:review:${existing.pendingVersion ?? existing.version}:${transitionId}`,
            kind,
            title,
            body: bodyText,
            link,
          });
        }
        return { status: "reviewed" as const, plugin: reviewed };
      });
      if (result.status === "missing") return notFound(reply, `插件不存在: ${slug}`);
      if (result.status === "duplicate") return conflict(reply, "该插件已处于上架状态，请勿重复通过");
      if (result.status === "invalid") return badRequest(reply, result.message);
      const reviewed = result.plugin;
      // 上架 -> 建/重建语义索引；驳回/下架/隔离 -> 摘掉向量（检索仍以 published 为准）
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

            const q = (req.query ?? {}) as Record<string, string | undefined>;
      const body = (req.body ?? {}) as { version?: string; selectedSites?: string[] };
      const targetVersion = q.version?.trim() || (typeof body.version === "string" ? body.version.trim() : undefined);
      const selectedSites = Array.isArray(body.selectedSites) ? body.selectedSites.map(String) : undefined;

      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      try {
        const result = await ctx.repo.installPlugin(
          slug,
          identity,
          {
            actor: callerAuth?.actor || identity,
            actorKind: callerAuth?.kind || "identity",
            ip: req.ip,
          },
          {
            version: targetVersion,
            selectedSites,
          },
        );
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
   * 真实回滚到历史版本（B-1）
   * 时间轴「回滚此版本」不再只调 install(version)——那条路只新增不删除、
   * 还把版本号写成旧版。rollback 先移除新版独有站点再按目标清单安装，
   * 安装记录版本与实际内容一致；目标版本必须低于已安装版本。
   */
  app.post(
    "/api/plugins/:slug/rollback",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer <redacted>");
      const identity = extractPluginIdentity(req);
      if (!identity) {
        return badRequest(reply, "缺少用户身份标识 (anonId/userId/identity)");
      }
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);
      if (plugin.status !== "published") {
        return conflict(reply, `插件当前处于 ${plugin.status} 状态，未上架插件不可回滚`);
      }
      const q = (req.query ?? {}) as Record<string, string | undefined>;
      const body = (req.body ?? {}) as { version?: string };
      const targetVersion = q.version?.trim() || (typeof body.version === "string" ? body.version.trim() : undefined);
      if (!targetVersion) {
        return badRequest(reply, "缺少回滚目标版本 (version)");
      }
      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      try {
        const result = await ctx.repo.rollbackPlugin(
          slug,
          identity,
          targetVersion,
          {
            actor: callerAuth?.actor || identity,
            actorKind: callerAuth?.kind || "identity",
            ip: req.ip,
          },
        );
        // 回滚补回的站点进检索向量索引（失败不影响回滚结果）
        if (result.applied.createdSiteIds.length > 0) {
          const siteMap = await ctx.repo.getSitesByIds(result.applied.createdSiteIds);
          const sites = result.applied.createdSiteIds
            .map((id) => siteMap.get(id))
            .filter((s): s is NonNullable<typeof s> => !!s)
            .map((s) => ({ id: s.id, title: s.title, description: s.description ?? null, url: s.url }));
          await indexSitesBatch(ctx, sites);
        }
        void ctx.repo.recordEvent("plugin_rollback", {
          identity,
          meta: { slug, from: result.rolledBackFrom, to: result.rolledBackTo, sitesRemoved: result.sitesRemoved },
        }).catch((err) => console.error("[plugins] rollback event failed:", err));
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

};
