/**
 * 终端用户身份同步（OAuth upsert）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context.ts";
import { identityAllowed } from "./shared.ts";
import { verifyIdentitySignature } from "../identity-signature.ts";

export const identityRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* --------------------- 终端用户身份同步 --------------------- */

  /**
   * OAuth 登录后由 Web 前端调用：把 GitHub 身份 upsert 进 users 表，
   * 返回 canonical userId（后续收藏夹 / 画像都用它，保证多端一致）。
   */
  app.post("/api/users/sync", async (req, reply) => {
    // 身份伪造面：开放模式保持历史行为；开启鉴权后必须带有效 token，
    // 否则任意调用方可冒用任意 provider:providerId 写入 users 表。
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const body = z.object({
      provider: z.string().min(1).default("github"),
      providerId: z.string().min(1),
      username: z.string().min(1).max(64),
      email: z.email().nullable().optional(),
      avatar: z.string().url().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const targetId = body.data.provider + ":" + body.data.providerId;
    if (ctx.config.identitySecret && (req as any).auth?.kind === "anonymous") {
      const signature = (req.headers as any)["x-navhub-identity-signature"];
      if (
        !verifyIdentitySignature(
          ctx.config.identitySecret,
          targetId,
          typeof signature === "string" ? signature : undefined,
        )
      ) {
        reply.code(401);
        return { error: "身份签名缺失或无效" };
      }
    }
    const user = await ctx.repo.upsertOauthUser({
      id: targetId,
      username: body.data.username,
      email: body.data.email ?? null,
      avatar: body.data.avatar ?? null,
      source: body.data.provider === "credentials" ? "local" : "github",
    });
    return user;
  });

};
