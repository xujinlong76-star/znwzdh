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
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken as hashApiToken, secureEqual } from "../auth.ts";
import { z } from "zod";
import { generateToken, hashPassword, hashToken, validatePassword } from "@navhub/core";

import type { AppContext } from "../context.ts";

/** 令牌有效期：验证链接 24h，重置链接 1h（重置窗口越短越安全） */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * 邮箱格式：顶级域至少 2 个字母（`a@b.c` 不是真实邮箱，单字符 TLD 不存在）。
 * 只拦形状，不做 MX/DNS 查询——注册是高频入口，DNS 失败会把正常用户挡在门外。
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function isTest(): boolean {
  return process.env.NODE_ENV === "test";
}

/** 登录失败锁定：数据库共享固定窗口，跨 API 副本统一计数。 */
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAIL_MAX = 5;
let lastLoginFailurePruneAt = 0;

function loginFailureKey(ctx: AppContext, identifier: string): string {
  // 使用跨副本共享的会话密钥 HMAC；普通 SHA-256 会允许数据库读取者离线枚举常见邮箱。
  const digest = createHmac("sha256", ctx.config.sessionSecret)
    .update(identifier.trim().toLowerCase())
    .digest("hex");
  return "auth:login-failure:" + digest;
}


/** 管理员 TOTP（RFC 6238）：密钥 AES-256-GCM 加密后存入共享 system_states；同一时间步验证码通过共享消费标记防重放。 */
type AdminMfaState = {
  iv: string;
  ciphertext: string;
  tag: string;
  enabled: boolean;
  recoveryHashes: string[];
  recoveryVersion: string;
  updatedAt: number;
};

const ADMIN_MFA_STATE_KEY = "auth:admin-mfa:v1";
const ADMIN_MFA_FAILURE_KEY = "auth:admin-mfa-failure:global";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function mfaEncryptionKey(): Buffer {
  const raw = process.env.NAVHUB_MFA_ENCRYPTION_KEY ?? "";
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("NAVHUB_MFA_ENCRYPTION_KEY 必须是 32 字节密钥（64 位 hex 或 base64）");
  return key;
}

function base32Encode(input: Buffer): string {
  let bits = 0, value = 0, output = "";
  for (const byte of input) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/g, "").toUpperCase()) {
    const n = BASE32.indexOf(ch);
    if (n < 0) throw new Error("invalid base32");
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; value &= (1 << bits) - 1; }
  }
  return Buffer.from(out);
}

function totpAt(secret: string, timeMs: number): string {
  const counter = BigInt(Math.floor(timeMs / 30_000));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

function matchingTotpCounter(secret: string, supplied: string, now = Date.now()): number | null {
  const code = supplied.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const actual = Buffer.from(code);
  const currentCounter = Math.floor(now / 30_000);
  for (const offset of [-1, 0, 1]) {
    const counter = currentCounter + offset;
    const expected = Buffer.from(totpAt(secret, counter * 30_000));
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return counter;
  }
  return null;
}


let lastTotpReplayPruneAt = 0;

async function claimTotpStep(ctx: AppContext, version: string, counter: number): Promise<boolean> {
  const now = Date.now();
  if (now - lastTotpReplayPruneAt > 60_000) {
    lastTotpReplayPruneAt = now;
    await ctx.repo.pruneSystemStatePrefix("auth:admin-mfa:totp:", now - 5 * 60 * 1000).catch(() => 0);
  }
  return ctx.repo.claimSystemState(
    "auth:admin-mfa:totp:" + version + ":" + counter,
    true,
    5 * 60 * 1000,
    now,
  );
}

function encryptMfaSecret(secret: string): Pick<AdminMfaState, "iv" | "ciphertext" | "tag"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mfaEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), ciphertext: ciphertext.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}

function decryptMfaSecret(state: AdminMfaState): string {
  const decipher = createDecipheriv("aes-256-gcm", mfaEncryptionKey(), Buffer.from(state.iv, "hex"));
  decipher.setAuthTag(Buffer.from(state.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(state.ciphertext, "hex")), decipher.final()]).toString("utf8");
}

function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = randomBytes(10).toString("hex").toUpperCase();
    return raw.match(/.{1,4}/g)?.join("-") ?? raw;
  });
}

async function readAdminMfa(ctx: AppContext): Promise<AdminMfaState | null> {
  return ctx.repo.getSystemState<AdminMfaState>(ADMIN_MFA_STATE_KEY);
}

