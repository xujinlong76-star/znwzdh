/**
 * 插件市场路由 · 分段 3/5：版本与评价（版本历史 / 评价 / 举报 / 新增与导入）
 *
 * 自 routes/plugins.ts 按**原声明顺序**切出（连续区间），未做主题重排——
 * 路由顺序会影响路由表，保序切分让「改造前后 app.printRoutes() 逐字节一致」成立。
 * 本文件由 plugins.ts 的 pluginRoutes 直接调用（不经 register：register 会把路由
 * 延后到父级 ready 之后，改变注册顺序）。
 */
import type { FastifyPluginAsync } from "fastify";
import {
  executeAutoAuditAndPublish,
  evaluatePluginAudit,
  autoRemediatePluginManifest,
} from "../../ai-plugin-auditor.ts";
import { ADMIN_NOTIFICATION_IDENTITY } from "../../notifications.ts";
import { normalizePluginReviewSort } from "@navhub/store";
import {
  validatePluginManifestWithCatalog,
  summarizePluginManifest,
  diffPluginManifests,
  } from "@navhub/core";
import { safeDecodeParam,
  badRequest,
  conflict,
  forbidden,
  requestIdentityOf,
  isAdminScope,
  identityTrusted,
  markCursorPaginationDeprecated,
  notFound,
  unauthorized,
} from "../shared.ts";
import {
  extractPluginIdentity,
  pluginIdentity,
  publicPlugin,
  } from "../plugin-presentation.ts";
import type { AppContext } from "../../context.ts";

