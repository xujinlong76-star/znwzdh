/**
 * 搜索建议层（research #2）的纯函数测试。
 *
 * 覆盖：分组与顺序、每组/总数上限、去重、容错匹配（含真实打错的词）、
 * 中文只走子串、空查询不产建议。组件接线（面板渲染、键盘导航、查询保留）
 * 由 search-zero-result-rescue.test.ts 的源码守卫覆盖——本仓测试跑在 node
 * 环境，没有 jsdom，组件挂载类测试不在这里做。
 */
import { describe, expect, it } from "vitest";

import {
  SUGGESTION_GROUP_CAP,
  SUGGESTION_TOTAL_CAP,
  buildSearchSuggestions,
  levenshtein,
  matchSuggestionText,
  type BuildSearchSuggestionsInput,
} from "../src/lib/search-suggestions";

const COLLECTIONS = [
  { id: "c1", title: "GitHub 精选", slug: "github-picks", description: "值得收藏的开源项目" },
  { id: "c2", title: "前端路线图", slug: "frontend-roadmap", description: "从入门到进阶" },
  { id: "c3", title: "React 实战", slug: "react-in-action", description: "React Hooks 与性能优化" },
];

function input(overrides: Partial<BuildSearchSuggestionsInput> = {}): BuildSearchSuggestionsInput {
  return {
    query: "react",
    history: ["react hooks", "vue 3", "react 性能优化"],
    collections: COLLECTIONS,
    relatedSearches: ["react 入门", "react hooks", "vue"],
    ...overrides,
  };
}

