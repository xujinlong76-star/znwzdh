/**
 * `/api/v1` 版本前缀别名（升级方案 P2「统一错误包络与版本」）。
 *
 * 实现是路由前的 URL 重写，不是复制一套路由：两套路径必须共享同一份
 * scope 策略、缓存头与错误包络。这里钉住「等价」与「未知版本不重写」两侧。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-v1-alias-"));
  ctx = await createContext(loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubV1Test/0.1" },
    corsOrigins: ["*"],
  } as never));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/v1 版本前缀", () => {
  it("健康探针：v1 与旧路径返回同一份结果", async () => {
    const [v1, legacy] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/health" }),
      app.inject({ method: "GET", url: "/api/health" }),
    ]);
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ ok: true, mode: legacy.json().mode });
    expect(v1.headers["x-request-id"]).toBeTruthy();
  });

  it("查询串与缓存头原样穿过重写（不是另起一套路由）", async () => {
    const [v1, legacy] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/sites?limit=1" }),
      app.inject({ method: "GET", url: "/api/sites?limit=1" }),
    ]);
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toEqual(legacy.json());
    expect(v1.headers["cache-control"]).toBe(legacy.headers["cache-control"]);
    expect(String(v1.headers["cache-control"])).toContain("max-age=60");
  });

  it("鉴权 scope 不变：受保护路由两套路径同状态", async () => {
    const [v1, legacy] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/storage/list" }),
      app.inject({ method: "GET", url: "/api/storage/list" }),
    ]);
    expect(v1.statusCode).toBe(legacy.statusCode);
  });

  it("未知版本前缀不重写：/api/v2/health 仍走 404 包络", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v2/health" });
    expect(res.statusCode).toBe(404);
    expect(res.json().requestId).toBeTruthy();

    const bare = await app.inject({ method: "GET", url: "/api/v1" });
    expect(bare.statusCode).toBe(404);
  });
});
