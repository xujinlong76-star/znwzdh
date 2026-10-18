/**
 * URL 编码投机意图的边界回归。
 *
 * `encodeURIComponent` 对**孤立代理项**会抛 `URIError`（JS 字符串允许不配对的
 * 代理项，粘贴框选/截断都可能产生）。此前 `tryParseUrlEncoding` 是同一文件里
 * 唯一没包 try/catch 的编解码分支——异常会一路冒泡，打断整条投机意图管线
 * （包括 Web `/api/mcp` 的 evaluate_developer_intent 工具）。
 */
import { describe, expect, it } from "vitest";
import { tryParseUrlEncoding } from "../src/speculative-intent/encoding.ts";

describe("tryParseUrlEncoding 边界", () => {
  it("正常文本按 URL 编码", () => {
    const r = tryParseUrlEncoding("urle: https://a.com/b c");
    expect(r?.type).toBe("url_encode");
    expect(r?.copyValue).toBe(encodeURIComponent("https://a.com/b c"));
  });

  it("合法代理对（emoji）正常编码", () => {
    expect(tryParseUrlEncoding("urle:😀")?.copyValue).toBe("%F0%9F%98%80");
  });

  it("孤立代理项不抛异常，退化为 null", () => {
    // 先钉住前提：孤立代理项确实会抛——否则这条测试就是空的
    expect(() => encodeURIComponent("\ud800")).toThrow();
    expect(tryParseUrlEncoding("urle:\ud800")).toBeNull();
  });

  it("空白内容返回 null", () => {
    expect(tryParseUrlEncoding("urle:   ")).toBeNull();
  });
});
