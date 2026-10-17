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
let catAId: string;
let catBId: string;
let site1Id: string;
let site2Id: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-semantic-api-test-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const catA = await ctx.repo.createCategory({
    title: "AI 与认知智能",
    titleEn: "Artificial Intelligence",
    altLabels: ["AI", "大模型", "LLM"],
  });
  catAId = catA.id;

  const catB = await ctx.repo.createCategory({
    title: "开发生产力",
    titleEn: "Dev Productivity",
    altLabels: ["DevOps", "效能"],
    relatedCategories: [catAId],
  });
  catBId = catB.id;

  const s1 = await ctx.repo.createSite({
    url: "https://cursor.com",
    title: "Cursor",
    categoryId: catBId,
  });
  site1Id = s1.id;

  const s2 = await ctx.repo.createSite({
    url: "https://continue.dev",
    title: "Continue.dev",
    categoryId: catBId,
  });
  site2Id = s2.id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Taxonomy Phase 3: Semantic API & Site Relations", () => {
  it("GET /api/categories/skos 返回标准 W3C SKOS 概念集合", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/categories/skos",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);

    const catAConcept = body.find((c: any) => c.id === catAId);
    expect(catAConcept).toBeDefined();
    expect(catAConcept["@type"]).toBe("Concept");
    expect(catAConcept.prefLabel.zh).toBe("AI 与认知智能");
    expect(catAConcept.altLabel).toContain("大模型");
  });

  it("GET /api/categories/:id/related 返回相关概念分类及统计", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/categories/${catBId}/related`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.category.id).toBe(catBId);
    expect(Array.isArray(body.related)).toBe(true);
    expect(body.related.length).toBe(1);
    expect(body.related[0].id).toBe(catAId);
    expect(body.related[0].title).toBe("AI 与认知智能");
  });

  it("PATCH /api/categories/:id 更新 altLabels 与 relatedCategories", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/categories/${catAId}`,
      payload: {
        altLabels: ["AI", "大模型", "AIGC", "AGI"],
        relatedCategories: [catBId],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.altLabels).toContain("AIGC");
    expect(body.relatedCategories).toContain(catBId);
  });

  it("GET /api/relations/types 返回支持的实体关系元数据", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/relations/types",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.types)).toBe(true);
    expect(body.types.some((t: any) => t.type === "alternative" && t.symmetric)).toBe(true);
    expect(body.types.some((t: any) => t.type === "part_of" && !t.symmetric)).toBe(true);
  });

  it("PUT & GET /api/sites/:id/relations 设置与读取站点双向实体关系", async () => {
    // 1. 设置 Cursor 的关系：平替 Continue.dev
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/sites/${site1Id}/relations`,
      payload: {
        relations: [
          {
            targetTitle: "Continue.dev",
            targetUrl: "https://continue.dev",
            relationType: "alternative",
            isFreeOrOpenSource: true,
            note: "开源平替代码插件",
          },
        ],
      },
    });

    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json();
    expect(putBody.ok).toBe(true);
    expect(putBody.total).toBe(1);

    // 2. 从 Continue.dev 角度查询，验证反向感知
    const getRes = await app.inject({
      method: "GET",
      url: `/api/sites/${site2Id}/relations`,
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.incoming.length).toBe(1);
    expect(getBody.all.some((r: any) => r.targetUrl === "https://cursor.com")).toBe(true);
  });

  it("GET /api/sites/:id/graph 返回站点的局部知识图谱 (Ego-Graph)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sites/${site1Id}/graph`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.centerSiteId).toBe(site1Id);
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.nodes.some((n: any) => n.id === site1Id && n.isCenter)).toBe(true);
    expect(body.nodes.some((n: any) => n.id === site2Id)).toBe(true);
    expect(body.edges.some((e: any) => e.relationType === "alternative")).toBe(true);
  });

  it("GET /api/search 携带知识图谱对标方案 (relationHits)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=continue",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.relationHits).toBeDefined();
    expect(Array.isArray(body.relationHits)).toBe(true);
    expect(body.relationHits.length).toBeGreaterThan(0);
    expect(body.relationHits[0].targetTitle).toBe("Continue.dev");
    expect(body.relationHits[0].sourceSiteId).toBe(site1Id);
    expect(body.relationHits[0].sourceSite).toBeDefined();
    expect(body.relationHits[0].sourceSite.title).toBe("Cursor");
  });
});

