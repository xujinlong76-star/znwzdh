/**
 * 用户中心（/api/me）
 *
 * 身份来源：由 Web 侧 BFF 根据 NextAuth 会话派生，并以
 * `x-navhub-user-id` + `x-navhub-identity-signature` 转发到中枢。
 * 这里不接受客户端自报的 userId（BFF 会剥离客户端同名头）。
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
import { identityOf } from "./shared.ts";
import { verifyIdentitySignature } from "../identity-signature.ts";
import { invalidateProfileThrottle, refreshUserProfile } from "../profile-service.ts";

/** 前端生成的匿名 id 形态：anon-<uuid>；限制长度避免异常值写入别名表 */
const ANON_ID_RE = /^anon-[A-Za-z0-9_-]{8,80}$/;

export const meRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get("/api/me", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(401);
      return { error: "缺少登录身份" };
    }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const overview = await ctx.repo.getUserCenterOverview(canonical);
    return { ok: true, ...overview };
  });

  app.post("/api/me/merge", async (req, reply) => {
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
