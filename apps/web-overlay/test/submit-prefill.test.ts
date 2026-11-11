/**
 * A11：搜索零结果 → 投稿收录的查询词携带规则。
 *
 * 约定：查询词是网址/域名才进 url 栏；其余进 title 栏；空查询不带参数；
 * `javascript:` 之类脏串一律丢弃，绝不进表单。
 */
import { describe, expect, it } from "vitest";

import {
  parseSubmitPrefill,
  submitPrefillHref,
} from "../src/lib/submit-prefill";

describe("submitPrefillHref", () => {
  it("普通关键词进 title 参数", () => {
    expect(submitPrefillHref("免费修图")).toBe("/submit?title=%E5%85%8D%E8%B4%B9%E4%BF%AE%E5%9B%BE");
    expect(submitPrefillHref("  react vue  ")).toBe("/submit?title=react%20vue");
  });

  it("域名形查询词补 https:// 进 url 参数", () => {
    expect(submitPrefillHref("example.com")).toBe("/submit?url=https%3A%2F%2Fexample.com%2F");
    expect(submitPrefillHref("sub.foo.dev/path?q=1")).toBe(
      "/submit?url=https%3A%2F%2Fsub.foo.dev%2Fpath%3Fq%3D1",
    );
  });

  it("带协议的完整网址原样进 url 参数", () => {
    expect(submitPrefillHref("https://foo.dev/x")).toBe("/submit?url=https%3A%2F%2Ffoo.dev%2Fx");
    expect(submitPrefillHref("http://foo.dev")).toBe("/submit?url=http%3A%2F%2Ffoo.dev%2F");
  });

  it("含空格的词不是网址，进 title（不硬拼）", () => {
    expect(submitPrefillHref("做短剧的工具")).toBe(
      "/submit?title=%E5%81%9A%E7%9F%AD%E5%89%A7%E7%9A%84%E5%B7%A5%E5%85%B7",
    );
  });

  it("空查询返回裸 /submit，不带空参数", () => {
    expect(submitPrefillHref("")).toBe("/submit");
    expect(submitPrefillHref("   ")).toBe("/submit");
  });

  it("超长标题截断到 120 字", () => {
    const href = submitPrefillHref("啊".repeat(200));
    expect(decodeURIComponent(href.split("title=")[1] ?? "").length).toBe(120);
  });
});

describe("parseSubmitPrefill", () => {
  it("title / url 正常解析", () => {
    expect(parseSubmitPrefill({ title: "免费修图", url: "https://example.com" })).toEqual({
      initialTitle: "免费修图",
      initialUrl: "https://example.com/",
    });
  });

  it("域名形 url 补协议", () => {
    expect(parseSubmitPrefill({ url: "example.com" })).toEqual({
      initialUrl: "https://example.com/",
    });
  });

  it("javascript: 等脏串直接丢弃", () => {
    expect(parseSubmitPrefill({ url: "javascript:alert(1)" })).toEqual({});
    expect(parseSubmitPrefill({ url: "data:text/html,<h1>x</h1>" })).toEqual({});
    expect(parseSubmitPrefill({ url: "ftp://example.com" })).toEqual({});
  });

  it("空值 / 数组值 / 缺失参数都不进表单", () => {
    expect(parseSubmitPrefill({})).toEqual({});
    expect(parseSubmitPrefill({ title: "   ", url: "" })).toEqual({});
    expect(parseSubmitPrefill({ title: ["a", "b"] })).toEqual({});
    expect(parseSubmitPrefill(null)).toEqual({});
    expect(parseSubmitPrefill(undefined)).toEqual({});
  });

  it("超长 title 截断到 120 字", () => {
    const out = parseSubmitPrefill({ title: "啊".repeat(200) });
    expect(out.initialTitle?.length).toBe(120);
  });
});
