import { describe, expect, it } from "vitest";
import {
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
