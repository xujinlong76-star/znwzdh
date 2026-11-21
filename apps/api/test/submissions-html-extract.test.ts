/**
 * extractVisibleText：抓取 HTML 转 LLM 分类语料的可见正文提取。
 *
 * 旧实现是正则链（CodeQL #146 错误的 HTML 过滤正则），新实现是状态机。
 * 这些用例逐个对应旧正则会翻车的地方：属性里的 `>`、script 提前闭合、
 * 注释/样式残留、实体被删、纯文本小于号被吞。
 */
import { describe, expect, it } from "vitest";

import { extractVisibleText } from "../src/routes/submissions";

describe("extractVisibleText（状态机剥标签，CodeQL #146）", () => {
  it("属性里的 > 不提前截断标签：正文完整保留", () => {
    expect(extractVisibleText('<a href="x>y">Real Text</a>')).toBe("Real Text");
    // 旧正则在这里会输出 y">Real Text
    expect(extractVisibleText(`<a title='a>b'>kept</a>`)).toBe("kept");
  });

  it("script/style 原文区整段跳过，不进 LLM 语料", () => {
    expect(extractVisibleText("<script>alert(1)</script><p>Visible</p>")).toBe("Visible");
    expect(extractVisibleText("<style>.a{color:red}</style><p>Visible</p>")).toBe("Visible");
    expect(extractVisibleText("<SCRIPT>evil()</SCRIPT><p>ok</p>")).toBe("ok");
  });

  it("script 内字符串里的 </script> 按浏览器口径提前闭合脚本区", () => {
    // 与浏览器一致：script 原文区在第一个 </script> 处结束，后面的文本是可见文本。
    const out = extractVisibleText('<script>var s = "</script>"; x()</script><p>Visible</p>');
    expect(out).not.toContain("var s");
    expect(out).toContain("Visible");
  });

  it("注释与声明跳过，标签边界不断词", () => {
    expect(extractVisibleText("A<!-- hidden -->B")).toBe("A B");
    expect(extractVisibleText("<!DOCTYPE html><p>Hello</p>")).toBe("Hello");
    expect(extractVisibleText("<p>Hello</p><p>World</p>")).toBe("Hello World");
  });

  it("实体解码而不是删除：&amp; 还原成 &", () => {
    expect(extractVisibleText("Fish &amp; Chips &lt;3")).toBe("Fish & Chips <3");
    expect(extractVisibleText("&#65;&#x42;")).toBe("AB");
    // 未知实体原样保留，不丢文本
    expect(extractVisibleText("a &nosuch; b")).toBe("a &nosuch; b");
  });

  it("纯文本小于号保留：a < b 不被吞掉", () => {
    expect(extractVisibleText("a < b and c > d")).toBe("a < b and c > d");
  });

  it("未闭合标签丢弃剩余部分；默认截断 600 字，可传 maxLength", () => {
    expect(extractVisibleText("<p>Text<div")).toBe("Text");
    expect(extractVisibleText(`<p>${"x".repeat(1000)}</p>`)).toHaveLength(600);
    expect(extractVisibleText("<p>hello world</p>", 5)).toBe("hello");
  });
});
