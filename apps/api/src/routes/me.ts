/**
 * 用户中心（/api/me）
 *
 * 身份来源：由 Web 侧 BFF 根据 NextAuth 会话派生，并以
 * `x-navhub-user-id` + `x-navhub-identity-signature` 转发到中枢。
 * 这里不接受客户端自报的 userId（BFF 会剥离客户端同名头）。
 *
 * 上一句只在流量确实经过 `/api/hub/*` 代理时成立：API 端口一旦被直接暴露
 * （compose 默认映射、MCP、curl），`x-navhub-user-id` 就是纯自报的字符串。
 * 所以每个端点先过 `identityTrusted`（开放模式 / 持票 / 身份已被签名绑定，三者其一），
 * 否则「无票自称他人」可以导出任意用户的全部个人数据、改写其设置、甚至直接注销。
 * ——本文件是热区：这条是审计报告里登记的例外，理由是闸门只能落在路由处理器里，
 * 在别处（hook）拦不住——签名 hook 只在配了 `NAVHUB_IDENTITY_SECRET` 时才生效。
 *
 * 端点：
 *  - GET  /api/me        概览（身份、计数、画像/金库/AI 配置存在性、别名）
 *  - POST /api/me/merge  匿名数据合并到登录身份（幂等、事务、审计）
 *
 * 匿名合并的所有权证明：除了登录身份的签名外，body.anonId 也必须带
 * `x-navhub-anon-signature`（HMAC(secret, anonId)）。否则任何登录用户都能
 * 把别人的匿名数据并进自己账号（anonId 虽然不可猜，但不能只靠不可猜）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context.ts";
import { identityOf, identityTrusted } from "./shared.ts";
import { verifyIdentitySignature } from "../identity-signature.ts";
import { invalidateProfileThrottle, refreshUserProfile } from "../profile-service.ts";

/** 前端生成的匿名 id 形态：anon-<uuid>；限制长度避免异常值写入别名表 */
const ANON_ID_RE = /^anon-[A-Za-z0-9_-]{8,80}$/;

export const meRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get("/api/me", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(401);
      return { error: "缺少登录身份" };
    }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const [overview, settings] = await Promise.all([
      ctx.repo.getUserCenterOverview(canonical),
      ctx.repo.getUserSettings(canonical),
    ]);
    return { ok: true, ...overview, settings };
  });

  /* ------------------------- 设置 ------------------------- */

  app.get("/api/me/settings", async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    return { ok: true, settings: await ctx.repo.getUserSettings(canonical) };
  });

  app.patch("/api/me/settings", async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const parsed = z.object({ personalizationEnabled: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "参数无效", detail: parsed.error.issues };
    }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const settings = await ctx.repo.updateUserSettings(canonical, parsed.data);
    return { ok: true, settings };
  });

  /* ------------------------- 数据主权 ------------------------- */

  /** 导出全部个人数据（JSON 附件；LLM 密钥已脱敏，金库只带版本元信息） */
  app.get(
    "/api/me/export",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const payload = await ctx.repo.exportUserData(canonical);
    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.export",
      target: canonical,
      diff: {
        favorites: payload.favorites.length,
        folders: payload.favoriteFolders.length,
        searches: payload.searchHistory.items.length,
      },
    }).catch(() => undefined);
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="navhub-export-${stamp}.json"`);
    return payload;
  });

  /**
   * 我的操作记录：用户可见的数据主权面板（M10）。
   * 数据源是既有 audit_logs（user.export / user.delete / identity.merge / workspace:*），
   * 只暴露 action / target / 时间；IP 与内部 diff 不外传。
   */
  app.get(
    "/api/me/activity",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);
      const q = (req.query ?? {}) as Record<string, string>;
      const limit = Math.min(Math.max(Number(q.limit ?? 20) || 20, 1), 100);
      const page = await ctx.repo.listAuditLogs({ actor: canonical, limit });
      return {
        ok: true,
        identity: canonical,
        items: page.items.map((row) => ({ action: row.action, target: row.target, at: row.createdAt })),
        hasMore: page.hasMore,
      };
    },
  );

  /**
   * 注销：删除该身份的全部个人数据（保留登录账号本身，重新登录后是空账号）。
   * 必须显式确认，避免误触把收藏与历史一次清空。
   */
  app.delete("/api/me", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    if (identity.startsWith("anon-")) {
      reply.code(403);
      return { error: "匿名身份不支持云端注销，请直接清理本机数据" };
    }
    const parsed = z.object({ confirm: z.literal("DELETE") }).safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: '需要 confirm: "DELETE" 二次确认' };
    }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const counts = await ctx.repo.deleteUserData(canonical);
    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.delete",
      target: canonical,
      diff: counts,
    }).catch(() => undefined);
    return { ok: true, deleted: counts };
  });

  app.post("/api/me/merge", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const target = identityOf(req as never);
    if (!target) {
      reply.code(401);
      return { error: "缺少登录身份" };
    }
    // 目标必须是登录身份；匿名目标没有意义（等价于自我合并）
    if (target.startsWith("anon-")) {
      reply.code(400);
      return { error: "合并目标必须是登录身份" };
    }

    const parsed = z.object({ anonId: z.string().regex(ANON_ID_RE) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "anonId 无效", detail: parsed.error.issues };
    }

    // 匿名身份所有权：配置了密钥时必须带 anon 签名
    if (ctx.config.identitySecret) {
      const signature = req.headers["x-navhub-anon-signature"];
      if (
        !verifyIdentitySignature(
          ctx.config.identitySecret,
          parsed.data.anonId,
          typeof signature === "string" ? signature : undefined,
        )
      ) {
        reply.code(401);
        return { error: "匿名身份签名缺失或无效" };
      }
    }

    const canonicalTarget = await ctx.repo.resolveIdentity(target);
    const resolvedSource = await ctx.repo.resolveIdentity(parsed.data.anonId);
    if (resolvedSource === canonicalTarget) {
      return {
        ok: true,
        alreadyMerged: true,
        source: resolvedSource,
        target: canonicalTarget,
        vaultNeedsChoice: false,
      };
    }

    const result = await ctx.repo.mergeIdentity(resolvedSource, canonicalTarget);

    // 合并后画像应从新的事件集合重建（收藏也会参与）；失败不影响合并结果
    invalidateProfileThrottle(canonicalTarget);
    void refreshUserProfile(ctx, canonicalTarget).catch(() => undefined);

    await ctx.repo.audit({
      ip: req.ip,
      actor: canonicalTarget,
      actorKind: "user",
      action: "identity.merge",
      target: resolvedSource,
      diff: {
        favoritesMoved: result.favoritesMoved,
        favoritesSkipped: result.favoritesSkipped,
        searchesMoved: result.searchesMoved,
        eventsMoved: result.eventsMoved,
        pluginsMoved: result.pluginsMoved,
        vaultNeedsChoice: result.vaultNeedsChoice,
      },
    }).catch(() => undefined);

    return { ok: true, ...result };
  });
};
