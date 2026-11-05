import { describe, expect, it } from "vitest";
import {
  LEAF_TOO_SMALL_MIN_SITES,
  auditDuplicateTitles,
  auditLeafTooSmall,
  auditSiteCategorization,
  auditTagConsolidation,
  auditZeroResultGaps,
  categoryGapProposalId,
  levenshteinDistance,
  normalizeCategoryKey,
  normalizeTagKey,
  resolveCategoryTitleSuggestion,
} from "../src/taxonomy-governance.ts";

describe("Taxonomy Governance Core Algorithms", () => {
  it("计算 Levenshtein 编辑距离与标签键规范化", () => {
    expect(levenshteinDistance("react", "react")).toBe(0);
    expect(levenshteinDistance("react", "reach")).toBe(1);
    expect(levenshteinDistance("cat", "hats")).toBe(2);

    expect(normalizeTagKey("  React.js ")).toBe("reactjs");
    expect(normalizeTagKey("Dev-Tools")).toBe("devtools");
    expect(normalizeTagKey("AI_Tool")).toBe("aitool");
  });

  it("auditTagConsolidation 能够识别大小写标点重合及低频形近标签", () => {
    const tags = [
      { tag: "React", count: 15 },
      { tag: "react", count: 2 },
      { tag: "React.js", count: 5 },
      { tag: "Vue", count: 10 },
      { tag: "Viee", count: 1 }, // 疑似拼写错误
      { tag: "Docker", count: 8 },
    ];

    const proposals = auditTagConsolidation(tags);
    expect(proposals.length).toBeGreaterThanOrEqual(2);

    const reactProposal = proposals.find((p) => p.targetId === "react");
    expect(reactProposal).toBeDefined();
    expect(reactProposal?.suggestedValue).toBe("React");
    expect(reactProposal?.confidence).toBeGreaterThanOrEqual(0.9);

    const dotJsProposal = proposals.find((p) => p.targetId === "React.js");
    expect(dotJsProposal).toBeDefined();
    expect(dotJsProposal?.suggestedValue).toBe("React");
  });


  /**
   * 编辑距离规则的安全闸（2026-10-31 加）。
   *
   * 背景：纯「编辑距离 1 + 低频」判据在本仓真实语料（1047 标签）上产出 57 条提案，
   * 其中约 49 条是把**不同技术/概念**当拼写变体 —— APM→API、GIF→Git、K3s→K8s、
   * Preact→React、GPU→CPU、SaaS→FaaS、pnpm→npm、编译器→编辑器、数据集→数据库。
   * 采纳一条错误提案 = 把两个概念的站点永久合并，不可逆；漏掉一条只是以后人工再合。
   * 所以这里把「不该出」的清单钉死，宁可不出。
   */
  it("编辑距离规则不得把不同技术/概念判成拼写变体", () => {
    // 每组 [低频候选, 高频主标签]：都是差一个字符，但语义完全不同
    const mustNotMerge: Array<[string, string]> = [
      ["APM", "API"],
      ["GIF", "Git"],
      ["K3s", "K8s"],
      ["Preact", "React"],
      ["GPU", "CPU"],
      ["SaaS", "FaaS"],
      ["BaaS", "SaaS"],
      ["Sass", "SaaS"],
      ["HTAP", "HTTP"],
      ["RAR", "RAG"],
      ["SSR", "SSO"],
      ["MDN", "CDN"],
      ["SFTP", "FTP"],
      ["tRPC", "gRPC"],
      ["pnpm", "npm"],
      ["OpenAI", "OpenAPI"],
      ["编译器", "编辑器"],
      ["数据集", "数据库"],
      ["国际化", "国产化"],
      ["虚拟机", "虚拟化"],
      ["状态页", "状态机"],
      ["工具链", "工具箱"],
      ["私有云", "公有云"],
    ];

    for (const [lower, higher] of mustNotMerge) {
      const proposals = auditTagConsolidation([
        { tag: higher, count: 50 },
        { tag: lower, count: 1 },
      ]);
      const hit = proposals.find(
        (p) => p.currentValue === lower && p.suggestedValue === higher,
      );
      expect(hit, `不应把 "${lower}" 并入 "${higher}"`).toBeUndefined();
    }
  });

  it("编辑距离规则仍要抓到中文修饰词增删这类真同义", () => {
    const proposals = auditTagConsolidation([
      { tag: "运行时", count: 20 },
      { tag: "零运行时", count: 1 },
      { tag: "性价比", count: 12 },
      { tag: "高性价比", count: 1 },
    ]);

    const zeroRuntime = proposals.find((p) => p.currentValue === "零运行时");
    expect(zeroRuntime).toBeDefined();
    expect(zeroRuntime?.suggestedValue).toBe("运行时");

    const highValue = proposals.find((p) => p.currentValue === "高性价比");
    expect(highValue).toBeDefined();
    expect(highValue?.suggestedValue).toBe("性价比");
  });

  it("形态重合（大小写/标点/前后缀）仍然要出提案，且不被安全闸误伤", () => {
    const proposals = auditTagConsolidation([
      { tag: "国产", count: 34 },
      { tag: "国产工具", count: 1 },
      { tag: "AI", count: 6 },
      { tag: "AI 工具", count: 1 },
    ]);

    const guochan = proposals.find((p) => p.currentValue === "国产工具");
    expect(guochan).toBeDefined();
    expect(guochan?.suggestedValue).toBe("国产");

    const ai = proposals.find((p) => p.currentValue === "AI 工具");
    expect(ai).toBeDefined();
    expect(ai?.suggestedValue).toBe("AI");
  });

  it("auditZeroResultGaps 正确发现高频零结果缺口并过滤现有词汇", () => {
    const zeroQueries = [
      { query: "Kubernetes", count: 6, lastAt: Date.now() },
      { query: "LLM Agent", count: 3, lastAt: Date.now() },
      { query: "a", count: 10, lastAt: Date.now() }, // 太短
      { query: "React", count: 5, lastAt: Date.now() }, // 已存在
      { query: "罕见单次词", count: 1, lastAt: Date.now() }, // 频次不足
    ];

    const existingTags = ["React", "Vue", "TypeScript"];
    const existingCategories = [
      { id: "ai", title: "人工智能", altLabels: ["AI", "大模型"] },
    ];

    const proposals = auditZeroResultGaps(zeroQueries, existingTags, existingCategories, 2);
    expect(proposals.map((p) => p.suggestedValue)).toEqual(
      expect.arrayContaining(["Kubernetes", "LLM Agent"]),
    );
    expect(proposals.some((p) => p.suggestedValue === "React")).toBe(false);
    expect(proposals.some((p) => p.suggestedValue === "a")).toBe(false);
    expect(proposals.some((p) => p.suggestedValue === "罕见单次词")).toBe(false);
  });

  it("auditSiteCategorization 识别站点特征词与分类的明显不契合", () => {
    const sites = [
      {
        id: "site-1",
        title: "Docker 官方文档",
        description: "容器云原生部署与编排管理工具",
        categoryId: "design", // 错误归属于设计类
        tags: ["容器", "部署", "云原生"],
      },
      {
        id: "site-2",
        title: "Figma",
        description: "协作界面设计与原型制作工具",
        categoryId: "design", // 正确归属
        tags: ["设计", "UI", "原型"],
      },
    ];

    const categories = [
      { id: "design", title: "设计资源", altLabels: ["UI", "原型", "画板"] },
      { id: "dev", title: "开发运维", altLabels: ["容器", "部署", "代码", "云原生"] },
    ];

    const proposals = auditSiteCategorization(sites, categories);
    expect(proposals.length).toBe(1);
    expect(proposals[0].targetId).toBe("site-1");
    expect(proposals[0].kind).toBe("categorization_mismatch");
    expect(proposals[0].suggestedValue).toBe("开发运维");
    expect(proposals[0].confidence).toBeGreaterThan(0.7);
  });
});

