/**
 * AI 模型配置 API 集成测试（网关/解析链口径）。
 *
 * 说明：与 ai-config.test.ts 互为补充；本文件聚焦「加密落库、密钥更新语义、
 * SSRF、能力位、身份隔离与真实解析链」，不依赖任何外部网络。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { SYSTEM_LLM_CONFIG_KEY, resolveLlm } from "../src/llm-config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const ADMIN = "/api/admin/ai/config";
const ADMIN_TEST = "/api/admin/ai/config/test";
const USER = "/api/user/ai/config";

/** 公网 IP 字面量：SSRF 校验无需 DNS，也不会真的发请求（除非显式测试连通性） */
const PUBLIC_URL = "http://93.184.216.34/v1";
const LOOPBACK_URL = "http://127.0.0.1:9/v1";

const ENV_KEY = "sk-env-placeholder-1234";
const SYSTEM_KEY = "sk-plain-secret-9876";
const USER_KEY = "sk-user-secret-0001";

const H_A = { "x-navhub-anon-id": "anon-test-a" };
const H_B = { "x-navhub-anon-id": "anon-test-b" };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-ai-config-api-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "ai.db"),
    embedding: { enabled: false, cacheDir: join(dir, "models") },
    llm: {
      name: "Agnes 3.0 Flash",
      baseUrl: PUBLIC_URL,
      apiKey: ENV_KEY,
      model: "agnes-3.0-flash",
      timeoutMs: 2000,
      allowPrivateNetwork: true,
    },
    fetch: {
      timeoutMs: 2000,
      maxBytes: 262144,
      maxRedirects: 2,
      allowPrivateNetworks: false,
      userAgent: "NavHubTest/0.1",
    },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("系统级配置（管理端）", () => {
  it("无 DB 配置时回退环境变量，密钥只回显掩码", async () => {
    const res = await app.inject({ method: "GET", url: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.config.source).toBe("env");
    expect(body.config.hasApiKey).toBe(true);
    expect(body.config.apiKeyMasked).toBe("sk-****1234");
    expect(body.effective.source).toBe("env");
    expect(JSON.stringify(body)).not.toContain(ENV_KEY);
  });

  it("写入系统配置：密钥加密落库，响应与库内均无明文", async () => {
    const res = await app.inject({
      method: "PUT",
      url: ADMIN,
      payload: {
        enabled: true,
        name: "Agnes 主力",
        baseUrl: PUBLIC_URL,
        model: "agnes-3.0-flash",
        apiKey: SYSTEM_KEY,
        timeoutMs: 5000,
        temperature: 0.1,
        maxTokens: 512,
        jsonMode: "auto",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.config.source).toBe("db");
    expect(body.config.name).toBe("Agnes 主力");
    expect(body.config.apiKeyMasked).toBe("sk-****9876");
    expect(JSON.stringify(body)).not.toContain(SYSTEM_KEY);

    const raw = await ctx.repo.getSystemState<Record<string, unknown>>(SYSTEM_LLM_CONFIG_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.stringify(raw)).not.toContain(SYSTEM_KEY);
    expect(raw?.apiKeyEnc).toBeTruthy();
  });

  it("省略 apiKey 保留原密钥；空串清除密文", async () => {
    let res = await app.inject({
      method: "PUT",
      url: ADMIN,
      payload: { baseUrl: PUBLIC_URL, model: "agnes-3.0-flash" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.apiKeyMasked).toBe("sk-****9876");

    res = await app.inject({
      method: "PUT",
      url: ADMIN,
      payload: { baseUrl: PUBLIC_URL, model: "agnes-3.0-flash", apiKey: "" },
    });
    expect(res.statusCode).toBe(200);
    const raw = await ctx.repo.getSystemState<Record<string, unknown>>(SYSTEM_LLM_CONFIG_KEY);
    expect(raw?.apiKeyEnc).toBeNull();
  });

  it("默认拒绝私网端点（显式关闭放行开关时）", async () => {
    const res = await app.inject({
      method: "PUT",
      url: ADMIN,
      payload: { baseUrl: LOOPBACK_URL, model: "m", allowPrivateNetwork: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ssrf");
  });

  it("enabled=false 视为管理端显式关闭：能力位为 false，重置后恢复", async () => {
    let res = await app.inject({
      method: "PUT",
      url: ADMIN,
      payload: { enabled: false, baseUrl: PUBLIC_URL, model: "agnes-3.0-flash" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.capabilities.llm).toBe(false);

    const got = await app.inject({ method: "GET", url: ADMIN });
    expect(got.json().config.enabled).toBe(false);
    expect(got.json().effective.hasApiKey).toBe(false);

    res = await app.inject({ method: "POST", url: "/api/admin/ai/config/reset" });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.source).toBe("env");
    expect(ctx.capabilities.llm).toBe(true);
  });

  it("重置删除 DB 覆盖", async () => {
    await app.inject({ method: "POST", url: "/api/admin/ai/config/reset" });
    const raw = await ctx.repo.getSystemState(SYSTEM_LLM_CONFIG_KEY);
    expect(raw).toBeNull();
  });

  it("连通性测试：mock 成功返回延迟与回复预览", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "agnes-3.0-flash",
          choices: [{ message: { role: "assistant", content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;
    try {
      const res = await app.inject({
        method: "POST",
        url: ADMIN_TEST,
        payload: { baseUrl: PUBLIC_URL, model: "agnes-3.0-flash" },
      });
      expect(res.statusCode).toBe(200);
      const result = res.json().result;
      expect(result.ok).toBe(true);
      expect(result.replyPreview).toBe("ok");
      expect(result.model).toBe("agnes-3.0-flash");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("连通性测试：端点不可达时给出可读错误而非 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: ADMIN_TEST,
      payload: { baseUrl: LOOPBACK_URL, model: "m", allowPrivateNetwork: true, timeoutMs: 1000 },
    });
    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result.ok).toBe(false);
    expect(result.code).toBe("network");
  });
});

describe("用户级配置（个人设置）", () => {
  it("缺少身份直接 400", async () => {
    const res = await app.inject({ method: "GET", url: USER });
    expect(res.statusCode).toBe(400);
  });

  it("保存后仅本身份可见，删除后回退系统默认", async () => {
    let res = await app.inject({
      method: "PUT",
      url: USER,
      headers: H_A,
      payload: {
        name: "我的 Agnes",
        baseUrl: PUBLIC_URL,
        model: "agnes-3.0-flash",
        apiKey: USER_KEY,
        timeoutMs: 3000,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.configured).toBe(true);
    expect(res.json().config.apiKeyMasked).toBe("sk-****0001");
    expect(JSON.stringify(res.json())).not.toContain(USER_KEY);

    // 身份隔离：B 看不到 A 的配置
    res = await app.inject({ method: "GET", url: USER, headers: H_B });
    expect(res.json().config.configured).toBe(false);

    // 解析链：A 走 user 层
    const resolved = await resolveLlm(ctx, "anon-test-a");
    expect(resolved.source).toBe("user");
    expect(resolved.provider.model).toBe("agnes-3.0-flash");
    expect(resolved.provider.apiKey).toBe(USER_KEY);

    // 删除回退
    res = await app.inject({ method: "DELETE", url: USER, headers: H_A });
    expect(res.json().config.configured).toBe(false);
    const after = await resolveLlm(ctx, "anon-test-a");
    expect(after.source).not.toBe("user");
  });

  it("用户级端点强制禁私网", async () => {
    const res = await app.inject({
      method: "PUT",
      url: USER,
      headers: H_A,
      payload: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ssrf");
  });

  it("无密钥的个人配置被明确拒绝（避免静默失效）", async () => {
    const res = await app.inject({
      method: "PUT",
      url: USER,
      headers: { "x-navhub-anon-id": "anon-test-c" },
      payload: { baseUrl: PUBLIC_URL, model: "agnes-3.0-flash" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("config");
  });
});
