/**
 * 个性化画像（可解释偏好）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { identityAllowed, identityOf } from "./shared.ts";
import { refreshUserProfile, resetUserProfile } from "../profile-service.ts";

import type { AppContext } from "../context.ts";

export const profileRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* --------------------- 个性化画像（「我的偏好」） --------------------- */

  /** 读画像：让终端用户看到「系统据我的行为推断出了什么」——可解释性即信任 */
  app.get("/api/profile", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    return { profile: await ctx.repo.getUserProfile(identity) };
  });

  /**
   * 重置画像：清 user_profiles + 该身份的行为事件（画像是从中聚合的）。
   * 收藏夹与搜索历史保留——那是用户自己的数据，不是被推断的偏好。
   */
  app.delete("/api/profile", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const result = await resetUserProfile(ctx, identity);
    return { ok: true, ...result };
  });

};
