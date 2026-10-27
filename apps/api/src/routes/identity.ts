/**
 * 终端用户身份同步（OAuth upsert）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context.ts";
import { identityAllowed, isSafeAvatarUrl } from "./shared.ts";
import { verifyIdentityHeaders } from "../identity-signature.ts";

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
    // 核心键（provider/providerId）决定 users.id、avatar 是 XSS 安全边界
    //（伪协议 javascript:/data: 与协议相对 //evil 必须 400，见 auth.test 的 users/sync 头像用例），
    // 这两类走严格校验；展示字段 username/email 做幂等降级——本端点是 OAuth upsert，核心键
    // 才是事实，超长/非标准展示字段不该让整个身份同步 400（P1：此前 username>64 / email 非
    // 标准都会 400，前端 BFF 透传脏字段后每个带 SessionSync 的页面都刷红错，现已在 BFF 清洗）。
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const strict = z
      .object({
        provider: z.string().min(1).default("github"),
        providerId: z.string().min(1),
        avatar: z
          .string()
          .max(500)
          .refine((v) => v.trim() === "" || isSafeAvatarUrl(v), "头像地址只支持 http(s):// 或站内相对路径 /...")
          .nullable()
          .optional(),
      })
      .safeParse(raw);
    if (!strict.success) {
      reply.code(400);
      return { error: "参数无效", detail: strict.error.issues };
    }
    let username = typeof raw.username === "string" ? raw.username.trim() : "";
    if (!username) username = strict.data.providerId; // 缺省回退到 providerId，保证非空
    username = username.slice(0, 64); // 超长截断而非拒绝
    let email = typeof raw.email === "string" && raw.email.trim() !== "" ? raw.email.trim() : null;
    if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = null; // 非法邮箱不入库
    const targetId = strict.data.provider + ":" + strict.data.providerId;
    if (ctx.config.identitySecret && (req as any).auth?.kind === "anonymous") {
      const verdict = verifyIdentityHeaders({
        secret: ctx.config.identitySecret,
        identity: targetId,
        headers: req.headers as Record<string, unknown>,
        strict: ctx.config.identitySignatureStrict,
      });
      if (!verdict.ok) {
        reply.code(401);
        return { error: "身份签名缺失或无效" };
      }
    }
    const avatarRaw = strict.data.avatar;
    const user = await ctx.repo.upsertOauthUser({
      id: targetId,
      username,
      email,
      avatar: avatarRaw && avatarRaw.trim() !== "" ? avatarRaw.trim() : null,
      source: strict.data.provider === "credentials" ? "local" : "github",
    });
    return user;
  });

};
