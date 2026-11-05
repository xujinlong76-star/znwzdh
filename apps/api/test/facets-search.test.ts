/**
 * 分面管线端到端：受控词表 -> /api/facets 分布 -> /api/search 正交筛选
 *
 * 这条测试要钉住三件事：
 * 1. 分面分布按作用域统计（分类内只给该分类可命中的选项）；
 * 2. 组合分面筛选真的收窄结果（不是全量返回）；
 * 3. 非法分面值不静默变成「不筛选」。
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
let categoryId: string;
let openToolId: string;
let saasToolId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-facets-"));
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

  const cat = await ctx.repo.createCategory({ title: "开发工具" });
  categoryId = cat.id;
  const openTool = await ctx.repo.createSite({
    url: "https://opensource-tool.test",
    title: "开源工具",
    description: "开源免费的开发工具",
    categoryId: cat.id,
    tags: ["开源", "开发工具"],
    status: "active",
  });
  const saasTool = await ctx.repo.createSite({
    url: "https://saas-tool.test",
    title: "商业 SaaS 工具",
    description: "付费在线服务",
    categoryId: cat.id,
    tags: ["SaaS", "商业"],
    status: "active",
  });
  // 用真实 id 写分面：setSiteFacets 不校验站点存在性，传 URL 会写进一行不存在
  // 的 site_id，再被 listFacetsSummary 的 sites JOIN 过滤掉——等于测了个空集。
  openToolId = openTool.id;
  saasToolId = saasTool.id;
  await ctx.repo.setSiteFacets(openTool.id, {
    pricing: ["open_source", "free"],
    platform: ["web"],
    form: ["self_hosted", "cli"],
  });
  await ctx.repo.setSiteFacets(saasTool.id, {
    pricing: ["paid", "freemium"],
    platform: ["web", "ios"],
    form: ["saas"],
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

function hitIds(json: unknown): string[] {
  const hits = (json as { hits?: Array<{ site?: { id?: string } | null }> })?.hits ?? [];
  return hits.map((h) => h.site?.id ?? "").filter(Boolean).sort();
}

describe("GET /api/facets 分布", () => {
  it("返回受控词表定义，并按作用域给出带计数的选项", async () => {
    const res = await app.inject({ method: "GET", url: "/api/facets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.definitions.some((d: { key: string }) => d.key === "pricing")).toBe(true);

    const pricing = body.facets.find((f: { key: string }) => f.key === "pricing");
    const openSource = pricing.options.find((o: { value: string }) => o.value === "open_source");
    expect(openSource.count).toBe(1);
    const paid = pricing.options.find((o: { value: string }) => o.value === "paid");
    expect(paid.count).toBe(1);
  });

  it("分类作用域只统计该分类内的站点", async () => {
    const all = await app.inject({ method: "GET", url: "/api/facets" });
    const scoped = await app.inject({ method: "GET", url: "/api/facets?categoryId=" + encodeURIComponent(categoryId) });
    expect(scoped.statusCode).toBe(200);
    const openSourceAll = all.json().facets.find((f: { key: string }) => f.key === "pricing").options.find((o: { value: string }) => o.value === "open_source").count;
    const openSourceScoped = scoped.json().facets.find((f: { key: string }) => f.key === "pricing").options.find((o: { value: string }) => o.value === "open_source").count;
    expect(openSourceScoped).toBeLessThanOrEqual(openSourceAll);
    expect(openSourceScoped).toBe(1);
  });
});

describe("/api/search 分面筛选", () => {
  it("单选维度筛选只返回该值站点", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=&status=active&limit=50&facets=" + encodeURIComponent(JSON.stringify({ pricing: ["open_source"] })) });
    expect(res.statusCode).toBe(200);
    const ids = hitIds(res.json());
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(openToolId);
  });

  it("多维组合筛选 = 各维度交集", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=&status=active&limit=50&facets=" + encodeURIComponent(JSON.stringify({ pricing: ["open_source"], form: ["self_hosted"] })) });
    expect(res.statusCode).toBe(200);
    const ids = hitIds(res.json());
    expect(ids).toHaveLength(1);

    const missing = await app.inject({ method: "GET", url: "/api/search?q=&status=active&limit=50&facets=" + encodeURIComponent(JSON.stringify({ pricing: ["open_source"], form: ["saas"] })) });
    expect(hitIds(missing.json())).toEqual([]);

    const solo = await app.inject({ method: "GET", url: "/api/search?q=&status=active&limit=50&facets=" + encodeURIComponent(JSON.stringify({ form: ["saas"] })) });
    expect(hitIds(solo.json())).toEqual([saasToolId]);
  });

  it("未知分面值 = 零结果（筛选真的生效，不是静默放行全量）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=&status=active&limit=50&facets=" + encodeURIComponent(JSON.stringify({ pricing: ["__nonexistent__"] })) });
    // 中枢只 clamp 预算、不校验受控词表（值可以由业务自定义），所以正确行为是
    // 「按这个值过滤 → 没人命中 → 空集」，而不是 400 或返回未筛选的全量。
    expect(res.statusCode).toBe(200);
    expect(hitIds(res.json())).toHaveLength(0);
  });

  it("没有分面条件时返回全部（不误伤正常检索）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=&status=active&limit=50" });
    expect(res.statusCode).toBe(200);
    expect(hitIds(res.json())).toHaveLength(2);
  });
});
