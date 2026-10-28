import { describe, expect, it } from "vitest";
import {
  citationOfSite,
  citationUrlKey,
  groundCopilotReply,
  type CopilotCitation,
} from "../src/copilot-grounding.ts";

const obsidian: CopilotCitation = {
  siteId: "site-obsidian",
  title: "Obsidian",
  url: "https://obsidian.md",
  description: "本地优先的 Markdown 知识库",
};
const notion: CopilotCitation = {
  siteId: "site-notion",
  title: "Notion",
  url: "https://www.notion.so/product",
  description: null,
};

describe("citationUrlKey：只回答「是不是同一个站内站点」", () => {
  it("忽略协议、hash 与路径尾部斜杠（模型常把 http 写回 https）", () => {
    expect(citationUrlKey("http://obsidian.md/")).toBe(citationUrlKey("https://obsidian.md"));
    expect(citationUrlKey("https://obsidian.md/#install")).toBe(citationUrlKey("https://obsidian.md"));
    expect(citationUrlKey("HTTPS://OBSIDIAN.MD")).toBe(citationUrlKey("https://obsidian.md"));
  });

  it("query 保留：不同查询参数的页面不当作同一引用", () => {
    expect(citationUrlKey("https://example.com/a?x=1")).not.toBe(citationUrlKey("https://example.com/a?x=2"));
  });

  it("伪协议 / 无效 URL / 协议相对 URL 一律不可引用", () => {
    expect(citationUrlKey("javascript:alert(1)")).toBeNull();
    expect(citationUrlKey("data:text/html,hi")).toBeNull();
    expect(citationUrlKey("//evil.example.com/x")).toBeNull();
    expect(citationUrlKey("not a url")).toBeNull();
  });
});

describe("groundCopilotReply：外链必须映射回本次候选集", () => {
  it("候选站点的链接原样保留，并生成去重后的引用", () => {
    const reply = "试试 [Obsidian](https://obsidian.md) 和 [Obsidian 官网](https://obsidian.md/)。";
    const result = groundCopilotReply(reply, [obsidian]);
    expect(result.reply).toBe(reply);
    expect(result.citations.map((c) => c.siteId)).toEqual(["site-obsidian"]);
    expect(result.citations[0].url).toBe("https://obsidian.md");
    expect(result.unverifiedLinks).toBe(0);
  });

  it("协议/斜杠变体也算命中，但返回库里的原始 URL（不把模型写的 URL 当来源）", () => {
    const result = groundCopilotReply("[Obsidian](http://obsidian.md/)", [obsidian]);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].url).toBe("https://obsidian.md");
  });

  it("编造的外链被降级成纯文本标题，不进 citations", () => {
    const result = groundCopilotReply(
      "推荐 [Obsidian](https://obsidian.md)，还有 [某个神器](https://hallucinated.example.com/download)。",
      [obsidian],
    );
    expect(result.reply).toContain("[Obsidian](https://obsidian.md)");
    expect(result.reply).toContain("还有 某个神器。");
    expect(result.reply).not.toContain("hallucinated.example.com");
    expect(result.citations.map((c) => c.siteId)).toEqual(["site-obsidian"]);
    expect(result.unverifiedLinks).toBe(1);
  });

  it("javascript: / 协议相对外链同样降级；站内相对路径保留给 UI", () => {
    const result = groundCopilotReply(
      "[坏链](javascript:alert(1)) [外站](//evil.example.com) [分类](/category/ai)",
      [],
    );
    expect(result.reply).toBe("坏链 外站 [分类](/category/ai)");
    expect(result.unverifiedLinks).toBe(2);
    expect(result.citations).toEqual([]);
  });

  it("引用按回复中的首次出现顺序排列，不相干的候选不会混进来", () => {
    const result = groundCopilotReply(
      "先看 [Notion](https://www.notion.so/product)，再看 [Obsidian](https://obsidian.md)。",
      [obsidian, notion],
    );
    expect(result.citations.map((c) => c.siteId)).toEqual(["site-notion", "site-obsidian"]);
  });
});

describe("citationOfSite：只暴露引用所需字段", () => {
  it("把 null description 归一化，避免前端渲染出 undefined 文本", () => {
    const citation = citationOfSite({
      id: "s1",
      title: "示例",
      url: "https://example.com",
      description: null,
    } as never);
    expect(citation).toEqual({
      siteId: "s1",
      title: "示例",
      url: "https://example.com",
      description: null,
    });
  });
});
