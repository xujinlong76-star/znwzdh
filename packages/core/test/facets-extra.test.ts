/**
 * facets.ts 补充覆盖：getFacetDefinition / getFacetOptionLabel / normalizeFacets。
 * （clampFacetFilter 已有 facet-filter.test.ts 覆盖；此处补齐此前
 *  0 调用的三个导出函数——facets.ts 函数覆盖率仅 12.5%。）
 */
import { describe, expect, it } from "vitest";
import {
  CONTROLLED_FACETS,
  getFacetDefinition,
  getFacetOptionLabel,
  normalizeFacets,
} from "../src/facets.ts";

describe("getFacetDefinition", () => {
  it("五大内置分面都能查到", () => {
    for (const key of ["pricing", "platform", "form", "language", "scene"]) {
      const def = getFacetDefinition(key);
      expect(def?.key).toBe(key);
      expect(def!.options.length).toBeGreaterThan(0);
    }
  });

  it("键名大小写/空白不敏感；未知键返回 undefined", () => {
    expect(getFacetDefinition(" Pricing ")?.key).toBe("pricing");
    expect(getFacetDefinition("SCENE")?.key).toBe("scene");
    expect(getFacetDefinition("unknown-facet")).toBeUndefined();
    expect(getFacetDefinition("")).toBeUndefined();
  });

  it("CONTROLLED_FACETS 结构稳定：pricing 为单选，其余多选", () => {
    expect(CONTROLLED_FACETS.map((f) => f.key)).toEqual([
      "pricing",
      "platform",
      "form",
      "language",
      "scene",
    ]);
    expect(CONTROLLED_FACETS.find((f) => f.key === "pricing")!.multiselect).toBe(false);
    expect(CONTROLLED_FACETS.find((f) => f.key === "platform")!.multiselect).toBe(true);
  });
});

describe("getFacetOptionLabel", () => {
  it("已知分面+已知值返回中文标签", () => {
    expect(getFacetOptionLabel("pricing", "free")).toBe("完全免费");
    expect(getFacetOptionLabel("pricing", "open_source")).toBe("开源免费");
    expect(getFacetOptionLabel("platform", "ios")).toBe("iOS / iPadOS");
    expect(getFacetOptionLabel("scene", "dev")).toBe("开发编程");
    expect(getFacetOptionLabel("form", "saas")).toBe("在线 SaaS");
    expect(getFacetOptionLabel("language", "zh")).toBe("中文友好");
  });

  it("值大小写/空白不敏感；未知分面或未知值原样返回", () => {
    expect(getFacetOptionLabel(" pricing ", " FREE ")).toBe("完全免费");
    expect(getFacetOptionLabel("nope", "free")).toBe("free");
    expect(getFacetOptionLabel("pricing", "mystery")).toBe("mystery");
  });
});

describe("normalizeFacets", () => {
  it("键值归一化：小写、去空白、去重、过滤空值", () => {
    expect(normalizeFacets({ Pricing: ["Free", " free ", "", "FREEMIUM", "free"] })).toEqual({
      pricing: ["free", "freemium"],
    });
    expect(normalizeFacets({ scene: "Dev" })).toEqual({ scene: ["dev"] });
  });

  it("非字符串/非数组值被丢弃；空键被跳过；非对象输入返回空对象", () => {
    expect(normalizeFacets({ pricing: 123, platform: null, form: true, scene: {} })).toEqual({});
    expect(normalizeFacets({ "   ": ["x"], pricing: ["free"] })).toEqual({ pricing: ["free"] });
    expect(normalizeFacets(null)).toEqual({});
    expect(normalizeFacets(undefined)).toEqual({});
    expect(normalizeFacets("pricing")).toEqual({});
    expect(normalizeFacets([])).toEqual({});
  });

  it("fallbackWorkspaces：scene 未传入时注入，已传入时不覆盖", () => {
    expect(normalizeFacets({}, ["Dev", " Design ", "dev", ""])).toEqual({ scene: ["dev", "design"] });
    expect(normalizeFacets({ scene: ["ai"] }, ["dev"])).toEqual({ scene: ["ai"] });
    expect(normalizeFacets({}, [])).toEqual({});
    expect(normalizeFacets({}, ["  ", ""])).toEqual({});
    expect(normalizeFacets({ pricing: ["free"] }, null)).toEqual({ pricing: ["free"] });
  });
});
