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

  // U-85：单字查询的 relation 补救只对 CJK 单字放行。先给 Cursor 挂一条目标含
  // “图”的关系（PUT 会替换该站点的全部关系，放在既有 relationHits 用例之后，
  // 不影响前面的 Continue.dev 断言）。
  it("GET /api/search?q=图 单字 CJK 返回 relationHits", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/sites/${site1Id}/relations`,
      payload: {
        relations: [
          {
            targetTitle: "图怪兽",
            targetUrl: "https://tumonster.example.com",
            relationType: "alternative",
            isFreeOrOpenSource: false,
            note: "在线作图工具",
          },
        ],
      },
    });
    expect(putRes.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=%E5%9B%BE",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.relationHits).toBeDefined();
    expect(Array.isArray(body.relationHits)).toBe(true);
    expect(body.relationHits.length).toBeGreaterThanOrEqual(1);
    expect(body.relationHits.length).toBeLessThanOrEqual(3);
    for (const hit of body.relationHits) {
      expect(hit.sourceSite).toBeDefined();
      expect(hit.sourceSite.enabled).toBe(true);
      expect(
        String(hit.targetTitle ?? "").includes("图") || String(hit.targetUrl ?? "").includes("图")
      ).toBe(true);
    }
    expect(body.relationHits.some((h: any) => h.targetTitle === "图怪兽")).toBe(true);
  });

  // U-85：单拉丁字母 / 数字仍不走 relation——空结果时 relationHits 字段整个省略
  // （search.ts :267 的既有语义），比返回无关 alternative 更可信。
  it.each(["e", "a", "1"])("GET /api/search?q=%s 单字非 CJK 无 relationHits 字段", async (q) => {
    const res = await app.inject({
      method: "GET",
      url: `/api/search?q=${q}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.relationHits).toBeUndefined();
  });

  // U-85：'%' / '_' 经 containsLike 转义，不命中全表。
  it.each(["%25", "_"])("GET /api/search?q=%s 通配符不命中全表", async (q) => {
    const res = await app.inject({
      method: "GET",
      url: `/api/search?q=${q}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.relationHits).toBeUndefined();
  });
});

