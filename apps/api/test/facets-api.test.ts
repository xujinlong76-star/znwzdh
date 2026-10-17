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
let catId: string;
let siteId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-facets-api-test-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const c = await ctx.repo.createCategory({ title: "分面测试分类" });
  catId = c.id;

  const s = await ctx.repo.createSite({
    url: "https://example.com/site-1",
    title: "测试站点 1",
    categoryId: catId,
    status: "active",
    facets: {
      pricing: ["free"],
      platform: ["web", "ios"],
      form: ["saas"],
      language: ["zh"],
      scene: ["dev"],
    },
  });
  siteId = s.id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Facets API & Filtering", () => {
  it("GET /api/facets 返回标准受控分面定义与分布频次", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/facets",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.definitions)).toBe(true);
    expect(body.definitions.length).toBe(5);

    const pricing = body.facets.find((f: any) => f.key === "pricing");
    expect(pricing).toBeDefined();
    const freeOpt = pricing.options.find((o: any) => o.value === "free");
    expect(freeOpt).toBeDefined();
    expect(freeOpt.count).toBe(1);
  });

  it("GET /api/sites/:id/facets & PUT /api/sites/:id/facets 更新站点分面", async () => {
    // 读现有分面
    const getRes = await app.inject({
      method: "GET",
      url: `/api/sites/${siteId}/facets`,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().facets.pricing).toEqual(["free"]);

    // 更新分面
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/sites/${siteId}/facets`,
      payload: {
        facets: {
          pricing: ["paid"],
          platform: ["web", "macos"],
        },
      },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().facets.pricing).toEqual(["paid"]);

    // 验证读回
    const verifyRes = await app.inject({
      method: "GET",
      url: `/api/sites/${siteId}`,
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().facets.pricing).toEqual(["paid"]);
    expect(verifyRes.json().facets.platform).toContain("macos");
  });

  it("GET /api/sites?facets=... 支持 JSON 参数分面过滤", async () => {
    // 构造另一个免费站点
    await ctx.repo.createSite({
      url: "https://example.com/site-free",
      title: "免费工具",
      categoryId: catId,
      status: "active",
      facets: {
        pricing: ["free"],
        platform: ["web"],
      },
    });

    const resPaid = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ pricing: ["paid"] }))}`,
    });
    expect(resPaid.statusCode).toBe(200);
    const sites = resPaid.json();
    expect(sites.length).toBe(1);
    expect(sites[0].id).toBe(siteId);

    const resFree = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ pricing: ["free"] }))}`,
    });
    expect(resFree.statusCode).toBe(200);
    expect(resFree.json().length).toBe(1);
    expect(resFree.json()[0].title).toBe("免费工具");
  });

  it("POST /api/search 支持 facets 过滤检索", async () => {
    const searchRes = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: {
        q: "工具",
        facets: { pricing: ["free"] },
      },
    });
    expect(searchRes.statusCode).toBe(200);
    const hits = searchRes.json().hits;
    expect(hits.length).toBe(1);
    expect(hits[0].site.title).toBe("免费工具");
  });
});