describe("levenshtein", () => {
  it("相同词距离 0，空串距离为另一方长度", () => {
    expect(levenshtein("github", "github")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("经典 kitten → sitting 距离 3", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("一位插入/删除/替换距离 1", () => {
    expect(levenshtein("githb", "github")).toBe(1);
    expect(levenshtein("githhub", "github")).toBe(1);
    expect(levenshtein("rect", "react")).toBe(1);
  });

  it("maxDistance 提前返回：长度差已超阈值不再算整表", () => {
    expect(levenshtein("a", "abcdefgh", 2)).toBeGreaterThan(2);
  });
});

describe("matchSuggestionText：容错匹配", () => {
  it("子串命中（大小写不敏感）是主路径", () => {
    expect(matchSuggestionText("reac", "React")).toBe(true);
    expect(matchSuggestionText("REACT", "react hooks")).toBe(true);
  });

  it("真实打错：githb 能配上 GitHub（少一个字母）", () => {
    expect(matchSuggestionText("githb", "GitHub")).toBe(true);
  });

  it("真实打错：rect 能配上 React（漏一个字母）", () => {
    expect(matchSuggestionText("rect", "React")).toBe(true);
  });

  it("真实打错：githhub 能配上 GitHub（多一个字母）", () => {
    expect(matchSuggestionText("githhub", "GitHub")).toBe(true);
  });

  it("多词查询每词都要命中", () => {
    expect(matchSuggestionText("react hooks", "React Hooks 入门")).toBe(true);
    expect(matchSuggestionText("react hooks", "React 性能优化")).toBe(false);
  });

  it("去空白全文也比：reacthooks 配得上 react hooks", () => {
    expect(matchSuggestionText("reacthooks", "react hooks")).toBe(true);
  });

  it("中文只走子串：设计配得上设计工具，设记配不上", () => {
    expect(matchSuggestionText("设计", "设计工具")).toBe(true);
    expect(matchSuggestionText("设记", "设计工具")).toBe(false);
  });

  it("太短的词不容错：go 配不上 to（否则两字母词会乱配）", () => {
    expect(matchSuggestionText("go", "to")).toBe(false);
  });

  it("差太远不配：reac 配不上 vue", () => {
    expect(matchSuggestionText("reac", "vue")).toBe(false);
    expect(matchSuggestionText("githb", "vue")).toBe(false);
  });

  it("空查询或空文本不匹配", () => {
    expect(matchSuggestionText("", "React")).toBe(false);
    expect(matchSuggestionText("react", "")).toBe(false);
    expect(matchSuggestionText("  ", "React")).toBe(false);
  });
});

describe("buildSearchSuggestions：分组与顺序", () => {
  it("顺序是历史 → 专题 → 相关搜索", () => {
    const groups = buildSearchSuggestions(input());
    expect(groups.map((g) => g.kind)).toEqual(["history", "collection", "related"]);
    expect(groups[0].title).toBe("历史搜索");
    expect(groups[1].title).toBe("精选专题");
    expect(groups[2].title).toBe("相关搜索");
  });

  it("每组至多 2 条，总数不超 8 条", () => {
    const groups = buildSearchSuggestions(
      input({
        history: ["react a", "react b", "react c", "react d", "react e"],
        collections: [
          { id: "c1", title: "react 专题一", slug: "r1", description: "" },
          { id: "c2", title: "react 专题二", slug: "r2", description: "" },
          { id: "c3", title: "react 专题三", slug: "r3", description: "" },
        ],
        relatedSearches: ["react x", "react y", "react z"],
      }),
    );
    for (const g of groups) expect(g.items.length).toBeLessThanOrEqual(SUGGESTION_GROUP_CAP);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBeLessThanOrEqual(SUGGESTION_TOTAL_CAP);
    expect(total).toBe(6);
  });

  it("与当前查询完全相同的词不建议，但更长的相关词仍可出现", () => {
    const groups = buildSearchSuggestions(
      input({
        query: "react hooks",
        history: ["react hooks", "react hooks 入门", "vue 3"],
        relatedSearches: ["react hooks", "react hooks 性能"],
      }),
    );
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).not.toContain("react hooks");
    expect(labels).toContain("react hooks 入门");
    expect(labels).toContain("react hooks 性能");
  });

  it("历史与相关搜索跨组去重：先出现的组优先", () => {
    const groups = buildSearchSuggestions(input());
    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels.filter((l) => l === "react hooks")).toHaveLength(1);
    // "react hooks" 属于历史组，不应又在相关搜索里出现一次
    expect(groups.find((g) => g.kind === "history")?.items.map((i) => i.label)).toContain(
      "react hooks",
    );
    expect(groups.find((g) => g.kind === "related")?.items.map((i) => i.label)).not.toContain(
      "react hooks",
    );
  });

  it("打错的查询也能从历史里找回：githb → github", () => {
    const groups = buildSearchSuggestions(
      input({
        query: "githb",
        history: ["github", "vue 3"],
        collections: [],
        relatedSearches: [],
      }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.label)).toEqual(["github"]);
  });

  it("专题按标题 / 描述 / slug 任一命中：roadmap 配得上 slug", () => {
    const groups = buildSearchSuggestions(
      input({ query: "roadmap", history: [], relatedSearches: [] }),
    );
    expect(groups.map((g) => g.kind)).toEqual(["collection"]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["前端路线图"]);
    expect(groups[0].items[0].href).toBe("/collections/frontend-roadmap");
  });

  it("专题行带专题链接，历史/相关搜索行没有 href（采纳为查询词）", () => {
    const groups = buildSearchSuggestions(input());
    expect(groups.find((g) => g.kind === "collection")?.items[0].href).toMatch(
      /^\/collections\//,
    );
    expect(groups.find((g) => g.kind === "history")?.items[0].href).toBeUndefined();
    expect(groups.find((g) => g.kind === "related")?.items[0].href).toBeUndefined();
  });

  it("空查询不产建议（空查询面板另有最近搜索/功能速览）", () => {
    expect(buildSearchSuggestions(input({ query: "" }))).toEqual([]);
    expect(buildSearchSuggestions(input({ query: "   " }))).toEqual([]);
  });

  it("什么都匹配不上时返回 []", () => {
    expect(
      buildSearchSuggestions(
        input({ query: "zzzqqq", history: ["vue"], collections: [], relatedSearches: [] }),
      ),
    ).toEqual([]);
  });

  it("相关搜索不过滤：中枢已算过相关性，直接取用（文本不相似也保留）", () => {
    // 如查询 "figma" 时中枢给出的平替 "penpot"：字面完全不像，但是真相关；
    // 本层若再按字面过滤，会把这类好建议丢掉。历史/专题是本地数据，
    // 才需要本层匹配；相关搜索的相关性由中枢背书。
    const groups = buildSearchSuggestions(
      input({ query: "figma", history: [], collections: [], relatedSearches: ["penpot", "figma 替代"] }),
    );
    expect(groups.map((g) => g.kind)).toEqual(["related"]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["penpot", "figma 替代"]);
  });
});
