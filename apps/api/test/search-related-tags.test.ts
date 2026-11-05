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
  dir = mkdtempSync(join(tmpdir(), "navhub-search-related-"));
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

  const cat = await ctx.repo.createCategory({ title: "技术栈" });
  await ctx.repo.createSite({
    url: "https://react-doc.test",
    title: "React 文档",
    description: "React 官方中文文档",
    categoryId: cat.id,
    tags: ["React", "UI", "前端"],
    status: "active",
  });
  await ctx.repo.createSite({
    url: "https://react-router.test",
    title: "React Router",
    description: "React 路由库指南",
    categoryId: cat.id,
    tags: ["React", "路由", "前端"],
    status: "active",
  });
  await ctx.repo.createSite({
    url: "https://vue-doc.test",
    title: "Vue 框架",
    description: "渐进式 JavaScript 框架",
    categoryId: cat.id,
    tags: ["Vue", "前端"],
    status: "active",
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/search 返回相关高频标签 (relatedTags)", () => {
  it("搜索关键字命中时返回相关标签聚合列表", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=React" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.hits.length).toBeGreaterThan(0);
    expect(json.relatedTags).toBeDefined();
    expect(Array.isArray(json.relatedTags)).toBe(true);

    const tagNames = json.relatedTags.map((t: { name: string }) => t.name);
    expect(tagNames).toContain("react");
    expect(tagNames).toContain("前端");

    const reactTag = json.relatedTags.find((t: { name: string }) => t.name === "react");
    expect(reactTag).toBeDefined();
    expect(reactTag.count).toBe(2);
  });
});
