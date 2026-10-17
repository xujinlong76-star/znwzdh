import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("Search Intelligence: 分面意图、标签检索与同义词扩展", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null, repo });

    const cat = await repo.createCategory({ title: "开发与设计" });

    // 1. 创建带分面属性的开源站点
    const penpot = await repo.createSite({
      url: "https://penpot.app",
      title: "Penpot",
      description: "开源在线原型设计平台",
      categoryId: cat.id,
      tags: ["design", "ui"],
      facets: {
        pricing: ["open_source", "free"],
        platform: ["web"],
      },
    });

    // 2. 创建带 Kubernetes 标签的容器管理站点
    const rancher = await repo.createSite({
      url: "https://rancher.com",
      title: "Rancher Desktop",
      description: "企业级多集群容器管理工具",
      categoryId: cat.id,
      tags: ["kubernetes", "docker"],
      facets: {
        pricing: ["open_source"],
      },
    });

    // 为 kubernetes 创建别名 k8s
    const k8sTag = await repo.resolveTag("kubernetes");
    if (k8sTag) {
      await repo.addTagAlias(k8sTag.id, "k8s");
    }

    // 3. 创建带有 React 标签但标题不含 React 的站点
    await repo.createSite({
      url: "https://nextjs.org",
      title: "Next.js Framework",
      description: "The React Framework for the Web",
      categoryId: cat.id,
      tags: ["react", "frontend"],
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("智能从查询中析取分面意图（例如 '开源 设计' 自动应用 pricing: open_source）", async () => {
    const res = await search.search({ q: "开源 设计" });
    expect(res.inferredFacets).toBeDefined();
    expect(res.inferredFacets?.pricing).toContain("open_source");
    // 成功召回 Penpot
    const hitIds = res.hits.map((h) => h.siteId);
    const penpot = await repo.findSiteByUrl("https://penpot.app");
    expect(hitIds).toContain(penpot?.id);
  });

  it("同义词扩展：搜索标签别名 'k8s' 自动召回打上 'kubernetes' 标签的站点", async () => {
    const res = await search.search({ q: "k8s" });
    expect(res.queryExpansion).toBeDefined();
    expect(res.queryExpansion).toContain("kubernetes");

    const hitIds = res.hits.map((h) => h.siteId);
    const rancher = await repo.findSiteByUrl("https://rancher.com");
    expect(hitIds).toContain(rancher?.id);
  });

  it("精确通道覆盖标签：搜索 'react' 准确定位打有该标签的 Next.js 站点", async () => {
    const res = await search.search({ q: "react" });
    const nextSite = await repo.findSiteByUrl("https://nextjs.org");
    const hitIds = res.hits.map((h) => h.siteId);
    expect(hitIds).toContain(nextSite?.id);
    // 并且 exact 通道被命中
    const hit = res.hits.find((h) => h.siteId === nextSite?.id);
    expect(hit?.contributions.exact).toBeDefined();
  });

  it("零结果智能编辑距离建议 (Did You Mean)", async () => {
    // 搜一个错别字词 'dockr'
    const res = await search.search({ q: "dockr" });
    expect(res.didYouMean).toBeDefined();
    expect(res.didYouMean?.toLowerCase()).toBe("docker");
  });

  it("多词交叉检索（Multi-token Conjunction）：跨字段包含各 token 时成功召回", async () => {
    // Next.js Framework: title 有 Next.js, description 有 React Framework
    const res = await search.search({ q: "next framework" });
    const nextSite = await repo.findSiteByUrl("https://nextjs.org");
    const hitIds = res.hits.map((h) => h.siteId);
    expect(hitIds).toContain(nextSite?.id);
  });

  it("负向关键词过滤（-negation）：排除包含特定词汇的站点", async () => {
    // 搜 docker 正常召回 Rancher Desktop
    const resNormal = await search.search({ q: "docker" });
    const rancher = await repo.findSiteByUrl("https://rancher.com");
    expect(resNormal.hits.map((h) => h.siteId)).toContain(rancher?.id);

    // 加上负向过滤词 -desktop 之后，排除 Rancher Desktop
    const resEx = await search.search({ q: "docker -desktop" });
    expect(resEx.excludedTerms).toEqual(["desktop"]);
    expect(resEx.hits.map((h) => h.siteId)).not.toContain(rancher?.id);
  });

  it("高级 #tag 算子检索：精准过滤指定标签的站点", async () => {
    const res = await search.search({ q: "#design 在线" });
    expect(res.inferredTag).toBe("design");
    const penpot = await repo.findSiteByUrl("https://penpot.app");
    expect(res.hits.map((h) => h.siteId)).toContain(penpot?.id);
  });
});
