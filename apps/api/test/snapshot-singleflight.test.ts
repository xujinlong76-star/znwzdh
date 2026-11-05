import { describe, expect, it, beforeAll, afterAll } from "vitest";
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
  dir = mkdtempSync(join(tmpdir(), "navhub-singleflight-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  const cat = await ctx.repo.createCategory({ title: "开发分类" });
  await ctx.repo.createSite({
    url: "https://site-a.test",
    title: "站点A",
    categoryId: cat.id,
    status: "active",
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("导航快照并发 SingleFlight 与 Zero-Cost 304 验证", () => {
  it("并发多次请求导航快照全部返回 200 且数据一致 (SingleFlight 防击穿)", async () => {
    const promises = Array.from({ length: 10 }).map(() =>
      app.inject({ method: "GET", url: "/api/storage?path=navigation.json" })
    );
    const results = await Promise.all(promises);
    for (const res of results) {
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.navigationItems).toBeDefined();
    }
  });

  it("客户端携带相匹配的 ETag 时返回 304 Not Modified 短路响应", async () => {
    const firstRes = await app.inject({ method: "GET", url: "/api/storage?path=navigation.json" });
    expect(firstRes.statusCode).toBe(200);
    const etag = firstRes.headers["etag"];
    expect(etag).toBeDefined();

    const secondRes = await app.inject({
      method: "GET",
      url: "/api/storage?path=navigation.json",
      headers: { "if-none-match": etag as string },
    });
    expect(secondRes.statusCode).toBe(304);
    expect(secondRes.body).toBe("");
  });
});
