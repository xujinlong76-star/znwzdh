import { describe, expect, it } from "vitest";
import { findDidYouMeanSuggestion, parseFacetedQuery } from "../src/query-intent.ts";

describe("Query Intent: parseFacetedQuery 分面修饰符提取", () => {
  it("提取计费分面修饰符（开源 / 免费）", () => {
    const res1 = parseFacetedQuery("开源 矢量设计软件");
    expect(res1.cleanedQuery).toBe("矢量设计软件");
    expect(res1.inferredFacets).toEqual({ pricing: ["open_source"] });
    expect(res1.matchedModifiers[0]?.label).toBe("开源免费");

    const res2 = parseFacetedQuery("免费 协同文档");
    expect(res2.cleanedQuery).toBe("协同文档");
    expect(res2.inferredFacets).toEqual({ pricing: ["free"] });
  });

  it("提取平台分面修饰符（mac / windows / web）", () => {
    const res1 = parseFacetedQuery("mac 剪贴板历史");
    expect(res1.cleanedQuery).toBe("剪贴板历史");
    expect(res1.inferredFacets).toEqual({ platform: ["macos"] });

    // 边界保护：machine / machine learning 不误伤为 mac
    const resMachine = parseFacetedQuery("machine learning tools");
    expect(resMachine.cleanedQuery).toBe("machine learning tools");
    expect(resMachine.inferredFacets.platform).toBeUndefined();

    // 网页版
    const resWeb = parseFacetedQuery("思维导图 网页版");
    expect(resWeb.cleanedQuery).toBe("思维导图");
    expect(resWeb.inferredFacets).toEqual({ platform: ["web"] });
  });

  it("支持多维正交分面组合析取", () => {
    const res = parseFacetedQuery("开源 mac 终端命令行工具");
    expect(res.cleanedQuery).toBe("终端");
    expect(res.inferredFacets.pricing).toContain("open_source");
    expect(res.inferredFacets.platform).toContain("macos");
    expect(res.inferredFacets.form).toContain("cli");
  });

  it("纯关键词查询不产生误提取", () => {
    const res = parseFacetedQuery("React 状态管理库 Zustand");
    expect(res.cleanedQuery).toBe("React 状态管理库 Zustand");
    expect(Object.keys(res.inferredFacets).length).toBe(0);
  });

  it("支持高级搜索算子：#tag 与 tag:语法", () => {
    const res1 = parseFacetedQuery("#design 矢量工具");
    expect(res1.inferredTag).toBe("design");
    expect(res1.cleanedQuery).toBe("矢量工具");

    const res2 = parseFacetedQuery("tag:frontend nextjs");
    expect(res2.inferredTag).toBe("frontend");
    expect(res2.cleanedQuery).toBe("nextjs");
  });

  it("支持高级搜索算子：@category 与 cat:语法", () => {
    const res1 = parseFacetedQuery("@tools 剪贴板");
    expect(res1.inferredCategory).toBe("tools");
    expect(res1.cleanedQuery).toBe("剪贴板");

    const res2 = parseFacetedQuery("cat:developer 代码审查");
    expect(res2.inferredCategory).toBe("developer");
    expect(res2.cleanedQuery).toBe("代码审查");
  });

  it("支持显式键值分面算子与负向排除关键词（-negation）", () => {
    const res = parseFacetedQuery("pricing:open_source docker -desktop");
    expect(res.inferredFacets.pricing).toEqual(["open_source"]);
    expect(res.excludedTerms).toEqual(["desktop"]);
    expect(res.cleanedQuery).toBe("docker");
  });

  it("支持全组合超级检索算子解析", () => {
    const res = parseFacetedQuery('cat:design #ui 开源 -adobe "vector editor"');
    expect(res.inferredCategory).toBe("design");
    expect(res.inferredTag).toBe("ui");
    expect(res.inferredFacets.pricing).toEqual(["open_source"]);
    expect(res.excludedTerms).toEqual(["adobe"]);
    expect(res.exactPhrases).toEqual(["vector editor"]);
    expect(res.cleanedQuery).toBe("vector editor");
  });
});

describe("Query Intent: findDidYouMeanSuggestion 零结果纠错推荐", () => {
  const dictionary = [
    "Docker",
    "Kubernetes",
    "TypeScript",
    "TailwindCSS",
    "Next.js",
    "PostgreSQL",
    "Vercel",
    "GitHub",
  ];

  it("针对编辑距离 1 的拼写错误给出纠错推荐", () => {
    expect(findDidYouMeanSuggestion("dockr", dictionary)).toBe("Docker");
    expect(findDidYouMeanSuggestion("kubernets", dictionary)).toBe("Kubernetes");
    expect(findDidYouMeanSuggestion("tpyescript", dictionary)).toBe("TypeScript");
  });

  it("对差异过大或过短的词不做盲目纠错", () => {
    expect(findDidYouMeanSuggestion("ai", dictionary)).toBeNull();
    expect(findDidYouMeanSuggestion("completelyunrelated", dictionary)).toBeNull();
  });
});
