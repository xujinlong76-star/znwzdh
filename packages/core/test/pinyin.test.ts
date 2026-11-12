/**
 * pinyin.ts 覆盖：查询侧拼音归一化与拉丁输入判定。
 * （pinyinTraits 的中文/非中文主干已有其它用例覆盖；此处补齐
 *  此前未覆盖的 normalizeQueryPinyin / looksLikeLatinQuery。）
 */
import { describe, expect, it } from "vitest";
import { looksLikeLatinQuery, normalizeQueryPinyin, pinyinTraits } from "../src/pinyin.ts";

describe("normalizeQueryPinyin", () => {
  it("中文转全拼与首字母", () => {
    expect(normalizeQueryPinyin("启动脚本")).toEqual({ full: "qidongjiaoben", initials: "qdjb" });
  });

  it("拉丁输入原样小写、去非字母数字", () => {
    expect(normalizeQueryPinyin("GitHub")).toEqual({ full: "github", initials: "github" });
    expect(normalizeQueryPinyin("qdjb")).toEqual({ full: "qdjb", initials: "qdjb" });
  });

  it("空串与空白返回空串", () => {
    expect(normalizeQueryPinyin("")).toEqual({ full: "", initials: "" });
    expect(normalizeQueryPinyin("   ")).toEqual({ full: "", initials: "" });
  });
});

describe("pinyinTraits 混合输入", () => {
  it("中英混输：中文部分转拼音，非中文部分保留", () => {
    const t = pinyinTraits("启动脚本 GitHub");
    expect(t.full).toContain("qidongjiaoben");
    expect(t.full).toContain("github");
    expect(t.initials).toContain("qdjb");
  });
});

describe("looksLikeLatinQuery", () => {
  it("纯拉丁/数字/空白为 true", () => {
    expect(looksLikeLatinQuery("qdjb")).toBe(true);
    expect(looksLikeLatinQuery("github copilot")).toBe(true);
    expect(looksLikeLatinQuery("abc 123")).toBe(true);
  });

  it("含中文、连字符或其它符号为 false；空串为 false", () => {
    expect(looksLikeLatinQuery("启动脚本")).toBe(false);
    expect(looksLikeLatinQuery("hello-world")).toBe(false);
    expect(looksLikeLatinQuery("a.b")).toBe(false);
    expect(looksLikeLatinQuery("")).toBe(false);
    expect(looksLikeLatinQuery("   ")).toBe(false);
  });
});
