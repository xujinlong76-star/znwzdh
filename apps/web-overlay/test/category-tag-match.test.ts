/**
 * 分类页标签精确匹配（matchesSiteTag）行为测试。
 *
 * 回归背景：data-tags 是标签串，之前用子串匹配 `tags.includes(tag)`，
 * 点「Java」会命中只打了「JavaScript」的站点，点「Go」命中「Google」，
 * 点「UI」命中「UI 设计 / UI 库 / UI 框架 / UI 组件」，且筛出数与芯片上
 * 的精确计数对不上。改用单元分隔符（U+001F）拼接后按整词精确匹配。
 * 另有 3 个标签本身含空格（AI IDE、AI 助手、UI 设计），空格拼接无法区分
 * 「UI 设计」与「UI」+「设计」，分隔符方案同时修掉这一歧义。
 */
import { describe, expect, it } from "vitest";
import {
  TAG_ATTR_SEPARATOR,
  matchesSiteTag,
} from "../src/lib/category-tag-match";

const S = TAG_ATTR_SEPARATOR;
const join = (...tags: string[]) => tags.join(S);

describe("matchesSiteTag", () => {
  it("整词命中：标签在串首、串中、串尾都算命中", () => {
    expect(matchesSiteTag(join("java", "javascript"), "java")).toBe(true);
    expect(matchesSiteTag(join("工具", "java"), "java")).toBe(true);
    expect(matchesSiteTag(join("工具", "java", "搜索"), "java")).toBe(true);
  });

  it("子串不命中：Java 不命中 JavaScript，Go 不命中 Google", () => {
    expect(matchesSiteTag(join("javascript"), "java")).toBe(false);
    expect(matchesSiteTag(join("javascript", "工具"), "java")).toBe(false);
    expect(matchesSiteTag(join("google", "搜索"), "go")).toBe(false);
    expect(matchesSiteTag(join("google"), "go")).toBe(false);
  });

  it("UI 不命中 UI 库 / UI 框架 / UI 组件等派生标签", () => {
    expect(matchesSiteTag(join("ui库", "ui框架", "ui组件"), "ui")).toBe(false);
    expect(matchesSiteTag(join("ui", "ui库"), "ui")).toBe(true);
  });

  it("含空格的标签保持完整：UI 设计、AI IDE 按整词匹配", () => {
    expect(matchesSiteTag(join("ui 设计", "工具"), "ui 设计")).toBe(true);
    expect(matchesSiteTag(join("ai ide", "工具"), "ai ide")).toBe(true);
    // 「UI 设计」与「UI」+「设计」不再混淆：前者是单个标签，后者是两个标签
    expect(matchesSiteTag(join("ui 设计"), "ui")).toBe(false);
    expect(matchesSiteTag(join("ui 设计"), "设计")).toBe(false);
    expect(matchesSiteTag(join("ui", "设计"), "ui")).toBe(true);
    expect(matchesSiteTag(join("ai ide"), "ai")).toBe(false);
  });

  it("含正则特殊字符的标签（C++）不被当成正则", () => {
    expect(matchesSiteTag(join("c++", "工具"), "c++")).toBe(true);
    expect(matchesSiteTag(join("c++11"), "c++")).toBe(false);
  });

  it("空标签不过滤、大小写不敏感", () => {
    expect(matchesSiteTag(join("javascript"), "")).toBe(true);
    expect(matchesSiteTag(join("JavaScript"), "javascript")).toBe(true);
    expect(matchesSiteTag(join("java"), "Java")).toBe(true);
  });
});