async function recordAdminMfaFailure(ctx: AppContext): Promise<void> {
  const result = await ctx.repo.recordLoginFailure(ADMIN_MFA_FAILURE_KEY, Date.now(), LOGIN_FAIL_WINDOW_MS);
  if (result.count === LOGIN_FAIL_MAX) {
    await ctx.repo.audit({ actor: "admin-mfa-bff", actorKind: "system", action: "account.admin_mfa_locked" }).catch(() => {});
  }
}

async function verifyAdminMfa(ctx: AppContext, supplied: string): Promise<boolean> {
  const now = Date.now();
  const failures = await ctx.repo.getLoginFailureState(ADMIN_MFA_FAILURE_KEY);
  if (failures && failures.count >= LOGIN_FAIL_MAX && now - failures.firstAt <= LOGIN_FAIL_WINDOW_MS) return false;

  const state = await readAdminMfa(ctx);
  const required = process.env.NAVHUB_ADMIN_MFA_REQUIRED === "1" || process.env.NAVHUB_ADMIN_MFA_REQUIRED === "true";
  if (!state?.enabled) {
    if (required) { await recordAdminMfaFailure(ctx); return false; }
    await ctx.repo.clearLoginFailure(ADMIN_MFA_FAILURE_KEY);
    return true;
  }

  const secret = decryptMfaSecret(state);
  const matchedCounter = matchingTotpCounter(secret, supplied);
  if (matchedCounter !== null) {
    // TOTP 时间步只可消费一次；共享 DB 原子占坑防止跨副本重放同一验证码。
    const accepted = await claimTotpStep(ctx, state.recoveryVersion, matchedCounter);
    if (accepted) {
      await ctx.repo.clearLoginFailure(ADMIN_MFA_FAILURE_KEY);
      return true;
    }
  } else {
    const normalized = supplied.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized) {
      const recoveryHash = hashApiToken(normalized);
      if (state.recoveryHashes.includes(recoveryHash)) {
        const accepted = await ctx.repo.claimSystemState(
          "auth:admin-mfa:recovery:" + state.recoveryVersion + ":" + recoveryHash,
          true,
          10 * 365 * 24 * 60 * 60 * 1000,
        );
        if (accepted) {
          await ctx.repo.clearLoginFailure(ADMIN_MFA_FAILURE_KEY);
          return true;
        }
      }
    }
  }

  await recordAdminMfaFailure(ctx);
  return false;
}

