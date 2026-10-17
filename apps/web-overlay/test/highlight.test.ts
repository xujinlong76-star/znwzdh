/**
 * 关键词高亮的正确性与「不许崩」保证。
 *
 * 背景是真实缺陷：上游 search-bar.tsx 把查询串**原样**塞进 `new RegExp(...)`。
 * 在 /videos 页输入 `(`、`[`、`\`、`+` 这类正则元字符时，渲染期直接抛
 * SyntaxError —— 那不是「高亮失效」，是整页白屏，而且 /videos 没有错误边界兜底。
 * 这类 bug 单测很容易漏，因为只测「正常关键词」永远测不出来。
 *
 * 因此这里的断言分两层：
 *  1. highlightParts 的行为（纯函数，含元字符 / CJK / 多词 / emoji 代理对）；
 *  2. search-bar.tsx 的源码结构（不许再出现 `new RegExp(查询)` 的写法，
 *     必须复用已经过安全转义的 highlightParts）。第 2 层是防回归，防止有人
 *     把上游那版实现「顺手」抄回来。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { highlightParts } from "../src/lib/highlight";

/** 把分段压成 `[命中]普通` 形式，失败信息一眼能看懂 */
function render(text: string, query: string): string {
  return highlightParts(text, query)
    .map((seg) => (seg.hit ? "[" + seg.text + "]" : seg.text))
    .join("");
}

/** 命中片段（按出现顺序） */
function hits(text: string, query: string): string[] {
  return highlightParts(text, query)
    .filter((seg) => seg.hit)
    .map((seg) => seg.text);
}

/**
 * 定位 overlay 里的 search-bar.tsx。
 * 测试文件有两份（overlay 源 + apps/web 里的镜像），相对路径不同，
 * 因此按「路径里必须含 web-overlay」消歧 —— 镜像副本若误指向 apps/web/src，
 * 就会去校验上游底座那份文件，断言失去意义。
 */
function overlaySearchBar(): string {
  const candidates = ["../src/components/search-bar.tsx", "../../web-overlay/src/components/search-bar.tsx"].map(
    (rel) => fileURLToPath(new URL(rel, import.meta.url)),
  );
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 的 search-bar.tsx（候选：" + candidates.join(" | ") + "）");
  return hit;
}

