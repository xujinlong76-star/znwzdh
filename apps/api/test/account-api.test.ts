/**
 * 账号生命周期 API 测试（注册 / 验证 / 登录 / 找回 / 重置）。
 *
 * 邮件投递在测试里用「捕获式假发送器」替代：真实 SMTP 不可用于单测，
 * 而验证/重置令牌只出现在邮件正文里，必须捕获才能驱动后续流程。
 * 这同时验证了「令牌只经邮件传递、库里只存哈希」的链路。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import type { MailMessage, MailResult, MailTransport } from "@navhub/ai";

const dir = mkdtempSync(join(tmpdir(), "navhub-account-"));
const base = {
  mode: "lite" as const,
  embedding: {
    model: "m",
    endpoint: "https://hf-mirror.com",
    dtype: "q8" as const,
    cacheDir: join(dir, "models"),
    dim: 512,
    enabled: false,
  },
  llm: {
    baseUrl: "https://api.deepseek.com",
    apiKey: null,
    model: "deepseek-chat",
    timeoutMs: 3000,
  },
  fetch: {
    timeoutMs: 1000,
    maxBytes: 65536,
    maxRedirects: 1,
    allowPrivateNetworks: false,
    userAgent: "NavHubTest/0.1",
  },
  corsOrigins: ["*"],
};

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
/** 捕获到的邮件（用于取出验证/重置令牌） */
const captured: MailMessage[] = [];

beforeAll(async () => {
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "account.db") }),
  );
  // 覆盖邮件发送器：捕获正文，返回成功（不发真实邮件）
  const fakeMail: MailTransport = {
    isConfigured: () => true,
    describe: () => "test://capture",
    sendMail: async (message: MailMessage): Promise<MailResult> => {
      captured.push(message);
      return { ok: true, messageId: "test-" + captured.length };
    },
  };
  (ctx as { mail: MailTransport }).mail = fakeMail;
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 从捕获邮件里提取 URL 中的 token 参数 */
function extractToken(message: MailMessage, label: string): string {
  const match = message.text.match(
    new RegExp(`${label}[^\\s]*token=([A-Za-z0-9_-]+)`),
  );
  expect(match, `邮件里应包含 ${label} 令牌`).not.toBeNull();
  return match![1];
}

async function post(url: string, payload: unknown) {
  return app.inject({ method: "POST", url, payload: payload as never });
}

