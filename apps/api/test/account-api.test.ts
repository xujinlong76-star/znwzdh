/**
 * 账号生命周期 API 测试（注册 / 验证 / 登录 / 找回 / 重置）。
 *
 * 邮件投递在测试里用「捕获式假发送器」替代：真实 SMTP 不可用于单测，
 * 而验证/重置令牌只出现在邮件正文里，必须捕获才能驱动后续流程。
 * 这同时验证了「令牌只经邮件传递、库里只存哈希」的链路。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import type { MailMessage, MailResult, MailTransport } from "@navhub/ai";

const dir = mkdtempSync(join(tmpdir(), "navhub-account-"));
const base = {
  mode: "lite" as const,
  embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
  fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
/** 捕获到的邮件（用于取出验证/重置令牌） */
const captured: MailMessage[] = [];

beforeAll(async () => {
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "account.db") }));
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
  const match = message.text.match(new RegExp(`${label}[^\\s]*token=([A-Za-z0-9_-]+)`));
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

  it("重复注册返回 409", async () => {
    const res = await post("/api/account/register", {
      username: "alice2",
      email: "alice@example.com",
      password: "S3cret-Passw0rd!",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("邮箱");
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
    expect((await post("/api/account/verify-email", { token })).statusCode).toBe(200);
    expect((await post("/api/account/verify-email", { token })).statusCode).toBe(400);
  });

  it("登录：正确口令返回用户，错误口令 401", async () => {
    await post("/api/account/register", {
      username: "dave",
      email: "dave@example.com",
      password: "S3cret-Passw0rd!",
    });
    const ok = await post("/api/account/login", { identifier: "dave@example.com", password: "S3cret-Passw0rd!" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe("dave@example.com");

    const bad = await post("/api/account/login", { identifier: "dave@example.com", password: "wrong" });
    expect(bad.statusCode).toBe(401);

    const missing = await post("/api/account/login", { identifier: "nobody@example.com", password: "x" });
    expect(missing.statusCode).toBe(401);
  });

  it("忘记密码：无论邮箱是否存在都返回同一文案", async () => {
    captured.length = 0;
    const existing = await post("/api/account/forgot-password", { email: "dave@example.com" });
    const unknown = await post("/api/account/forgot-password", { email: "ghost@example.com" });
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

    const res = await post("/api/account/reset-password", { token, password: "NewPassw0rd!" });
    expect(res.statusCode).toBe(200);

    const login = await post("/api/account/login", { identifier: "erin@example.com", password: "NewPassw0rd!" });
    expect(login.statusCode).toBe(200);

    const oldLogin = await post("/api/account/login", { identifier: "erin@example.com", password: "OldPassw0rd!" });
    expect(oldLogin.statusCode).toBe(401);
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
    expect((await post("/api/account/reset-password", { token, password: "NewPassw0rd!" })).statusCode).toBe(200);
    expect((await post("/api/account/reset-password", { token, password: "Another1!" })).statusCode).toBe(400);
  });

  it("邮箱状态查询", async () => {
    const res = await app.inject({ method: "GET", url: "/api/account/email-status?email=bob@example.com" });
    expect(res.statusCode).toBe(200);
    expect(res.json().verified).toBe(true);

    const unknown = await app.inject({ method: "GET", url: "/api/account/email-status?email=ghost@example.com" });
    expect(unknown.json().registered).toBe(false);
  });
});