function internalMfaRequest(ctx: AppContext, req: { headers: Record<string, unknown> }): boolean {
  const expected = ctx.config.internalToken;
  const supplied = req.headers["x-navhub-internal-token"];
  return Boolean(expected && typeof supplied === "string" && secureEqual(supplied, expected));
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


  /* ---------------- 管理员双因素认证（TOTP + 一次性恢复码） ---------------- */

  app.get("/api/account/admin-mfa/status", { config: { scope: "admin" } }, async () => {
    const state = await readAdminMfa(ctx);
    return { enabled: Boolean(state?.enabled), required: process.env.NAVHUB_ADMIN_MFA_REQUIRED === "1" || process.env.NAVHUB_ADMIN_MFA_REQUIRED === "true" };
  });

  app.post("/api/account/admin-mfa/setup", { config: { scope: "admin" } }, async (_req, reply) => {
    if (!ctx.config.internalToken) { reply.code(503); return { error: "启用管理员 MFA 前必须配置 Web/API 共享的 NAVHUB_INTERNAL_TOKEN" }; }
    let encrypted: Pick<AdminMfaState, "iv" | "ciphertext" | "tag">;
    let secret: string;
    try {
      // 先验证密钥配置，再生成并加密；不允许以明文或默认密钥落库。
      mfaEncryptionKey();
      secret = base32Encode(randomBytes(20));
      encrypted = encryptMfaSecret(secret);
    } catch (err) {
      reply.code(503);
      return { error: err instanceof Error ? err.message : "MFA 加密配置不可用" };
    }
    const existing = await readAdminMfa(ctx);
    if (existing?.enabled) { reply.code(409); return { error: "管理员双因素认证已启用；请先使用恢复流程处理" }; }
    await ctx.repo.setSystemState(ADMIN_MFA_STATE_KEY, {
      ...encrypted, enabled: false, recoveryHashes: [], recoveryVersion: randomBytes(12).toString("hex"), updatedAt: Date.now(),
    } satisfies AdminMfaState);
    await ctx.repo.audit({ actor: _req.auth.actor, actorKind: _req.auth.kind, action: "account.admin_mfa_setup_started" }).catch(() => {});
    reply.header("cache-control", "no-store");
    const issuer = "山羊胡管理后台";
    return {
      ok: true,
      secret,
      otpauthUrl: "otpauth://totp/" + encodeURIComponent(issuer + ":admin") + "?secret=" + secret + "&issuer=" + encodeURIComponent(issuer) + "&algorithm=SHA1&digits=6&period=30",
      message: "请在验证器 App 中添加密钥，再提交当前 6 位验证码确认启用。密钥只在本次响应中显示。",
    };
  });

  app.post("/api/account/admin-mfa/confirm", { config: { scope: "admin" } }, async (req, reply) => {
    const body = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!body.success) { reply.code(400); return { error: "请输入 6 位验证码" }; }
    const state = await readAdminMfa(ctx);
    if (!state || state.enabled || Date.now() - state.updatedAt > 10 * 60 * 1000) { reply.code(409); return { error: "请先生成有效期 10 分钟内的待确认 MFA 密钥" }; }
    let secret: string;
    try { secret = decryptMfaSecret(state); } catch { reply.code(503); return { error: "MFA 密钥解密失败，请重新初始化" }; }
    const matchedCounter = matchingTotpCounter(secret, body.data.code);
    if (matchedCounter === null) { reply.code(401); return { error: "验证码无效或已过期" }; }
    const consumed = await claimTotpStep(ctx, state.recoveryVersion, matchedCounter);
    if (!consumed) { reply.code(401); return { error: "验证码已使用，请等待下一组验证码" }; }
    const codes = newRecoveryCodes();
    await ctx.repo.setSystemState(ADMIN_MFA_STATE_KEY, {
      ...state, enabled: true, recoveryHashes: codes.map((code) => hashApiToken(code.replace(/-/g, ""))),
      updatedAt: Date.now(),
    } satisfies AdminMfaState);
    await ctx.repo.clearLoginFailure(ADMIN_MFA_FAILURE_KEY);
    await ctx.repo.audit({ actor: req.auth.actor, actorKind: req.auth.kind, action: "account.admin_mfa_enabled" }).catch(() => { /* 不得因审计故障吞掉一次性恢复码 */ });
    reply.header("cache-control", "no-store");
    return { ok: true, recoveryCodes: codes, message: "双因素认证已启用。请离线保存恢复码；每个恢复码只能使用一次，此后不会再次显示。" };
  });

  // 仅供受信任的 Web BFF 调用；不能使用普通浏览器 Bearer token 冒充内部调用。
  app.post("/api/account/admin-mfa/verify", { config: { scope: "public", ...accountRateLimit(30) } }, async (req, reply) => {
    if (!internalMfaRequest(ctx, req as never)) { reply.code(401); return { ok: false }; }
    const body = z.object({ code: z.string().max(64).default(""), credentialValid: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) { reply.code(400); return { ok: false }; }
    if (body.data.credentialValid === false) {
      await recordAdminMfaFailure(ctx);
      reply.code(401);
      return { ok: false };
    }
    const ok = await verifyAdminMfa(ctx, body.data.code);
    reply.header("cache-control", "no-store");
    if (!ok) { reply.code(401); return { ok: false }; }
    if (!/^\d{6}$/.test(body.data.code.trim())) {
      await ctx.repo.audit({
        actor: "admin-mfa-bff",
        actorKind: "system",
        action: "account.admin_mfa_recovery_used",
        ip: req.ip,
      }).catch(() => { /* MFA result must not depend on audit availability */ });
    }
    return { ok: true };
  });

  app.post("/api/account/admin-mfa/disable", { config: { scope: "admin" } }, async (req, reply) => {
    const body = z.object({ code: z.string().min(1).max(64) }).safeParse(req.body);
    if (!body.success) { reply.code(400); return { error: "验证码无效" }; }
    const state = await readAdminMfa(ctx);
    if (!state?.enabled || !(await verifyAdminMfa(ctx, body.data.code))) { reply.code(401); return { error: "验证码无效" }; }
    await ctx.repo.setSystemState(ADMIN_MFA_STATE_KEY, { ...state, enabled: false, recoveryHashes: [], updatedAt: Date.now() });
    await ctx.repo.audit({ actor: req.auth.actor, actorKind: req.auth.kind, action: "account.admin_mfa_disabled" }).catch(() => {});
    return { ok: true };
  });

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
        // 账号枚举防护（P0-2）：409 冲突分支跳过了 scrypt 哈希（~100ms），
        // 与 201 成功分支的响应时间可区分——攻击者用全新 username + 目标邮箱注册，
        // 收到 409 就等于确认了「该邮箱已注册」。哑哈希抹平时序；文案统一防枚举。
        const taken = result.reason === "username_taken" || result.reason === "email_taken";
        if (taken) {
          // 哑 scrypt：与成功路径等价耗时报错时间，关闭时序 oracle
          await hashPassword(body.data.password);
          await ctx.repo.audit({
            actor: "anonymous",
            actorKind: "anonymous",
            action: "account.register_conflict",
            target: email,
            diff: { reason: result.reason },
          }).catch(() => {
            // 审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。
          });
        }
        const messages: Record<string, string> = {
          invalid_username: "用户名不合法",
          invalid_email: "邮箱格式不正确",
          invalid_password: "密码不符合要求",
        };
        reply.code(409);
        if (taken) {
          return { error: "该标识不可用，请更换或直接登录 / 找回密码" };
        }
        return { error: messages[result.reason] ?? "注册失败" };
      }

      // 发验证邮件（失败不阻断注册，用户可走「重新发送」）
      const token = generateToken(32);
      await ctx.repo.createAuthToken({
        userId: result.user.id,
        purpose: "email_verification",
        tokenHash: hashToken(token),
        targetEmail: email,
        expiresAt: Date.now() + VERIFY_TTL_MS,
      });
      // P0-3：username 用户可控 → HTML escape 防邮件内容注入/钓鱼（与 resend 路径同口径）
      const safeName = result.user.username.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      await sendVerificationMail(ctx, ctx.mail, email, safeName, buildVerifyUrl(ctx, token));

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
          "SELECT user_id, target_email FROM auth_tokens WHERE token_hash = ? AND purpose = 'email_verification' AND consumed_at IS NULL AND expires_at > ? AND target_email IS NOT NULL LIMIT 1",
          [hashToken(body.data.token), Date.now()],
        )
      )[0];
      if (!row || !row.target_email) {
        reply.code(400);
        return { error: "验证链接无效或已失效" };
      }
      const consumed = await ctx.repo.consumeAuthToken({
        userId: String(row.user_id),
        purpose: "email_verification",
        tokenHash: hashToken(body.data.token),
        targetEmail: String(row.target_email),
      });
      if (!consumed) {
        reply.code(400);
        return { error: "验证链接无效或已使用" };
      }
      const verified = await ctx.repo.setUserEmailVerifiedForEmail(String(row.user_id), String(row.target_email));
      if (!verified) {
        reply.code(400);
        return { error: "验证链接已失效，请重新发送验证邮件" };
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
      // 防枚举（P0-1）：三个分支统一返回同一响应，攻击者无法区分
      // 「邮箱未注册」「已注册已验证」「已注册未验证」——审计走独立通道
      // 未配 SMTP 时不谎报“已发送”：邮件只进了日志投递（脱敏），用户收不到。
  // 防枚举：两种文案与用户是否存在无关。
  const UNIFORM = {
    ok: true,
    message: ctx.mail.isConfigured()
      ? "若该邮箱已注册且未验证，验证邮件已发送"
      : "若该邮箱已注册且未验证，验证邮件无法发送：本站未配置邮件发送，请联系管理员",
  };
      if (!user) {
        return UNIFORM;
      }
      if (user.emailVerified) {
        return UNIFORM; // 已验证：静默 no-op（不泄露状态）
      }
      // 已有未消费令牌则跳过（节流：防邮件轰炸 + 防 auth_tokens 积累）
      const hasActive = await ctx.repo.hasActiveAuthToken(user.id, "email_verification");
      if (hasActive) {
        return UNIFORM; // 仍有活跃令牌：不重发（审计可见尝试但响应不变）
      }
      const token = generateToken(32);
      await ctx.repo.createAuthToken({
        userId: user.id,
        purpose: "email_verification",
        tokenHash: hashToken(token),
        targetEmail: email,
        expiresAt: Date.now() + VERIFY_TTL_MS,
      });
      // P0-3：username 用户可控 → HTML escape 防邮件内容注入/钓鱼
      const safeName = user.username.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      await sendVerificationMail(ctx, ctx.mail, email, safeName, buildVerifyUrl(ctx, token));
      return UNIFORM;
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
          targetEmail: email,
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
      // 未配 SMTP 时不谎报“已发送”：重置链接已生成并记入日志投递（脱敏），但未投递到用户邮箱。
  return {
    ok: true,
    message: ctx.mail.isConfigured()
      ? "若该邮箱已注册，重置链接已发送"
      : "若该邮箱已注册，重置链接已生成，但本站未配置邮件发送，无法投递，请联系管理员",
  };
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
          "SELECT user_id, target_email FROM auth_tokens WHERE token_hash = ? AND purpose = 'password_reset' AND consumed_at IS NULL AND expires_at > ? AND target_email IS NOT NULL LIMIT 1",
          [tokenHash, Date.now()],
        )
      )[0];
      if (!row || !row.target_email) {
        reply.code(400);
        return { error: "重置链接无效或已失效" };
      }
      const consumed = await ctx.repo.consumeAuthToken({
        userId: String(row.user_id),
        purpose: "password_reset",
        tokenHash,
        targetEmail: String(row.target_email),
      });
      if (!consumed) {
        reply.code(400);
        return { error: "重置链接无效或已使用" };
      }
      const updated = await ctx.repo.updateUserPasswordForEmail(String(row.user_id), body.data.password, String(row.target_email));
      if (!updated) {
        reply.code(400);
        return { error: "重置链接已失效，请重新申请密码重置" };
      }
    // 密码重置后吊销该用户全部已登录会话：旧的 next-auth JWT (sid) 即便未过期，
    // BFF 也会在下一个 /api/me/* 请求上经 isSessionRevoked 拦下 (401)。
    // row.user_id 是 users 表原始 id——凭据用户为裸 UUID，而 sessions 表按 canonical
    // 身份建行（凭据用户为 credentials:<uuid>）；须先规范化再吊销，否则凭据用户的
    // 会话一行都吊销不到、旧 JWT 仍可在 30 天内继续用。
    const rawUserId = String(row.user_id);
    const canonicalUserId = rawUserId.includes(":") ? rawUserId : "credentials:" + rawUserId;
    let sessionsRevoked = 0;
    try {
      sessionsRevoked = await ctx.repo.revokeAllSessions(canonicalUserId);
    } catch {
      // 吊销失败不阻塞密码重置（密码已改），但必须记审计以便排查。
      await ctx.repo.audit({
        actor: String(row.user_id),
        actorKind: "user",
        action: "account.password_reset_sessions_revoke_failed",
      });
    }
      await ctx.repo.audit({
        actor: String(row.user_id),
        actorKind: "user",
        action: "account.password_reset",
      });
    return { ok: true, message: "密码已重置，请使用新密码登录", sessionsRevoked };
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
      // 在 scrypt 前通过单条 UPSERT 原子预留尝试；多副本并发时也只有前 5 次进入密码校验。
      const identifier = body.data.identifier.trim();
      const failureKey = loginFailureKey(ctx, identifier);
      const loginNow = Date.now();
      if (loginNow - lastLoginFailurePruneAt > 60_000) {
        lastLoginFailurePruneAt = loginNow;
        await ctx.repo.pruneSystemStatePrefix("auth:login-failure:", loginNow - LOGIN_FAIL_WINDOW_MS).catch(() => 0);
      }
      const attempt = await ctx.repo.recordLoginFailure(failureKey, loginNow, LOGIN_FAIL_WINDOW_MS);
      if (attempt.count > LOGIN_FAIL_MAX) {
        reply.code(429);
        return { error: "登录失败次数过多，请 15 分钟后再试" };
      }
      // 返回 null = 用户不存在、密码错误或邮箱未验证（不区分，防账号枚举）。
      const user = await ctx.repo.verifyUserPassword(identifier, body.data.password);
      if (!user) {
        // 审计只保存共享会话密钥生成的 HMAC 摘要，不持久化原始邮箱/用户名或密码。
        const digest = failureKey.slice("auth:login-failure:".length);
        await ctx.repo
          .audit({
            actor: "anonymous",
            actorKind: "anonymous",
            action: attempt.count >= LOGIN_FAIL_MAX ? "account.login_locked" : "account.login_failed",
            target: `hmac-sha256:${digest}`,
            diff: { failures: attempt.count },
          })
          .catch(() => {
            // 审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。
          });
        reply.code(401);
        return { error: "邮箱/用户名或密码错误" };
      }
      await ctx.repo.clearLoginFailure(failureKey);
      await ctx.repo.audit({
        actor: user.id,
        actorKind: "user",
        action: "account.login",
        target: user.id,
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
    // 账号枚举防护（2026-11-06 深扫 S-6）：
    // 旧实现返回 verified / registered 两个布尔，是精确的账号存在性 + 验证状态
    // oracle（60 次/小时仍可批量枚举，且 verified 便于定向钓鱼/撞库）。
    // 这是 public 路由，任何人都能查任意邮箱。改为恒定响应：不查库、不泄露任何状态。
    // 「我的邮箱验证状态」应走登录会话内的 /api/me/* 私有接口，不在这个匿名端点。
    return { ok: true };
  });
};