describe("highlightParts：命中的正确性", () => {
  it("空文本返回空数组，空查询返回单个未命中段", () => {
    expect(highlightParts("", "react")).toEqual([]);
    expect(highlightParts("React 文档", "")).toEqual([{ text: "React 文档", hit: false }]);
    expect(highlightParts("React 文档", "   ")).toEqual([{ text: "React 文档", hit: false }]);
  });

  it("大小写不敏感地高亮字面命中", () => {
    expect(render("React 官方文档", "react")).toBe("[React] 官方文档");
    expect(hits("React 官方文档", "REACT")).toEqual(["React"]);
  });

  it("多余空白不会把空白当成关键词", () => {
    expect(render("Vue 与 React", "  vue  ")).toBe("[Vue] 与 React");
  });

  it("多词查询逐词高亮（上游实现把整串当一个词，永远匹配不到）", () => {
    expect(render("React 和 Vue 都很好用", "react vue")).toBe("[React] 和 [Vue] 都很好用");
  });

  it("同一片段内重复命中全部高亮", () => {
    expect(render("vue vue vue", "vue")).toBe("[vue] [vue] [vue]");
  });

  it("token 按长度降序参与匹配：'coder' 不会被 'code' 切成 'code'+'r'", () => {
    expect(hits("coder 工具", "code coder")).toEqual(["coder"]);
  });

  it("CJK 全串命中（无空白，整体作为一个 token）", () => {
    expect(render("阿里云开发者社区", "阿里")).toBe("[阿里]云开发者社区");
    expect(hits("阿里云开发者社区", "阿里云")).toEqual(["阿里云"]);
  });

  it("拼音/语义类召回在文本里没有字面命中时不高亮（属正确行为）", () => {
    expect(highlightParts("知乎", "zhi")).toEqual([{ text: "知乎", hit: false }]);
    expect(highlightParts("知乎", "zhihu")).toEqual([{ text: "知乎", hit: false }]);
  });

  it("增补平面字符（emoji）整对匹配，不劈成半个代理项", () => {
    const text = "看板 😀 面板";
    expect(render(text, "😀")).toBe("看板 [😀] 面板");
    // 命中片段必须恰好是两个 UTF-16 码元（一对完整代理项），分段拼回必须无损
    const segs = highlightParts(text, "😀");
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(["😀"]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });

  it("查询里的孤立代理项不会抛异常，也不会污染其它分段", () => {
    expect(() => highlightParts("abc", "\uD800")).not.toThrow();
    expect(() => highlightParts("abc", "a\uD800b")).not.toThrow();
  });
});

describe("highlightParts：正则元字符不许把渲染打崩", () => {
  const specials = ["(", ")", "[", "]", "{", "}", "\\", "+", "*", "?", ".", "^", "$", "|", "/"];

  it("单个元字符查询：不抛异常，且按字面匹配", () => {
    for (const ch of specials) {
      expect(() => highlightParts("a" + ch + "b", ch)).not.toThrow();
      expect(hits("a" + ch + "b", ch)).toEqual([ch]);
    }
  });

  it("元字符组合的查询不抛异常、不误匹配", () => {
    expect(render("数组 a[0] 与 b(1)", "a[0]")).toBe("数组 [a[0]] 与 b(1)");
    expect(render("Learn C++ 和 C#", "c++")).toBe("Learn [C++] 和 C#");
    expect(render("正则 a|b 的写法", "a|b")).toBe("正则 [a|b] 的写法");
    expect(render("路径 C:\\Users", "c:\\users")).toBe("路径 [C:\\Users]");
    expect(render("a.b 与 axb", "a.b")).toBe("[a.b] 与 axb");
  });

  it("元字符查询不会触发灾难性回溯或死循环（同一输入可重复求值）", () => {
    const nasty = "(((((((((a))))))))))";
    expect(() => highlightParts(nasty, "((a))")).not.toThrow();
    const first = highlightParts("a".repeat(500), "a+");
    const second = highlightParts("a".repeat(500), "a+");
    expect(first).toEqual(second);
  });

  it("任意脏查询都不抛异常：每个分段都是原文的子串拼接，且无损", () => {
    const text = "NavHub 收录 1000+ 站点（含: tag/tools）";
    const dirty = ["(", "[a-z]", "\\", "?", "*+", "^$", "|", "（）", "（(", "\uD83D"];
    for (const q of dirty) {
      const segs = highlightParts(text, q);
      expect(segs.map((s) => s.text).join("")).toBe(text);
    }
  });
});

describe("search-bar.tsx：高亮实现必须走安全路径", () => {
  const source = readFileSync(overlaySearchBar(), "utf8");

  it("复用 @/lib/highlight 的 highlightParts", () => {
    expect(source).toContain("import { highlightParts } from '@/lib/highlight'");
    expect(source).toContain("highlightParts(text, searchQuery)");
  });

  it("不再把查询串直接拼进 RegExp（崩溃回归）", () => {
    expect(source).not.toMatch(/new RegExp\(\s*`/);
    expect(source).not.toMatch(/new RegExp\(\s*[a-zA-Z_$]*searchQuery/);
  });

  it("⌘K / Ctrl+K 快捷键对大小写不敏感（Caps Lock 下也要能用）", () => {
    expect(source).toMatch(/event\.key\.toLowerCase\(\)\s*===\s*'k'/);
    expect(source).not.toMatch(/event\.key\s*===\s*'k'/);
  });

  it("搜索输入与清空按钮有可访问名称", () => {
    expect(source).toContain('aria-label="搜索导航"');
    expect(source).toContain('aria-label="清空搜索"');
  });

  it("空结果给得出「回到完整列表」的出口，不是死路", () => {
    expect(source).toContain("清空搜索，查看全部导航");
  });
});
