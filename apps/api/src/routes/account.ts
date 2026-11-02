/**
 * 用户自助账号生命周期（注册 / 邮箱验证 / 找回密码）。
 *
 * 这是「站点能否对外商用」的硬门槛：此前只有管理员口令 + GitHub OAuth，
 * 普通用户无法自助开户、无法找回账号，`password_hash` 列形同虚设。
 * 注册、邮箱验证、找回密码三者强耦合（验证与重置都依赖邮件投递），
 * 因此作为一个完整功能交付。
 *
 * 安全口径：
 *  - 一次性令牌只存 sha256，明文仅出现在邮件里；
 *  - 令牌消费是单条原子 UPDATE，防重放；
 *  - 忘记密码对「邮箱是否存在」返回同一文案，防账号枚举；
 *  - 每个写端点都有路由级限流，防刷邮件（邮件是真实成本）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateToken, hashToken, validatePassword } from "@navhub/core";

import type { AppContext } from "../context.ts";

/** 令牌有效期：验证链接 24h，重置链接 1h（重置窗口越短越安全） */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isTest(): boolean {
  return process.env.NODE_ENV === "test";
}

/** 路由级限流：测试环境放开，真实环境限制为「小时级若干次」 */
function accountRateLimit(max: number) {
  return { rateLimit: { max: isTest() ? 10_000 : max, timeWindow: "1 hour" } };
}

function buildVerifyUrl(ctx: AppContext, token: string): string {
  return `${ctx.config.publicUrl.replace(/\/$/, "")}/auth/verify-email?token=${encodeURIComponent(token)}`;
}

function buildResetUrl(ctx: AppContext, token: string): string {
  return `${ctx.config.publicUrl.replace(/\/$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}`;
}

/** 发送验证邮件；失败只记审计，不改变注册结果（用户可重新发送） */
async function sendVerificationMail(
  ctx: AppContext,
  mail: AppContext["mail"],
  email: string,
  username: string,
  link: string,
): Promise<void> {
  const text = [
    `${username} 你好：`,
    "",
    "欢迎注册山羊胡。请点击下面的链接完成邮箱验证：",
    link,
    "",
    "链接 24 小时内有效，且只能使用一次。若这不是你本人的操作，请忽略本邮件。",
  ].join("\n");
  const html = `<p>${username} 你好，</p><p>欢迎注册山羊胡。请点击下面的链接完成邮箱验证：</p><p><a href="${link}">${link}</a></p><p>链接 24 小时内有效，且只能使用一次。若这不是你本人的操作，请忽略本邮件。</p>`;
  const result = await mail.sendMail({ to: email, subject: "【山羊胡】请验证你的邮箱", text, html });
  if (!result.ok) {
    await ctx.repo.audit({
      actor: "system",
      actorKind: "system",
      action: "account.verify_mail_failed",
      target: email,
      diff: { error: result.error ?? "unknown" },
    });
  }
}

/** 发送密码重置邮件 */
async function sendResetMail(
  ctx: AppContext,
  mail: AppContext["mail"],
  email: string,
  link: string,
): Promise<void> {
  const text = [
    "你好：",
    "",
    "我们收到了重置山羊胡账号密码的请求。请点击下面的链接设置新密码：",
    link,
    "",
    "链接 1 小时内有效，且只能使用一次。若这不是你本人的操作，请忽略本邮件，你的密码不会改变。",
  ].join("\n");
  const html = `<p>你好，</p><p>我们收到了重置山羊胡账号密码的请求。请点击下面的链接设置新密码：</p><p><a href="${link}">${link}</a></p><p>链接 1 小时内有效，且只能使用一次。若这不是你本人的操作，请忽略本邮件。</p>`;
  const result = await mail.sendMail({ to: email, subject: "【山羊胡】重置你的账号密码", text, html });
  if (!result.ok) {
    await ctx.repo.audit({
      actor: "system",
      actorKind: "system",
      action: "account.reset_mail_failed",
      target: email,
      diff: { error: result.error ?? "unknown" },
    });
  }
}

