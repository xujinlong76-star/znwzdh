import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { CONTROLLED_FACETS, getFacetDefinition } from "@navhub/core";

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
    // 受控维度 5 → 8（batch0-02 新增 requires_account / free_trial / data_export）
    expect(body.definitions.length).toBe(8);
    expect(CONTROLLED_FACETS.length).toBe(8);

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

describe("新分面键 requires_account / free_trial / data_export（batch0-02）", () => {
  it("CONTROLLED_FACETS 有三条新定义，枚举值与方案 §2.2 逐字一致", () => {
    const account = getFacetDefinition("requires_account");
    expect(account).toBeDefined();
    expect(account?.multiselect).toBe(false);
    expect(account?.options.map((o) => o.value)).toEqual(["none", "optional", "required", "unknown"]);

    const trial = getFacetDefinition("free_trial");
    expect(trial?.multiselect).toBe(false);
    expect(trial?.options.map((o) => o.value)).toEqual([
      "none", "trial_7d", "trial_14d", "trial_30d", "trial_other", "unknown",
    ]);

    const exp = getFacetDefinition("data_export");
    expect(exp?.multiselect).toBe(true);
    expect(exp?.options.map((o) => o.value)).toEqual([
      "csv", "json", "pdf", "markdown", "api", "none", "unknown",
    ]);

    // 枚举校验的事实源：非法值不在定义里（PUT /facets 本身不做枚举校验，
    // 见 routes/facets.ts 既有语义；枚举由 PUT /profile 落库时校验）
    expect(account?.options.some((o) => o.value === "maybe")).toBe(false);
    expect(getFacetDefinition("requires_account")).toBeDefined();
  });

  it("PUT /api/sites/:id/facets 新键读写往返，GET /api/facets 下发新定义", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/sites/${siteId}/facets`,
      payload: {
        facets: {
          pricing: ["free"],
          platform: ["web"],
          requires_account: ["none"],
          free_trial: ["trial_14d"],
          data_export: ["csv", "api"],
        },
      },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().facets.requires_account).toEqual(["none"]);
    expect(putRes.json().facets.free_trial).toEqual(["trial_14d"]);
    expect(putRes.json().facets.data_export).toEqual(["csv", "api"]);

    const getRes = await app.inject({
      method: "GET",
      url: `/api/sites/${siteId}/facets`,
    });
    expect(getRes.json().facets.requires_account).toEqual(["none"]);
    // getSiteFacets 按 facet_value 字母序返回，与写入顺序无关
    expect(getRes.json().facets.data_export).toEqual(["api", "csv"]);

    const defsRes = await app.inject({ method: "GET", url: "/api/facets" });
    const keys = defsRes.json().definitions.map((d: any) => d.key);
    expect(keys).toContain("requires_account");
    expect(keys).toContain("free_trial");
    expect(keys).toContain("data_export");

    // 新键参与过滤：按 requires_account=none 能筛到本站
    const filtered = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ requires_account: ["none"] }))}`,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().map((s: { id: string }) => s.id)).toContain(siteId);
  });

  it("8 个受控维一次 PUT 全部放行（FACET_MAX_KEYS=20 预算内）", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/sites/${siteId}/facets`,
      payload: {
        facets: {
          pricing: ["free"],
          platform: ["web"],
          form: ["saas"],
          language: ["zh"],
          scene: ["dev"],
          requires_account: ["optional"],
          free_trial: ["trial_7d"],
          data_export: ["json"],
        },
      },
    });
    expect(putRes.statusCode).toBe(200);
    expect(Object.keys(putRes.json().facets)).toHaveLength(8);
  });
});