describe("类目健康审计（P6：只出提案，不自动动树）", () => {
  it("叶子过小只对叶子出提案，根与「未分类」豁免", () => {
    const proposals = auditLeafTooSmall([
      { id: "root-x", title: "工具", sites: 3 }, // 根：导航用，不按站点量治理
      { id: "cat-uncategorized", title: "未分类", slug: "uncategorized", parentId: "root-x", sites: 0 },
      { id: "leaf-empty", title: "空叶", parentId: "root-x", sites: 0 },
      { id: "leaf-small", title: "小叶子", parentId: "root-x", sites: 7 },
      { id: "leaf-ok", title: "健康叶子", parentId: "root-x", sites: 40 },
    ]);

    expect(proposals.map((p) => p.targetId)).toEqual(["leaf-empty", "leaf-small"]);
    expect(proposals.every((p) => p.kind === "leaf_too_small")).toBe(true);
    expect(proposals.every((p) => p.meta?.minSites === LEAF_TOO_SMALL_MIN_SITES)).toBe(true);
    const empty = proposals.find((p) => p.targetId === "leaf-empty")!;
    expect(empty.meta?.actionHint).toBe("demote_to_tags");
    expect(empty.confidence).toBeGreaterThan(proposals.find((p) => p.targetId === "leaf-small")!.confidence);
  });

  it("阈值可覆盖：恰好等于健康线不算过小", () => {
    expect(auditLeafTooSmall([{ id: "l", title: "叶", parentId: "r", sites: 20 }])).toEqual([]);
    expect(auditLeafTooSmall([{ id: "l", title: "叶", parentId: "r", sites: 19 }])).toHaveLength(1);
  });

  it("同父同名出 duplicate_title，保留站点更多的那条；跨父重名不算", () => {
    const proposals = auditDuplicateTitles([
      { id: "a1", title: "编程语言", parentId: "dev", sites: 9 },
      { id: "a2", title: "编程 语言", parentId: "dev", sites: 30 }, // 规范化后同名
      { id: "a3", title: "编程语言", parentId: "edu", sites: 4 }, // 不同父级：允许
      { id: "root-1", title: "开发", sites: 0 },
      { id: "root-2", title: "开发", sites: 12 }, // 一级根重名同样要管
    ]);

    expect(proposals.map((p) => p.targetId).sort()).toEqual(["a1", "root-1"]);
    const leafDup = proposals.find((p) => p.targetId === "a1")!;
    expect(leafDup.kind).toBe("duplicate_title");
    expect(leafDup.meta?.keepId).toBe("a2");
    expect(leafDup.meta?.groupSize).toBe(2);
    expect(proposals.find((p) => p.targetId === "root-1")!.meta?.keepId).toBe("root-2");
  });

  it("提案 id 稳定：重复审计不会在队列里堆重复行", () => {
    const input = [{ id: "leaf-1", title: "叶", parentId: "r", sites: 1 }];
    expect(auditLeafTooSmall(input)[0]!.id).toBe("leaf_too_small_leaf-1");
    expect(auditLeafTooSmall(input)[0]!.id).toBe(auditLeafTooSmall(input)[0]!.id);
  });
});

