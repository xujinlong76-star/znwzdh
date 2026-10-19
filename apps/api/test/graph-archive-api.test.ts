import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

describe("Stage 3 & 4: Graph Mesh & Offline Archive API", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let createdSiteId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-test-graph-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      embedding: {
        model: "Xenova/bge-small-zh-v1.5",
        endpoint: "https://hf-mirror.com",
        dtype: "q8",
        cacheDir: join(dir, "models"),
        dim: 512,
        enabled: false,
      },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
      fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
    });

    ctx = await createContext(config);
    app = await buildServer(ctx);
    await app.ready();

    // 预置分类
    const cat1 = await ctx.repo.createCategory({
      title: "开发运维",
      slug: "devops",
      description: "DevOps & Cloud",
    });

    const cat2 = await ctx.repo.createCategory({
      title: "前端开发",
      slug: "frontend",
      description: "Frontend & Web",
    });

    const site1 = await ctx.repo.createSite({
      title: "GitHub Official",
      url: "https://github.com",
      description: "Code hosting platform",
      categoryId: cat1.id,
      tags: ["git", "devops"],
    });
    createdSiteId = site1.id;

    await ctx.repo.createSite({
      title: "GitHub Mirror",
      url: "https://www.github.com",
      description: "Code hosting mirror",
      categoryId: cat2.id,
      tags: ["git", "mirror"],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/graph/mesh 应返回完整的拓扑星图结构", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/graph/mesh",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nodes).toBeDefined();
    expect(body.edges).toBeDefined();
    expect(body.stats).toBeDefined();
    expect(body.stats.categoryCount).toBeGreaterThanOrEqual(2);
    expect(body.stats.siteCount).toBeGreaterThanOrEqual(2);

    // 验证包含 category / site / tag 三种节点类型
    const types = new Set(body.nodes.map((n: any) => n.type));
    expect(types.has("category")).toBe(true);
    expect(types.has("site")).toBe(true);
    expect(types.has("tag")).toBe(true);
  });

  it("GET /api/graph/path 应支持 start/target 和 from/to 寻路", async () => {
    const res1 = await app.inject({
      method: "GET",
      url: "/api/graph/path?start=react&target=nextjs",
    });

    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.ok).toBe(true);
    expect(body1.result).toBeDefined();

    const res2 = await app.inject({
      method: "GET",
      url: "/api/graph/path?from=vue&to=nuxt",
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.ok).toBe(true);
  });

  it("GET /api/sites/duplicates 应检测并报告潜在冗余站点", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sites/duplicates",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scannedCount).toBeGreaterThanOrEqual(2);
    expect(body.duplicatePairs).toBeInstanceOf(Array);
    // GitHub Official 与 GitHub Mirror 属于同域名跨分类，应该被检出
    expect(body.duplicatePairs.length).toBeGreaterThanOrEqual(1);
    const pair = body.duplicatePairs[0];
    expect(pair.recommendation).toBeDefined();
    expect(pair.similarity).toBeGreaterThan(0.7);
  });

  it("GET /api/sites/:id/archive 应能生成或读取离线快照", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sites/${createdSiteId}/archive`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.siteId).toBe(createdSiteId);
    expect(body.htmlContent).toContain("GitHub Official");
    expect(body.byteSize).toBeGreaterThan(0);
    expect(body.readTimeMinutes).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/sites/:id/archive 应能触发离线快照抓取并持久化", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/sites/${createdSiteId}/archive`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.siteId).toBe(createdSiteId);
    expect(body.capturedAt).toBeGreaterThan(0);
  });
});