export const pluginRoutesPart3: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

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

      // 状态门禁（A-1）：非 published 仅作者/管理员可见，普通访客直接 404；
      // 与详情页（p2-detail-and-tools.ts）同一口径。
      const identity = pluginIdentity(ctx, req);
      const isOwner = Boolean(identity && plugin.ownerIdentity && identity === plugin.ownerIdentity);
      if (plugin.status !== "published") {
        const isAdmin = isAdminScope(ctx, req as never);
        if (!isAdmin && !isOwner) {
          return notFound(reply, `插件未上架或不存在: ${slug}`);
        }
      }

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

      // 状态门禁（A-1）：非 published 仅作者/管理员可见，普通访客直接 404；
      // 与详情页（p2-detail-and-tools.ts）同一口径。
      const identity = pluginIdentity(ctx, req);
      const isOwner = Boolean(identity && plugin.ownerIdentity && identity === plugin.ownerIdentity);
      if (plugin.status !== "published") {
        const isAdmin = isAdminScope(ctx, req as never);
        if (!isAdmin && !isOwner) {
          return notFound(reply, `插件未上架或不存在: ${slug}`);
        }
      }

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

      // 状态门禁（A-1）：非 published 仅作者/管理员可见，普通访客直接 404；
      // 与详情页（p2-detail-and-tools.ts）同一口径。
      const identity = pluginIdentity(ctx, req);
      const isOwner = Boolean(identity && plugin.ownerIdentity && identity === plugin.ownerIdentity);
      if (plugin.status !== "published") {
        const isAdmin = isAdminScope(ctx, req as never);
        if (!isAdmin && !isOwner) {
          return notFound(reply, `插件未上架或不存在: ${slug}`);
        }
      }

      const limit = q.limit ? Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20)) : 20;
      const offset = q.offset ? Math.max(0, parseInt(q.offset, 10) || 0) : 0;
      // 排序（P2-3）：helpful/newest/highest/lowest；非法值回落 newest（与 limit/offset 的
      // 宽容解析同口径，不 400）。非 newest 排序走 offset 翻页，游标不适用（见存储层）。
      const sort = normalizePluginReviewSort(q.sort);
      // Keyset 游标（M12）：`?cursor=` 走 WHERE (updated_at,id) 谓词，不再 OFFSET；
      // nextCursor 随页返回，无下一页时为 null。无效游标由全局错误处理器映射成
      // 400 INVALID_CURSOR。
      // @deprecated 游标分页已废弃（仍可用）：请用 limit/offset 翻页。
      const cursor = typeof q.cursor === "string" && q.cursor ? q.cursor : undefined;
      if (cursor) markCursorPaginationDeprecated(reply);
      // myReview 属私有视图：统一走身份闸门 + identityOf 口径（64 字符），
      // 不再单独放宽到 120——写入侧（安装/星标/评价）一直按 identityOf 取值，
      // 这里读更长的串只会查不到自己的评价，或与签名校验的取值错位。
      // （identity 已在上方状态门禁处取过，此处复用，不重复声明。）
      // 批 B：myReview 按 canonical 身份读（isOwner 仍用原始 identity 比较）。
      const who = identity ? await ctx.repo.resolveIdentity(identity) : null;
      const [reviewsResult, stats, myReview] = await Promise.all([
        ctx.repo.listPluginReviews(plugin.id, { limit, offset, cursor, sort, identity: who ?? undefined }),
        ctx.repo.getPluginReviewStats(plugin.id),
        who ? ctx.repo.getUserPluginReview(plugin.id, who) : null,
      ]);

      return {
        slug: plugin.slug,
        stats,
        myReview,
        items: reviewsResult.items,
        total: reviewsResult.total,
        limit,
        offset,
        sort,
        nextCursor: reviewsResult.nextCursor,
      };
    }
  );

  /**
   * 提交或更新插件评价（新评价仅限活跃安装用户；修改自己已有的评价不限安装状态，B-3）
   */
  app.post(
    "/api/plugins/:slug/reviews",
    {
      config: {
        scope: "public",
        rateLimit: {
          max: 15,
          timeWindow: "1 hour",
          // 按调用方身份分桶（E2E 2/2 的 429 根因）：默认 key 是 req.ip，
          // E2E 分片与生产 NAT 下全部请求同 IP，共用 15 次/小时的桶；
          // requestIdentityOf 在 onRequest 阶段可读头（X-Navhub-Anon-Id /
          // x-navhub-user-id）、?anonId= 查询与令牌 owner，body 读不到时
          // 回退 req.ip（与改造前同口径，不放宽也不收紧）。
          keyGenerator: (req) => requestIdentityOf(req as never) ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const body = (req.body ?? {}) as { rating?: unknown; title?: unknown; content?: unknown; identity?: unknown };
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      // 取值口径必须与签名 hook 同源（identityOf：Header → Query → Body，截 64）。
      // 旧的 `body.identity` 优先正是 `identity-plugin-impersonation.test.ts` 记过的那类
      // 破口：签自己的头 + body 塞受害者身份，校验通过却以受害者身份落评价，
      // 而评价还要求「活跃安装」，等于顺手把受害者的安装记录也用了。
      const identity = String(requestIdentityOf(req as never) ?? callerAuth?.actor ?? "").trim();

      if (!identity) {
        return badRequest(reply, "缺少用户身份标识");
      }

      // 写面门禁（A-1b）：与读面门禁同口径，非 published 视作不存在，404 优先于 403。
      // 放在评分校验之前：资源未上架时不再继续校验请求体。存储层 createPluginReview
      // 里有同一道门禁作纵深（覆盖 /api/me/import 的评价重放等非路由写入口）。
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);
      if (plugin.status !== "published") {
        return notFound(reply, `插件未上架或不存在: ${slug}`);
      }

      const rating = Number(body.rating);
      if (isNaN(rating) || rating < 1 || rating > 5) {
        return badRequest(reply, "评分必须为 1 到 5 之间的整数");
      }

      // R4-10：与存储层同口径（标题 ≤200 字、正文 ≤4000 字），超长时明确报错
      // 而不是静默截断。放在 createPluginReview 之前：超长提交直接 400，
      // 评价不落地、不污染“我的评价”。
      const title = typeof body.title === "string" ? body.title.trim() : null;
      const content = typeof body.content === "string" ? body.content.trim() : null;
      if (title !== null && title.length > 200) {
        return badRequest(reply, "评价标题不能超过 200 字");
      }
      if (content !== null && content.length > 4000) {
        return badRequest(reply, "评价正文不能超过 4000 字");
      }

      try {
        // 批 B：评价写入落到 canonical 身份上——合并后旧身份发评价，安装门禁
        // 与评价归属都按 canonical 身份判定，不再 400、也不另起孤儿行。
        const who = await ctx.repo.resolveIdentity(identity);
        const review = await ctx.repo.createPluginReview(
          slug,
          who,
          {
            rating,
            title,
            content,
          },
          {
            actor: who,
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
   * 删除自己的评价（B-3）：本人或管理员可删；硬删除并清理该评价的举报记录。
   * 匿名/他人调用 401/403（deletePluginReview 内按 identity + actorKind 判定）。
   */
  app.delete(
    "/api/plugins/:slug/reviews/:id",
    { config: { scope: "public", rateLimit: { max: 15, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug, id } = req.params as { slug: string; id: string };
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer <redacted>");
      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      const identity = String(requestIdentityOf(req as never) ?? callerAuth?.actor ?? "").trim();
      if (!identity) {
        return badRequest(reply, "缺少用户身份标识");
      }
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);
      try {
        // 批 B：删除按 canonical 身份判定归属——合并后旧身份仍能删自己的评价。
        const who = await ctx.repo.resolveIdentity(identity);
        const result = await ctx.repo.deletePluginReview(
          slug,
          id,
          who,
          {
            actor: callerAuth?.actor || who,
            actorKind: isAdminScope(ctx, req as never) ? "admin" : callerAuth?.kind ?? "identity",
            ip: req.ip,
          },
        );
        return { success: true, ...result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("只能删除自己的评价")) return forbidden(reply, message);
        if (message.startsWith("评价不存在")) return notFound(reply, message);
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
      // 批 B：举报归属按 canonical 身份记——合并后旧身份重复举报仍能去重，
      // 不会在旧 id 下另起一行。
      const who = identity ? await ctx.repo.resolveIdentity(identity) : null;
      try {
        const review = await ctx.repo.reportPluginReview(slug, id, reason, who, {
          actor: who ?? "anonymous",
          actorKind: "identity",
          ip: req.ip,
        });
        // R4-7：重复举报计数不变，返回体带 deduplicated，供前端如实提示
        // “您已举报过该评价”，不再谎称每次都受理。
        return { ok: true, reportCount: review.reportCount, deduplicated: review.deduplicated };
      } catch (err) {
        return notFound(reply, err instanceof Error ? err.message : "评价不存在");
      }
    }
  );

  /**
   * 评价作者官方回复（只有插件作者或系统管理员可回复）
   */
  app.post(
    "/api/plugins/:slug/reviews/:id/reply",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug, id } = req.params as { slug: string; id: string };
      const body = (req.body ?? {}) as { reply?: unknown; identity?: unknown };
      const replyText = typeof body.reply === "string" ? body.reply.trim() : "";
      if (replyText.length < 1 || replyText.length > 1000) {
        return badRequest(reply, "回复内容需在 1 到 1000 字之间");
      }
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);

      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const identity = extractPluginIdentity(req);
      const callerAuth = (req as { auth?: { actor?: string; kind?: string; scopes?: string[] } }).auth;
      const isAdmin = Boolean(callerAuth?.scopes?.includes("admin")) && callerAuth?.kind !== "anonymous";

      if (!identity && !isAdmin) return badRequest(reply, "缺少用户身份标识");
      if (!isAdmin && (!plugin.ownerIdentity || plugin.ownerIdentity !== identity)) {
        return forbidden(reply, "只有插件作者或系统管理员才能回复此评价");
      }

      const actorKind = isAdmin ? "admin" : "identity";
      const actorName = isAdmin ? (callerAuth?.actor || "admin") : (identity || "anonymous");

      try {
        const review = await ctx.repo.replyPluginReview(id, replyText, {
          actor: actorName,
          actorKind,
          ip: req.ip,
        });
        return { success: true, review };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("不存在")) {
          return notFound(reply, message);
        }
        return badRequest(reply, message);
      }
    }
  );

  /**
   * 评价「有用」投票切换（P2-3）：一人一票，再点即撤回；不要求投票人安装过插件，
   * 但不能给自己的评价投票。需要签名身份（与删除/回复同口径，防匿名刷票）。
   */
  app.post(
    "/api/plugins/:slug/reviews/:id/helpful",
    { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug, id } = req.params as { slug: string; id: string };
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const callerAuth = (req as { auth?: { actor?: string; kind?: string } }).auth;
      // 只认签名/令牌解析出的身份：不能回退到 callerAuth.actor——无票调用方
      // 的 actor 是匿名默认 "api"，回退会让匿名票以 api 身份落库（P2-3 复测：
      // 未签名调用应 401，却返回 200）。签名身份与令牌 owner 都走
      // requestIdentityOf（owner 优先，其次签名头），已覆盖合法调用方。
      const identity = String(requestIdentityOf(req as never) ?? "").trim();
      if (!identity) {
        return unauthorized(reply, "需要 Bearer token");
      }
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);
      try {
        // 批 B：投票按 canonical 身份记——合并后旧身份重复投票仍能去重/撤回，
        // 不会在旧 id 下另起一行。
        const who = await ctx.repo.resolveIdentity(identity);
        const result = await ctx.repo.togglePluginReviewHelpful(
          slug,
          id,
          who,
          {
            actor: callerAuth?.actor || who,
            actorKind: callerAuth?.kind ?? "identity",
            ip: req.ip,
          },
        );
        return { ok: true, ...result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("评价不存在")) return notFound(reply, message);
        if (message.startsWith("不能给自己的评价")) return forbidden(reply, message);
        return badRequest(reply, message);
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
      const rawIdentity = extractPluginIdentity(req);
      if (!rawIdentity) {
        return badRequest(reply, "缺少用户身份标识，无法建立作者归属");
      }
      const identity = await ctx.repo.resolveIdentity(rawIdentity);
      if (rawIdentity === ADMIN_NOTIFICATION_IDENTITY || identity === ADMIN_NOTIFICATION_IDENTITY) {
        return forbidden(reply, "保留身份不能发布插件");
      }
      const actorName = callerAuth?.actor || identity;
      const actorKind = callerAuth?.kind || "user";

      try {
        const createdPlugin = await ctx.repo.withTransaction(async () => {
          const created = await ctx.repo.createPlugin(
            {
              manifest: validated.manifest,
              author: validated.manifest.author || identity,
              authorKind: actorKind,
              ownerIdentity: identity,
              source: "user",
              status: "pending",
              forkedFromSlug: validated.manifest.forkedFrom || null,
            },
            { actor: actorName, actorKind, ip: req.ip },
          );
          for (const recipient of [identity, ADMIN_NOTIFICATION_IDENTITY]) {
            const isAuthor = recipient === identity;
            await ctx.repo.emitNotification({
              identity: recipient,
              idempotencyKey: `plugin:${created.id}:pending:${created.version}`,
              kind: "plugin_pending",
              title: isAuthor ? "插件已提交审核" : "有新插件待审核",
              // C-4：通知体写成人话；作者链预览页（待审插件无公开页），
              // 管理员链管理端待审筛选（一点就到审核队列）。
              body: isAuthor
                ? `「${created.name}」v${created.version} 已提交审核，通过后会自动上架。`
                : `新插件「${created.name}」v${created.version} 待审核，请前往管理端处理。`,
              link: isAuthor
                ? `/marketplace/${encodeURIComponent(created.slug)}/preview`
                : `/admin/plugins?status=pending`,
            });
          }
          return created;
        });

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
      const slug = safeDecodeParam(rawSlug);
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
};
