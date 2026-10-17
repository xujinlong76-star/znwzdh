import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("Taxonomy Phase 3: SKOS Categories & Typed Site Relations", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null, repo });
  });

  afterAll(async () => {
    await db.close();
  });

  it("支持类目同义词 altLabels 与跨树关联 relatedCategories 的 CRUD", async () => {
    // 1. 创建主类目与关联类目
    const devCat = await repo.createCategory({
      title: "开发工具",
      titleEn: "Developer Tools",
      altLabels: ["Dev", "编程", "代码工具"],
    });

    const designCat = await repo.createCategory({
      title: "设计灵感",
      titleEn: "Design & Creative",
      altLabels: ["UI", "UX", "设计素材"],
      relatedCategories: [devCat.id],
    });

    expect(devCat.altLabels).toEqual(["Dev", "编程", "代码工具"]);
    expect(designCat.relatedCategories).toEqual([devCat.id]);

    // 2. 读回验证
    const readDev = await repo.getCategory(devCat.id);
    expect(readDev?.altLabels).toContain("编程");

    const readDesign = await repo.getCategory(designCat.id);
    expect(readDesign?.relatedCategories).toContain(devCat.id);

    // 3. 更新类目属性
    const updated = await repo.updateCategory(devCat.id, {
      altLabels: ["Dev", "编程", "研发效能", "Engineering"],
      relatedCategories: [designCat.id],
    });
    expect(updated?.altLabels).toContain("研发效能");
    expect(updated?.relatedCategories).toContain(designCat.id);
  });

  it("getCategoryWithSemantic 解析关联类目并聚合有效站点数", async () => {
    const catAi = await repo.createCategory({ title: "人工智能", altLabels: ["AI", "大模型"] });
    const catDev = await repo.createCategory({
      title: "研发工具",
      relatedCategories: [catAi.id],
    });

    // 为 catAi 创建两个有效站点，一个软删除站点
    await repo.createSite({
      url: "https://chatgpt.com",
      title: "ChatGPT",
      categoryId: catAi.id,
    });
    await repo.createSite({
      url: "https://claude.ai",
      title: "Claude",
      categoryId: catAi.id,
    });
    const s3 = await repo.createSite({
      url: "https://old-ai.com",
      title: "Old AI",
      categoryId: catAi.id,
    });
    await repo.deleteSite(s3.id); // 软删除，不计入有效数

    const semantic = await repo.getCategoryWithSemantic(catDev.id);
    expect(semantic).not.toBeNull();
    expect(semantic?.category.id).toBe(catDev.id);
    expect(semantic?.related.length).toBe(1);
    expect(semantic?.related[0].id).toBe(catAi.id);
    expect(semantic?.related[0].title).toBe("人工智能");
    expect(semantic?.related[0].siteCount).toBe(2);
  });

  it("exportSkosConcepts 导出符合 W3C SKOS 规范的 Concept Scheme", async () => {
    const parent = await repo.createCategory({
      title: "技术框架",
      altLabels: ["Frameworks"],
    });
    const child = await repo.createCategory({
      title: "前端框架",
      parentId: parent.id,
      altLabels: ["Frontend"],
    });

    const skos = await repo.exportSkosConcepts("https://example.com/tax/");
    expect(skos.length).toBeGreaterThanOrEqual(2);

    const parentConcept = skos.find((c) => c.id === parent.id);
    expect(parentConcept?.prefLabel.zh).toBe("技术框架");
    expect(parentConcept?.altLabel).toContain("Frameworks");
    expect(parentConcept?.narrower).toContain(child.id);

    const childConcept = skos.find((c) => c.id === child.id);
    expect(childConcept?.broader).toBe(parent.id);
  });

  it("检索引擎支持按类目 SKOS altLabel 进行分类命中", async () => {
    const cat = await repo.createCategory({
      title: "图形图像",
      altLabels: ["UI/UX", "视觉设计"],
    });

    const site = await repo.createSite({
      url: "https://figma.com",
      title: "Figma",
      categoryId: cat.id,
    });

    // 用分类 altLabel 作为 categoryId 过滤条件搜索
    const res = await search.search({ q: "", categoryId: "视觉设计" });
    const hitIds = res.hits.map((h) => h.siteId);
    expect(hitIds).toContain(site.id);
  });

  it("site_relations 实体关系写入、URL 靶向解析、双向推导与级联清理", async () => {
    const cat = await repo.createCategory({ title: "设计工具" });

    // 1. 创建两个站点：Figma 和 Penpot
    const figma = await repo.createSite({
      url: "https://figma-rel.com",
      title: "Figma Tool",
      categoryId: cat.id,
    });

    const penpot = await repo.createSite({
      url: "https://penpot-rel.app",
      title: "Penpot Tool",
      categoryId: cat.id,
    });

    // 2. 为 Figma 设置平替关系（Penpot 为替代品，只提供 targetUrl，系统自动解析 targetSiteId）
    await repo.setSiteRelations(figma.id, [
      {
        targetTitle: "Penpot Tool",
        targetUrl: "https://penpot-rel.app",
        relationType: "alternative",
        isFreeOrOpenSource: true,
        note: "开源 Web 协同设计平台",
        confidence: 0.95,
      },
    ]);

    // 3. 从 Figma 角度查询
    const figmaRels = await repo.getDetailedSiteRelations(figma.id);
    expect(figmaRels.outgoing.length).toBe(1);
    expect(figmaRels.outgoing[0].targetSiteId).toBe(penpot.id);
    expect(figmaRels.outgoing[0].relationType).toBe("alternative");
    expect(figmaRels.outgoing[0].isFreeOrOpenSource).toBe(true);

    // 4. 从 Penpot 角度查询（对称关系，Penpot 自动感知来自 Figma 的平替反向引用）
    const penpotRels = await repo.getDetailedSiteRelations(penpot.id);
    expect(penpotRels.incoming.length).toBe(1);
    expect(penpotRels.all.some((r) => r.targetUrl === "https://figma-rel.com")).toBe(true);

    // 5. 生成 Figma 的知识图谱 (Ego-Graph)
    const graph = await repo.getSiteKnowledgeGraph(figma.id);
    expect(graph).not.toBeNull();
    expect(graph?.centerSiteId).toBe(figma.id);
    expect(graph?.nodes.some((n) => n.id === figma.id && n.isCenter)).toBe(true);
    expect(graph?.nodes.some((n) => n.id === penpot.id)).toBe(true);
    expect(graph?.edges.length).toBe(1);
    expect(graph?.edges[0].relationType).toBe("alternative");

    // 6. 硬删除 Figma，级联清理 site_relations
    await repo.purgeSite(figma.id);
    const penpotAfterPurge = await repo.getDetailedSiteRelations(penpot.id);
    expect(penpotAfterPurge.incoming.length).toBe(0);
    expect(penpotAfterPurge.all.length).toBe(0);
  });
});
