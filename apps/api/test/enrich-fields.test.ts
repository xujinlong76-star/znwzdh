/**
 * 富化字段级取舍（纯函数）。
 *
 * 这里钉的是「审核界面能承诺什么」：勾了哪些字段就只写哪些，没值（missing）
 * 的字段绝不冒充最新信息覆盖原值，拼错的字段名必须能被调用方看见。
 * 与 enrich-selective-api.test.ts 的分工：本文件只管取舍规则，
 * 那边验证 REST 写入确实按取舍结果落库。
 */
import { describe, expect, it } from "vitest";
import type { EnrichmentResult } from "@navhub/ai";
import { ENRICH_FIELD_KEYS, selectEnrichmentFields } from "../src/enrich-fields.ts";

function result(overrides: Partial<EnrichmentResult["fields"]> = {}): EnrichmentResult {
  return {
    url: "https://example.com/tools",
    httpStatus: 200,
    title: "Example Tools",
    description: "开发者工具合集",
    tags: ["developer", "tools"],
    keywords: ["developer", "tools"],
    suggestedCategory: "开发工具",
    suggestedFacets: [],
    suggestedRelations: [],
    iconUrl: "https://example.com/favicon.ico",
    imageUrl: null,
    lang: "zh-CN",
    provenance: "heuristic",
    fields: {
      title: { value: "Example Tools", source: "scraped" },
      description: { value: "开发者工具合集", source: "scraped" },
      tags: { value: ["developer", "tools"], source: "heuristic" },
      category: { value: "开发工具", source: "heuristic" },
      icon: { value: "https://example.com/favicon.ico", source: "scraped" },
      ...overrides,
    },
    warnings: [],
  };
}

describe("selectEnrichmentFields", () => {
  it("不传请求 = 全应用，且按固定字段顺序返回", () => {
    const selection = selectEnrichmentFields(result());
    expect(selection.appliedFields).toEqual([...ENRICH_FIELD_KEYS]);
    expect(selection.applied).toEqual({
      title: "Example Tools",
      description: "开发者工具合集",
      category: "开发工具",
      tags: ["developer", "tools"],
      iconUrl: "https://example.com/favicon.ico",
    });
    expect(selection.skipped).toEqual([]);
    expect(selection.ignoredFields).toEqual([]);
  });

  it("只应用列出的字段，未列出的字段连 skipped 都不出现", () => {
    const selection = selectEnrichmentFields(result(), ["description", "tags"]);
    expect(selection.appliedFields).toEqual(["description", "tags"]);
    expect(selection.applied).toEqual({ description: "开发者工具合集", tags: ["developer", "tools"] });
    expect(selection.applied.title).toBeUndefined();
    expect(selection.applied.iconUrl).toBeUndefined();
    expect(selection.applied.category).toBeUndefined();
    expect(selection.skipped).toEqual([]);
  });

  it("请求顺序不影响结果顺序（审计与断言都按固定顺序）", () => {
    const selection = selectEnrichmentFields(result(), ["icon", "title", "tags"]);
    expect(selection.appliedFields).toEqual(["title", "tags", "icon"]);
  });

  it("missing 来源一律跳过并给出原因，空值不覆盖原值", () => {
    const selection = selectEnrichmentFields(
      result({
        title: { value: "example.com", source: "missing", note: "页面没有 title，只能用主机名占位" },
        tags: { value: [], source: "missing", note: "关键词规则没有命中" },
      }),
    );
    expect(selection.appliedFields).toEqual(["description", "category", "icon"]);
    expect(selection.applied.title).toBeUndefined();
    expect(selection.applied.tags).toBeUndefined();
    expect(selection.skipped).toEqual([
      { field: "title", reason: "页面没有 title，只能用主机名占位" },
      { field: "tags", reason: "关键词规则没有命中" },
    ]);
  });

  it("空数组与空类目跳过（即使来源不是 missing）", () => {
    const selection = selectEnrichmentFields(
      result({
        tags: { value: [], source: "heuristic" },
        category: { value: null, source: "heuristic" },
      }),
    );
    expect(selection.appliedFields).toEqual(["title", "description", "icon"]);
    expect(selection.applied.tags).toBeUndefined();
    expect(selection.applied.category).toBeUndefined();
    expect(selection.skipped).toEqual([
      { field: "category", reason: "没有类目建议" },
      { field: "tags", reason: "值为空" },
    ]);
  });

  it("缺少字段元数据时跳过并说明，不静默当有值", () => {
    const legacy = result();
    // 兼容旧版富化结果：fields 不完整
    delete (legacy.fields as Partial<EnrichmentResult["fields"]>).icon;
    const selection = selectEnrichmentFields(legacy);
    expect(selection.applied.iconUrl).toBeUndefined();
    expect(selection.skipped).toContainEqual({ field: "icon", reason: "这条富化结果没有给出该字段的来源信息" });
  });

  it("不认识的字段名进 ignoredFields，不静默丢弃也不误应用", () => {
    const selection = selectEnrichmentFields(result(), ["titel", "description", " tags ", ""]);
    expect(selection.ignoredFields).toEqual(["titel"]);
    expect(selection.appliedFields).toEqual(["description", "tags"]);
  });

  it("显式空数组 = 一个字段都不应用（而不是回退成全应用）", () => {
    const selection = selectEnrichmentFields(result(), []);
    expect(selection.appliedFields).toEqual([]);
    expect(selection.applied).toEqual({});
    expect(selection.skipped).toEqual([]);
  });
});
