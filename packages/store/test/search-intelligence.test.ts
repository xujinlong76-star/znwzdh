import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";
import { hashSiteId, MemoryVectorStore } from "../src/vector/index.ts";

describe("Search Intelligence: 分面意图、标签检索与同义词扩展", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;
  let catId: string;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null, repo });

    const cat = await repo.createCategory({ title: "开发与设计" });
    catId = cat.id;

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

  it("只有语义近邻时也给纠错建议：didYouMean 不被语义通道遮蔽，词表覆盖标题里的英文词元", async () => {
    // 旧实现只在「零候选」时算纠错，而语义 KNN 对任何输入都有近邻——
    // 带向量库的生产环境里这个功能永远不可达，拼错的词只会得到一批「最像的」站点。
    const pg = await repo.createSite({
      url: "https://postgresql.example.com",
      title: "PostgreSQL 官方文档",
      description: "开源关系型数据库",
      categoryId: catId,
    });
    const vectors = new MemoryVectorStore(2);
    await vectors.upsert([{ key: hashSiteId(pg.id), siteId: pg.id, vector: new Float32Array([1, 0]) }]);
    const semantic = new SearchEngine({
      db,
      repo,
      fts: null,
      vectors,
      embed: async () => new Float32Array([1, 0]),
    });
    const res = await semantic.search({ q: "postgress", limit: 5, disablePersonal: true });
    // 语义通道照常给出近邻（不改现有召回行为）
    expect(res.hits.map((h) => h.siteId)).toContain(pg.id);
    // 同时给出纠错建议：来自标题词元 "PostgreSQL"，而不是整条标题
    expect(res.didYouMean?.toLowerCase()).toBe("postgresql");
  });

  it("2 字中文查询也要给纠错建议：汉字信息密度高，2 字已是完整词", async () => {
    // 旧实现硬卡 effectiveQuery.length >= 3，于是「小说/简历/面试/字体/翻译/代理」
    // 这批 2 字中文查询永远拿不到纠错——而它们恰恰是站内最常见的查询长度。
    // 实测后果：搜「小说」时没有词法命中，只剩一批语义上「最像」的站点（写作/社区类），
    // 用户看到的是答非所问、又没有任何纠正入口。
    await repo.createSite({
      url: "https://font-face.example.com",
      title: "字体",
      description: "字体下载与授权指南",
      categoryId: catId,
    });

    // 「宇体」不是「字体」的子串，词法四通道全都不命中，只剩零候选 -> 触发纠错
    const res = await search.search({ q: "宇体", limit: 5, disablePersonal: true });
    expect(res.didYouMean?.toLowerCase()).toBe("字体");
  });

  it("2 字拉丁查询仍不给纠错建议：go/ai 这类缩写会召出噪声", async () => {
    // 中文降到 2 的同时，拉丁必须守住 3 —— 否则 go/ai 每次都会蹦出一堆不相干建议
    const res = await search.search({ q: "qt", limit: 5, disablePersonal: true });
    expect(res.didYouMean).toBeUndefined();
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

  it("LIKE 通配符必须按字面量处理，不能把 % / _ 当成全表通配", async () => {
    // 旧实现把用户输入直接拼进 LIKE：'penpot%' 会命中 Penpot，'penpo_' 同理。
    // 正确行为是「站点文本里必须真的出现这个百分号/下划线」，因此两者都应为空。
    for (const q of ["penpot%", "penpo_"]) {
      const res = await search.search({ q, disableSemantic: true });
      expect(res.hits, q).toHaveLength(0);
    }
  });

  it("分面/算子把整句吃光且过滤为零时，退回字面文本检索（开源/插件/@design 不是死路）", async () => {
    const pluginSite = await repo.createSite({
      url: "https://example.com/extension",
      title: "广告拦截插件",
      description: "浏览器扩展与插件合集",
      categoryId: catId,
    });

    // 1) 自然语言分面（platform: extension）在库里一条都没有 → 仍要能按字面搜到「插件」
    const plugin = await search.search({ q: "插件", disableSemantic: true });
    expect(plugin.hits.map((h) => h.siteId)).toContain(pluginSite.id);
    expect(plugin.fallback).toBe("filter");
    // 推断出来的分面并没有生效，就不许在响应里声称理解了它
    expect(plugin.inferredFacets).toBeUndefined();

    // 2) 未知分类算子（@design 没有对应类目）退化为文本检索，而不是零结果
    const at = await search.search({ q: "@design", disableSemantic: true });
    const penpot = await repo.findSiteByUrl("https://penpot.app");
    expect(at.hits.map((h) => h.siteId)).toContain(penpot?.id);
    expect(at.fallback).toBe("filter");
    expect(at.inferredCategory).toBeUndefined();

    // 3) 分面数据真实存在时仍走分面过滤，不许误伤正向路径
    const free = await search.search({ q: "免费", disableSemantic: true });
    expect(free.inferredFacets?.pricing).toContain("free");
    expect(free.fallback).toBeUndefined();
    expect(free.hits.map((h) => h.siteId)).toContain(penpot?.id);

    // 4) 空白查询下的有效类目浏览仍然成立（标题能解析就别回落）
    const catBrowse = await search.search({ q: "@开发与设计", disableSemantic: true });
    expect(catBrowse.inferredCategory).toBe("开发与设计");
    expect(catBrowse.fallback).toBeUndefined();
    expect(catBrowse.hits.map((h) => h.siteId)).toContain(penpot?.id);
  });
});