describe("账号生命周期 API", () => {
  it("注册成功并发送验证邮件", async () => {
    captured.length = 0;
    const res = await post("/api/account/register", {
      username: "alice",
      email: "alice@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe("alice@example.com");
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe("alice@example.com");
    expect(captured[0].text).toContain("验证");
  });

  it("重复注册返回 409，且不泄露「是用户名还是邮箱被占用」（防枚举 S-6）", async () => {
    const byEmail = await post("/api/account/register", {
      username: "alice2",
      email: "alice@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(byEmail.statusCode).toBe(409);
    // 2026-11-06：旧断言 toContain("邮箱") 依赖精确冲突文案，那是账号存在性 oracle。
    // 现在 username_taken / email_taken 统一同一文案，响应体必须逐字节一致。
    const byName = await post("/api/account/register", {
      username: "alice",
      email: "brand-new@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(byName.statusCode).toBe(409);
    expect(byName.body).toBe(byEmail.body);
  });

  it("弱密码返回 400", async () => {
    const res = await post("/api/account/register", {
      username: "weak",
      email: "weak@example.com",
      password: "123",
    });
    expect(res.statusCode).toBe(400);
  });

  it("邮箱验证：用邮件里的令牌激活账号", async () => {
    captured.length = 0;
    await post("/api/account/register", {
      username: "bob",
      email: "bob@example.com",
      password: "S3cret-Passw0rd!",
    });
    const token = extractToken(captured[0], "verify-email");

    const res = await post("/api/account/verify-email", { token });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const user = await ctx.repo.findUserByEmail("bob@example.com");
    expect(user?.emailVerified).toBe(true);
  });

  it("邮箱验证：令牌一次性，重复使用失败", async () => {
    captured.length = 0;
    await post("/api/account/register", {
      username: "carol",
      email: "carol@example.com",
      password: "S3cret-Passw0rd!",
    });
    const token = extractToken(captured[0], "verify-email");
    expect(
      (await post("/api/account/verify-email", { token })).statusCode,
    ).toBe(200);
    expect(
      (await post("/api/account/verify-email", { token })).statusCode,
    ).toBe(400);
  });

  it("注册：单字符 TLD 不是真实邮箱", async () => {
    const res = await post("/api/account/register", {
      username: "tld",
      email: "a@b.c",
      password: "S3cret-Passw0rd!",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("邮箱格式");
  });

  it("登录：同一标识连续失败 5 次后锁定，正确口令也回 429", async () => {
    await post("/api/account/register", {
      username: "locky",
      email: "locky@example.com",
      password: "S3cret-Passw0rd!",
    });
    for (let i = 0; i < 5; i++) {
      const bad = await post("/api/account/login", { identifier: "locky@example.com", password: "wrong" });
      expect(bad.statusCode).toBe(401);
    }
    const locked = await post("/api/account/login", { identifier: "locky@example.com", password: "S3cret-Passw0rd!" });
    expect(locked.statusCode).toBe(429);
  });

  it("登录：正确口令返回用户，错误口令 401", async () => {
    await post("/api/account/register", {
      username: "dave",
      email: "dave@example.com",
      password: "S3cret-Passw0rd!",
    });
    const ok = await post("/api/account/login", {
      identifier: "dave@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe("dave@example.com");

    const bad = await post("/api/account/login", {
      identifier: "dave@example.com",
      password: "wrong",
    });
    expect(bad.statusCode).toBe(401);

    const missing = await post("/api/account/login", {
      identifier: "nobody@example.com",
      password: "x",
    });
    expect(missing.statusCode).toBe(401);
  });

  it("忘记密码：无论邮箱是否存在都返回同一文案", async () => {
    captured.length = 0;
    const existing = await post("/api/account/forgot-password", {
      email: "dave@example.com",
    });
    const unknown = await post("/api/account/forgot-password", {
      email: "ghost@example.com",
    });
    expect(existing.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(existing.json().message).toBe(unknown.json().message);
    // 只有已注册邮箱会真实发信
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe("dave@example.com");
  });

  it("重置密码：用邮件令牌设置新密码后可登录", async () => {
    captured.length = 0;
    await post("/api/account/register", {
      username: "erin",
      email: "erin@example.com",
      password: "OldPassw0rd!",
    });
    await post("/api/account/forgot-password", { email: "erin@example.com" });
    const resetMsg = captured.find((m) => m.text.includes("reset-password"));
    expect(resetMsg).toBeDefined();
    const token = extractToken(resetMsg!, "reset-password");

    const res = await post("/api/account/reset-password", {
      token,
      password: "NewPassw0rd!",
    });
    expect(res.statusCode).toBe(200);

    const login = await post("/api/account/login", {
      identifier: "erin@example.com",
      password: "NewPassw0rd!",
    });
    expect(login.statusCode).toBe(200);

    const oldLogin = await post("/api/account/login", {
      identifier: "erin@example.com",
      password: "OldPassw0rd!",
    });
    expect(oldLogin.statusCode).toBe(401);
  });

  it("重置密码：吊销该用户全部会话并返回 sessionsRevoked", async () => {
    captured.length = 0;
    await post("/api/account/register", {
      username: "gail",
      email: "gail@example.com",
      password: "OldPassw0rd!",
    });
    // 先给该用户登记一个会话（canonical 身份 credentials:<uuid>）
    const user = await ctx.repo.findUserByEmail("gail@example.com");
    expect(user).not.toBeNull();
    const canonical = "credentials:" + (user?.id ?? "");
    const sid = "test-sid-acct-gail-0001";
    const sidToken = createHash("sha256").update(sid).digest("hex");
    await ctx.repo.upsertSessionActivity({
      token: sidToken,
      userId: canonical,
      userAgent: "acct-test",
      expiresAt: Date.now() + 86_400_000,
    });
    await post("/api/account/forgot-password", { email: "gail@example.com" });
    const resetMsg = captured.find((m) => m.text.includes("reset-password"));
    const resetToken = extractToken(resetMsg!, "reset-password");
    const res = await post("/api/account/reset-password", {
      token: resetToken,
      password: "NewPassw0rd!",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionsRevoked).toBe(1);
    expect(await ctx.repo.isSessionRevoked(sidToken, canonical)).toBe(true);
  });

  it("重置密码：吊销失败不阻塞重置，但记失败审计", async () => {
    captured.length = 0;
    await post("/api/account/register", {
      username: "hank",
      email: "hank@example.com",
      password: "OldPassw0rd!",
    });
    const user = await ctx.repo.findUserByEmail("hank@example.com");
    expect(user).not.toBeNull();
    const rawId = user?.id ?? "";
    vi.spyOn(ctx.repo, "revokeAllSessions").mockRejectedValueOnce(
      new Error("revoke boom"),
    );
    await post("/api/account/forgot-password", { email: "hank@example.com" });
    const resetMsg = captured.find((m) => m.text.includes("reset-password"));
    const resetToken = extractToken(resetMsg!, "reset-password");
    const res = await post("/api/account/reset-password", {
      token: resetToken,
      password: "NewPassw0rd!",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionsRevoked).toBe(0);
    const rows = await ctx.repo.raw(
      "SELECT action FROM audit_logs WHERE actor = ? AND action = ?",
      [rawId, "account.password_reset_sessions_revoke_failed"],
    );
    expect(rows.length).toBeGreaterThan(0);
    const login = await post("/api/account/login", {
      identifier: "hank@example.com",
      password: "NewPassw0rd!",
    });
    expect(login.statusCode).toBe(200);
  });

  it("重置密码：令牌一次性", async () => {
    captured.length = 0;
    await post("/api/account/register", {
      username: "frank",
      email: "frank@example.com",
      password: "OldPassw0rd!",
    });
    await post("/api/account/forgot-password", { email: "frank@example.com" });
    const resetMsg = captured.find((m) => m.text.includes("reset-password"));
    const token = extractToken(resetMsg!, "reset-password");
    expect(
      (
        await post("/api/account/reset-password", {
          token,
          password: "NewPassw0rd!",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post("/api/account/reset-password", {
          token,
          password: "Another1!",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("邮箱状态查询：恒定响应，不泄露账号存在性/验证状态（防枚举 S-6）", async () => {
    // 2026-11-06：email-status 是 public 路由，旧实现返回 registered/verified 两个
    // 布尔，等于把「某邮箱是否注册、是否已验证」做成批量枚举 oracle。改为恒定 { ok: true }。
    const res = await app.inject({
      method: "GET",
      url: "/api/account/email-status?email=bob@example.com",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const unknown = await app.inject({
      method: "GET",
      url: "/api/account/email-status?email=ghost@example.com",
    });
    expect(unknown.statusCode).toBe(200);
    // 存在与不存在邮箱的响应体必须逐字节一致，否则仍是 oracle
    expect(unknown.json()).toEqual(res.json());
    expect(unknown.body).toBe(res.body);
  });
});

describe("未配置邮件发送（isConfigured: () => false）", () => {
  const unconfiguredCaptured: MailMessage[] = [];
  const unconfiguredMail: MailTransport = {
    isConfigured: () => false,
    describe: () => "test://unconfigured",
    sendMail: async (message) => {
      unconfiguredCaptured.push(message);
      return { ok: true, messageId: "test-unconfigured" };
    },
  };
  let unconfiguredCtx: AppContext;
  let unconfiguredApp: Awaited<ReturnType<typeof buildServer>>;
  let unconfiguredDir: string;
  const unconfiguredPost = (path: string, body: unknown) =>
    unconfiguredApp.inject({
      method: "POST",
      url: path,
      payload: body,
      headers: { "content-type": "application/json" },
    });

  beforeAll(async () => {
    unconfiguredDir = mkdtempSync(
      join(tmpdir(), "navhub-account-unconfigured-"),
    );
    unconfiguredCtx = await createContext(
      loadConfig({ ...base, sqlitePath: join(unconfiguredDir, "account.db") }),
    );
    (unconfiguredCtx as { mail: MailTransport }).mail = unconfiguredMail;
    unconfiguredApp = await buildServer(unconfiguredCtx);
    await unconfiguredApp.ready();
  });

  afterAll(async () => {
    await unconfiguredApp.close();
    await unconfiguredCtx.close();
    rmSync(unconfiguredDir, { recursive: true, force: true });
  });

  it("忘记密码：已注册邮箱返回不谎报的文案且 ok: true", async () => {
    const register = await unconfiguredPost("/api/account/register", {
      username: "mallory",
      email: "mallory@example.com",
      password: "Test123!@#456",
      displayName: "mallory",
    });
    expect(register.statusCode).toBe(201);
    const res = await unconfiguredPost("/api/account/forgot-password", {
      email: "mallory@example.com",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      message:
        "若该邮箱已注册，重置链接已生成，但本站未配置邮件发送，无法投递，请联系管理员",
    });
    expect(res.json().message).not.toContain("已发送");
  });

  it("忘记密码：不存在的邮箱返回同一文案", async () => {
    const res = await unconfiguredPost("/api/account/forgot-password", {
      email: "ghost@example.com",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      message:
        "若该邮箱已注册，重置链接已生成，但本站未配置邮件发送，无法投递，请联系管理员",
    });
  });

  it("重发验证：未验证用户返回不谎报的文案", async () => {
    const register = await unconfiguredPost("/api/account/register", {
      username: "nina",
      email: "nina@example.com",
      password: "Test123!@#456",
      displayName: "nina",
    });
    expect(register.statusCode).toBe(201);
    unconfiguredCaptured.length = 0;
    const res = await unconfiguredPost("/api/account/resend-verification", {
      email: "nina@example.com",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      message:
        "若该邮箱已注册且未验证，验证邮件无法发送：本站未配置邮件发送，请联系管理员",
    });
    expect(res.json().message).not.toContain("已发送");
    expect(unconfiguredCaptured).toHaveLength(0);
  });
});
