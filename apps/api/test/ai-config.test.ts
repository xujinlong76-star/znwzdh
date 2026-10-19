/**
 * AI 模型配置接口测试（系统级 + 用户级四级解析链）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGNES_BASE_URL, AGNES_MODEL } from "@navhub/ai";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-ai-config-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { required: false },
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
    },
    llm: {
      name: "Agnes 3.0 Flash",
      baseUrl: AGNES_BASE_URL,
      apiKey: null,
      model: AGNES_MODEL,
      timeoutMs: 5000,
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
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("AI 模型配置管理端接口（/api/admin/ai/config）", () => {
  it("默认返回内置 Agnes 3.0 Flash 配置，且 source 为 default", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/ai/config",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.effective.source).toBe("default");
    expect(data.effective.model).toBe(AGNES_MODEL);
    expect(data.effective.hasApiKey).toBe(false);
    expect(data.config.model).toBe(AGNES_MODEL);
    expect(data.config.baseUrl).toBe(AGNES_BASE_URL);
  });

  it("保存系统级配置并加密落库，返回掩码密钥与 system 来源", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/admin/ai/config",
      payload: {
        name: "自定义 Agnes",
        baseUrl: "https://api.agnes-ai.cn/v1",
        model: "agnes-3.0-flash",
        apiKey: "sk-agnes-secret-1234567890",
        timeoutMs: 8000,
        temperature: 0.1,
      },
    });
    expect(putRes.statusCode).toBe(200);
    const putData = putRes.json();
    expect(putData.config.hasApiKey).toBe(true);
    expect(putData.config.apiKeyMasked).toContain("****");
    expect(putData.config.apiKeyMasked).not.toContain("secret");

    const getRes = await app.inject({
      method: "GET",
      url: "/api/admin/ai/config",
    });
    const getData = getRes.json();
    expect(getData.effective.source).toBe("system");
    expect(getData.effective.hasApiKey).toBe(true);
  });

  it("重置系统级配置恢复默认", async () => {
    const resetRes = await app.inject({
      method: "POST",
      url: "/api/admin/ai/config/reset",
    });
    expect(resetRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/api/admin/ai/config",
    });
    const getData = getRes.json();
    expect(getData.effective.source).toBe("default");
  });

  it("测试连通性：SSRF 拦截私网地址", async () => {
    const testRes = await app.inject({
      method: "POST",
      url: "/api/admin/ai/config/test",
      payload: {
        baseUrl: "http://127.0.0.1:8000/v1",
        model: "llama3",
        allowPrivateNetwork: false,
      },
    });
    expect(testRes.statusCode).toBe(400);
    const body = testRes.json();
    expect(body.error).toContain("受保护网段");
  });
});

describe("AI 模型用户级个人配置接口（/api/user/ai/config）", () => {
  it("无个人配置时 configured 为 false", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/user/ai/config?anonId=test-user-1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.configured).toBe(false);
  });

  it("保存个人配置并按身份隔离与生效", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/user/ai/config?anonId=test-user-1",
      payload: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: "sk-user-test-token-abcdef",
      },
    });
    expect(putRes.statusCode).toBe(200);
    const saved = putRes.json().config;
    expect(saved.configured).toBe(true);
    expect(saved.model).toBe("gpt-4o-mini");
    expect(saved.hasApiKey).toBe(true);

    // 另一个用户不受影响
    const otherRes = await app.inject({
      method: "GET",
      url: "/api/user/ai/config?anonId=test-user-2",
    });
    expect(otherRes.json().config.configured).toBe(false);

    // 删除个人配置
    const delRes = await app.inject({
      method: "DELETE",
      url: "/api/user/ai/config?anonId=test-user-1",
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().config.configured).toBe(false);

    const getRes = await app.inject({
      method: "GET",
      url: "/api/user/ai/config?anonId=test-user-1",
    });
    expect(getRes.json().config.configured).toBe(false);
  });
});