describe("类目名解析（AI / MCP 归类闸门的地基）", () => {
  const categories = [
    { id: "cat-ai", title: "AI 工具", altLabels: ["人工智能", "大模型"] },
    { id: "cat-frontend", title: "前端开发", altLabels: [] },
    { id: "lang-1", title: "语言", altLabels: [] },
    { id: "lang-2", title: "语言", altLabels: [] },
  ];

  it("标题与 altLabel 都能命中，且忽略大小写/空格/连字符", () => {
    expect(resolveCategoryTitleSuggestion("AI工具", categories)).toEqual({ status: "unique", categoryId: "cat-ai" });
    expect(resolveCategoryTitleSuggestion("大模型", categories)).toEqual({ status: "unique", categoryId: "cat-ai" });
    expect(resolveCategoryTitleSuggestion("前端开发", categories)).toEqual({ status: "unique", categoryId: "cat-frontend" });
  });

  it("重名不再静默挑一个：交人工，并同时给出全部候选", () => {
    const r = resolveCategoryTitleSuggestion("语言", categories);
    expect(r.status).toBe("ambiguous");
    expect(r.status === "ambiguous" && r.categoryIds.sort()).toEqual(["lang-1", "lang-2"]);
  });

  it("空名与未收录名都算未命中（调用方据此产提案，而不是建根）", () => {
    expect(resolveCategoryTitleSuggestion("   ", categories)).toEqual({ status: "none" });
    expect(resolveCategoryTitleSuggestion("会议纪要", categories)).toEqual({ status: "none" });
  });

  it("缺口提案 id 稳定：同一个名字的多种写法归一为一条", () => {
    expect(categoryGapProposalId(" AI 工具 ")).toBe(categoryGapProposalId("AI工具"));
    expect(categoryGapProposalId("会议纪要")).toMatch(/^category_gap_/);
    expect(normalizeCategoryKey("Dev-Tools")).toBe("devtools");
  });
});

describe("标签合并安全闸 isSafeEditDistanceOne 行为回归（item ①）", () => {
  it("安全：中文修饰词增删（零运行时→运行时）在低频时出合并提案", () => {
    const proposals = auditTagConsolidation([
      { tag: "运行时", count: 50 },
      { tag: "零运行时", count: 1 },
    ]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.targetId).toBe("零运行时");
    expect(proposals[0]!.suggestedValue).toBe("运行时");
    expect(proposals[0]!.kind).toBe("tag_consolidation");
    expect(proposals[0]!.meta).toMatchObject({ action: "merge" });
  });

  it("不安全：不同概念的替换（编辑器↔编译器）绝不出提案", () => {
    const proposals = auditTagConsolidation([
      { tag: "编辑器", count: 50 },
      { tag: "编译器", count: 1 },
    ]);
    expect(proposals).toHaveLength(0);
  });

  it("不安全：纯 ASCII 缩写差异（API/APM、npm/pnpm）绝不出提案", () => {
    expect(
      auditTagConsolidation([
        { tag: "API", count: 50 },
        { tag: "APM", count: 1 },
      ]),
    ).toHaveLength(0);
    expect(
      auditTagConsolidation([
        { tag: "npm", count: 50 },
        { tag: "pnpm", count: 1 },
      ]),
    ).toHaveLength(0);
  });
});

