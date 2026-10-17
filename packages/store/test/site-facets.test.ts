import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("Taxonomy Phase 2: 受控分面属性 (site_facets) 与正交检索", () => {
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

  it("支持在创建与更新站点时维护分面属性 (pricing, platform, form, scene)", async () => {
    const cat = await repo.createCategory({ title: "AI 与开发" });

    // 1. 创建站点时直接注入 facets
    const s1 = await repo.createSite({
      url: "https://cursor.com",
      title: "Cursor",
      description: "AI 代码编辑器",
      categoryId: cat.id,
      facets: {
        pricing: ["freemium"],
        platform: ["macos", "windows", "linux"],
        form: ["desktop"],
        scene: ["dev", "ai"],
      },
    });

    expect(s1.facets).toBeDefined();
    expect(s1.facets?.pricing).toEqual(["freemium"]);
    expect(s1.facets?.platform).toContain("macos");
    expect(s1.facets?.platform).toContain("windows");
    expect(s1.facets?.scene).toContain("dev");
    expect(s1.facets?.scene).toContain("ai");

    // 2. 读回验证 getSite
    const read = await repo.getSite(s1.id);
    expect(read?.facets?.pricing).toEqual(["freemium"]);
    expect(read?.facets?.platform?.sort()).toEqual(["linux", "macos", "windows"]);

    // 3. 更新分面属性 updateSite
    await repo.updateSite(s1.id, {
      facets: {
        pricing: ["paid"],
        platform: ["macos", "windows"],
      },
    });

    const updated = await repo.getSite(s1.id);
    expect(updated?.facets?.pricing).toEqual(["paid"]);
    expect(updated?.facets?.platform?.sort()).toEqual(["macos", "windows"]);
    // 未更新的维度因全量覆盖被清空（符合 setSiteFacets 契约）
    expect(updated?.facets?.form).toBeUndefined();
  });

  it("兼容旧版 workspaces：当未指定 scene 分面时自动映射 workspaces", async () => {
    const cat = await repo.createCategory({ title: "设计资源" });
    const s2 = await repo.createSite({
      url: "https://figma.com",
      title: "Figma",
      categoryId: cat.id,
      workspaces: ["design", "productivity"],
    });

    expect(s2.workspaces).toEqual(["design", "productivity"]);
    expect(s2.facets?.scene).toEqual(["design", "productivity"]);
  });

  it("支持按多分面属性组合正交过滤 (AND across keys, OR within key)", async () => {
    const cat = await repo.createCategory({ title: "工具箱" });

    const siteFreeWeb = await repo.createSite({
      url: "https://example.com/free-web",
      title: "Free Web Tool",
      categoryId: cat.id,
      facets: {
        pricing: ["free"],
        platform: ["web"],
      },
    });

    const siteFreeIos = await repo.createSite({
      url: "https://example.com/free-ios",
      title: "Free iOS Tool",
      categoryId: cat.id,
      facets: {
        pricing: ["free"],
        platform: ["ios"],
      },
    });

    const sitePaidWeb = await repo.createSite({
      url: "https://example.com/paid-web",
      title: "Paid Web Tool",
      categoryId: cat.id,
      facets: {
        pricing: ["paid"],
        platform: ["web"],
      },
    });

    // 1. 单分面过滤：pricing = free -> siteFreeWeb, siteFreeIos
    const freeSites = await repo.listSites({
      facets: { pricing: ["free"] },
    });
    const freeIds = freeSites.map((s) => s.id);
    expect(freeIds).toContain(siteFreeWeb.id);
    expect(freeIds).toContain(siteFreeIos.id);
    expect(freeIds).not.toContain(sitePaidWeb.id);

    // 2. 双分面正交过滤（交集）：pricing = free AND platform = web -> 仅 siteFreeWeb
    const freeWebSites = await repo.listSites({
      facets: {
        pricing: ["free"],
        platform: ["web"],
      },
    });
    const freeWebIds = freeWebSites.map((s) => s.id);
    expect(freeWebIds).toContain(siteFreeWeb.id);
    expect(freeWebIds).not.toContain(siteFreeIos.id);
    expect(freeWebIds).not.toContain(sitePaidWeb.id);

    // 3. 键内 OR（并集）：platform IN (web, ios) AND pricing = free -> siteFreeWeb, siteFreeIos
    const multiPlatformSites = await repo.listSites({
      facets: {
        pricing: ["free"],
        platform: ["web", "ios"],
      },
    });
    const multiPlatformIds = multiPlatformSites.map((s) => s.id);
    expect(multiPlatformIds).toContain(siteFreeWeb.id);
    expect(multiPlatformIds).toContain(siteFreeIos.id);
    expect(multiPlatformIds).not.toContain(sitePaidWeb.id);
  });

  it("检索引擎 SearchEngine 深度支持 facets 过滤", async () => {
    const cat = await repo.createCategory({ title: "搜索引擎与AI" });
    const s1 = await repo.createSite({
      url: "https://chatgpt.com",
      title: "ChatGPT",
      description: "OpenAI 人工智能聊天机器人",
      categoryId: cat.id,
      facets: {
        pricing: ["freemium"],
        platform: ["web", "ios", "android"],
      },
    });
    const s2 = await repo.createSite({
      url: "https://claude.ai",
      title: "Claude",
      description: "Anthropic 人工智能助手",
      categoryId: cat.id,
      facets: {
        pricing: ["paid"],
        platform: ["web"],
      },
    });

    // 搜索 "人工智能" 匹配两者，但带 facets: { pricing: ["freemium"] } 只返回 ChatGPT
    const res = await search.search({
      q: "人工智能",
      facets: { pricing: ["freemium"] },
    });
    const hitIds = res.hits.map((h) => h.siteId);
    expect(hitIds).toContain(s1.id);
    expect(hitIds).not.toContain(s2.id);

    // browse 模式下带 facets 过滤
    const browseRes = await search.search({
      q: "",
      facets: { pricing: ["paid"] },
    });
    const browseIds = browseRes.hits.map((h) => h.siteId);
    expect(browseIds).toContain(s2.id);
    expect(browseIds).not.toContain(s1.id);
  });

  it("分面统计 listFacetsSummary 正确聚合各受控维度分布", async () => {
    const summary = await repo.listFacetsSummary();
    expect(Array.isArray(summary)).toBe(true);

    const pricingFacet = summary.find((f) => f.key === "pricing");
    expect(pricingFacet).toBeDefined();
    expect(pricingFacet?.options.length).toBeGreaterThan(0);

    const freemiumOpt = pricingFacet?.options.find((o) => o.value === "freemium");
    expect(freemiumOpt).toBeDefined();
    expect(freemiumOpt!.count).toBeGreaterThan(0);
  });

  it("硬删除 purgeSite 级联物理清理 site_facets 关联记录", async () => {
    const cat = await repo.createCategory({ title: "临时测试" });
    const site = await repo.createSite({
      url: "https://to-be-purged.example.com",
      title: "Purge Me",
      categoryId: cat.id,
      facets: { pricing: ["free"] },
    });

    const facetsBefore = await repo.getSiteFacets(site.id);
    expect(facetsBefore.pricing).toEqual(["free"]);

    await repo.purgeSite(site.id);

    const facetsAfter = await repo.getSiteFacets(site.id);
    expect(Object.keys(facetsAfter).length).toBe(0);
  });
});