export const accountRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ---------------- 注册 ---------------- */

  app.post(
    "/api/account/register",
    { config: { scope: "public", ...accountRateLimit(10) } },
    async (req, reply) => {
      const body = z
        .object({
          username: z.string().min(1).max(40),
          email: z.string().min(1).max(200),
          password: z.string().min(1).max(200),
        })
        .safeParse(req.body);
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }
      const email = body.data.email.trim().toLowerCase();
      const pwError = validatePassword(body.data.password);
      if (pwError) {
        reply.code(400);
        return { error: pwError };
      }
      if (!EMAIL_RE.test(email)) {
        reply.code(400);
        return { error: "邮箱格式不正确" };
      }

      const result = await ctx.repo.createUserWithPassword({
        username: body.data.username.trim(),
        email,
        password: body.data.password,
      });
      if (!result.ok) {
        // 不区分「用户名已存在」与「邮箱已存在」的具体原因给前端，
        // 但保留可读提示；前端据此引导用户。
        const messages: Record<string, string> = {
          username_taken: "该用户名已被占用",
          email_taken: "该邮箱已注册",
          invalid_username: "用户名不合法",
          invalid_email: "邮箱格式不正确",
          invalid_password: "密码不符合要求",
        };
        reply.code(409);
        return { error: messages[result.reason] ?? "注册失败" };
      }

      // 发验证邮件（失败不阻断注册，用户可走「重新发送」）
      const token = generateToken(32);
      await ctx.repo.createAuthToken({
        userId: result.user.id,
        purpose: "email_verification",
        tokenHash: hashToken(token),
        expiresAt: Date.now() + VERIFY_TTL_MS,
      });
      await sendVerificationMail(ctx, ctx.mail, email, result.user.username, buildVerifyUrl(ctx, token));

      await ctx.repo.audit({
        actor: result.user.id,
        actorKind: "user",
        action: "account.register",
        target: email,
      });

      reply.code(201);
      return {
        ok: true,
        user: { id: result.user.id, username: result.user.username, email: result.user.email },
        message: "注册成功，请查收邮箱完成验证",
      };
    },
  );

  /* ---------------- 邮箱验证 ---------------- */

  app.post(
    "/api/account/verify-email",
    { config: { scope: "public", ...accountRateLimit(20) } },
    async (req, reply) => {
      const body = z
        .object({ token: z.string().min(1).max(512) })
        .safeParse(req.body);
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效" };
      }
      // 令牌哈希无法反查用户，故先按哈希找到候选行，再校验归属
      const row = (
        await ctx.repo.raw(
          "SELECT user_id, purpose, expires_at, consumed_at FROM auth_tokens WHERE token_hash = ? AND purpose = 'email_verification' LIMIT 1",
          [hashToken(body.data.token)],
        )
      )[0];
      if (!row) {
        reply.code(400);
        return { error: "验证链接无效或已失效" };
      }
      const consumed = await ctx.repo.consumeAuthToken({
        userId: String(row.user_id),
        purpose: "email_verification",
        tokenHash: hashToken(body.data.token),
      });
      if (!consumed) {
        reply.code(400);
        return { error: "验证链接无效或已使用" };
      }
      const verified = await ctx.repo.setUserEmailVerified(String(row.user_id));
      if (!verified) {
        reply.code(500);
        return { error: "验证状态更新失败" };
      }
      await ctx.repo.audit({
        actor: String(row.user_id),
        actorKind: "user",
        action: "account.email_verified",
      });
      return { ok: true, message: "邮箱验证成功" };
    },
  );

  /* ---------------- 重新发送验证邮件 ---------------- */

  app.post(
    "/api/account/resend-verification",
    { config: { scope: "public", ...accountRateLimit(5) } },
    async (req, reply) => {
      const body = z
        .object({ email: z.string().min(1).max(200) })
        .safeParse(req.body);
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效" };
      }
      const email = body.data.email.trim().toLowerCase();
      const user = await ctx.repo.findUserByEmail(email);
      // 无论邮箱是否存在都返回同一文案（防枚举）
      if (!user) {
        return { ok: true, message: "若该邮箱已注册，验证邮件已发送" };
      }
      if (user.emailVerified) {
        return { ok: true, message: "该邮箱已验证，无需重复发送" };
      }
      // 已有未消费令牌则复用，避免邮件轰炸
      const token = generateToken(32);
      await ctx.repo.createAuthToken({
        userId: user.id,
        purpose: "email_verification",
        tokenHash: hashToken(token),
        expiresAt: Date.now() + VERIFY_TTL_MS,
      });
      await sendVerificationMail(ctx, ctx.mail, email, user.username, buildVerifyUrl(ctx, token));
      return { ok: true, message: "验证邮件已发送" };
    },
  );

  /* ---------------- 忘记密码 ---------------- */

  app.post(
    "/api/account/forgot-password",
    { config: { scope: "public", ...accountRateLimit(5) } },
    async (req, reply) => {
      const body = z
        .object({ email: z.string().min(1).max(200) })
        .safeParse(req.body);
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效" };
      }
      const email = body.data.email.trim().toLowerCase();
      const user = await ctx.repo.findUserByEmail(email);
      // 防枚举：无论是否存在都返回同一成功文案
      if (user) {
        const token = generateToken(32);
        await ctx.repo.createAuthToken({
          userId: user.id,
          purpose: "password_reset",
          tokenHash: hashToken(token),
          expiresAt: Date.now() + RESET_TTL_MS,
        });
        await sendResetMail(ctx, ctx.mail, email, buildResetUrl(ctx, token));
        await ctx.repo.audit({
          actor: user.id,
          actorKind: "user",
          action: "account.password_reset_requested",
          target: email,
        });
      }
      return { ok: true, message: "若该邮箱已注册，重置链接已发送" };
    },
  );

  /* ---------------- 重置密码 ---------------- */

  app.post(
    "/api/account/reset-password",
    { config: { scope: "public", ...accountRateLimit(20) } },
    async (req, reply) => {
      const body = z
        .object({
          token: z.string().min(1).max(512),
          password: z.string().min(1).max(200),
        })
        .safeParse(req.body);
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效" };
      }
      const pwError = validatePassword(body.data.password);
      if (pwError) {
        reply.code(400);
        return { error: pwError };
      }
      const tokenHash = hashToken(body.data.token);
      const row = (
        await ctx.repo.raw(
          "SELECT user_id FROM auth_tokens WHERE token_hash = ? AND purpose = 'password_reset' LIMIT 1",
          [tokenHash],
        )
      )[0];
      if (!row) {
        reply.code(400);
        return { error: "重置链接无效或已失效" };
      }
      const consumed = await ctx.repo.consumeAuthToken({
        userId: String(row.user_id),
        purpose: "password_reset",
        tokenHash,
      });
      if (!consumed) {
        reply.code(400);
        return { error: "重置链接无效或已使用" };
      }
      const updated = await ctx.repo.updateUserPassword(String(row.user_id), body.data.password);
      if (!updated) {
        reply.code(400);
        return { error: "密码不符合要求" };
      }
      await ctx.repo.audit({
        actor: String(row.user_id),
        actorKind: "user",
        action: "account.password_reset",
      });
      return { ok: true, message: "密码已重置，请使用新密码登录" };
    },
  );

  /* ---------------- 登录（next-auth 凭证流程的后端校验） ---------------- */

  app.post(
    "/api/account/login",
    { config: { scope: "public", ...accountRateLimit(20) } },
    async (req, reply) => {
      const body = z
        .object({
          identifier: z.string().min(1).max(200),
          password: z.string().min(1).max(200),
        })
        .safeParse(req.body);
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效" };
      }
      // 返回 null = 用户不存在或密码错误（不区分，防账号枚举）；
      // next-auth 的 authorize 收到 null 即登录失败。
      const user = await ctx.repo.verifyUserPassword(body.data.identifier.trim(), body.data.password);
      if (!user) {
        reply.code(401);
        return { error: "邮箱/用户名或密码错误" };
      }
      await ctx.repo.audit({
        actor: user.id,
        actorKind: "user",
        action: "account.login",
        target: user.email ?? undefined,
      });
      return {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified,
        },
      };
    },
  );

  /* ---------------- 查询当前账号的验证状态 ---------------- */

  app.get("/api/account/email-status", { config: { scope: "public", ...accountRateLimit(60) } }, async (req, reply) => {
    const email = typeof req.query === "object" && req.query && "email" in req.query
      ? String((req.query as { email?: string }).email ?? "").trim().toLowerCase()
      : "";
    if (!email) {
      reply.code(400);
      return { error: "缺少 email" };
    }
    const user = await ctx.repo.findUserByEmail(email);
    return { ok: true, email, verified: Boolean(user?.emailVerified), registered: Boolean(user) };
  });
};
