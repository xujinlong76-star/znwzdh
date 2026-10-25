/**
 * `clampFacetFilter`：分面条件的唯一预算实现（HTTP 与 MCP 共用）。
 *
 * 此前这条预算有三份不一致的副本：/api/sites 20 键 / 200 值、/api/search
 * 16 键 / 16 值 / 64 字符、MCP 无预算。后果是同一份条件在两个端点一过一拒，
 * 而机器面可以绕过全部限制直接把任意大的条件送进 `IN (...)` 查询。
 *
 * 这里钉的是纯函数语义（归一化、拒收、边界值），端点行为在
 * apps/api/test/facets-input-budget.test.ts 与 packages/mcp/test/tool-contract.test.ts。
 */
import { describe, expect, it } from "vitest";
import {
  clampFacetFilter,
  FACET_MAX_JSON_LENGTH,
  FACET_MAX_KEYS,
  FACET_MAX_KEY_LENGTH,
  FACET_MAX_VALUES_PER_KEY,
  FACET_MAX_VALUE_LENGTH,
} from "../src/facets.ts";

describe("clampFacetFilter：归一化", () => {
  it("未传 / 空串 / 纯空白 = 不过滤，不报错", () => {
    for (const input of [undefined, null, "", "   "]) {
      const result = clampFacetFilter(input);
      expect(result.error, String(input)).toBeUndefined();
      expect(result.facets, String(input)).toBeUndefined();
    }
  });

  it("空对象 = 不过滤（store 对 {} 跳过 facets 查询）", () => {
    expect(clampFacetFilter({})).toEqual({ facets: {} });
    expect(clampFacetFilter("{}")).toEqual({ facets: {} });
  });

  it("键与值 trim + 小写 + 去重，空键忽略", () => {
    const result = clampFacetFilter({ " Pricing ": [" FREE ", "free", "Freemium"] });
    expect(result.error).toBeUndefined();
    expect(result.facets).toEqual({ pricing: ["free", "freemium"] });
  });

  it("逗号分隔字符串按 query string 习惯拆开", () => {
    expect(clampFacetFilter({ pricing: "free, freemium" }).facets).toEqual({
      pricing: ["free", "freemium"],
    });
    expect(clampFacetFilter('{"pricing":"free,freemium"}').facets).toEqual({
      pricing: ["free", "freemium"],
    });
  });

  it("接受纯量数字（转字符串）", () => {
    expect(clampFacetFilter({ year: [2026, 2025] }).facets).toEqual({ year: ["2026", "2025"] });
  });

  it("接受整段 JSON 字符串（GET query 的可移植写法）", () => {
    expect(clampFacetFilter('{"pricing":["free"],"platform":["web"]}').facets).toEqual({
      pricing: ["free"],
      platform: ["web"],
    });
  });
});

describe("clampFacetFilter：拒收（error 非空 ⇒ 调用方回 400 / 工具错误）", () => {
  it("非法 JSON 字符串", () => {
    for (const bad of ["{pricing:", "{pricing:['free']}", "not-json"]) {
      expect(clampFacetFilter(bad).error, bad).toContain("JSON");
    }
  });

  it("JSON 字面量不是对象（数组 / 数字 / 字符串 / null）", () => {
    for (const bad of ["[]", "123", '"free"', "null", [[["free"]]]]) {
      expect(clampFacetFilter(bad).error, JSON.stringify(bad)).toBeTruthy();
    }
  });

  it("键数超过预算", () => {
    const tooMany: Record<string, string[]> = {};
    for (let i = 0; i <= FACET_MAX_KEYS; i++) tooMany[`k${i}`] = ["v"];
    expect(clampFacetFilter(tooMany).error).toContain(String(FACET_MAX_KEYS));
    // 边界值本身合法
    const exact: Record<string, string[]> = {};
    for (let i = 0; i < FACET_MAX_KEYS; i++) exact[`k${i}`] = ["v"];
    expect(clampFacetFilter(exact).error).toBeUndefined();
    expect(Object.keys(clampFacetFilter(exact).facets ?? {})).toHaveLength(FACET_MAX_KEYS);
  });

  it("键名长度超过预算", () => {
    expect(clampFacetFilter({ ["k".repeat(FACET_MAX_KEY_LENGTH)]: ["v"] }).error).toBeUndefined();
    expect(clampFacetFilter({ ["k".repeat(FACET_MAX_KEY_LENGTH + 1)]: ["v"] }).error).toContain(
      String(FACET_MAX_KEY_LENGTH),
    );
  });

  it("单键值数超过预算（去重前计数）", () => {
    const values = Array.from({ length: FACET_MAX_VALUES_PER_KEY }, (_, i) => `v${i}`);
    expect(clampFacetFilter({ pricing: values }).error).toBeUndefined();
    expect(clampFacetFilter({ pricing: [...values, "v0"] }).error).toContain(
      String(FACET_MAX_VALUES_PER_KEY),
    );
  });

  it("取值长度超过预算", () => {
    expect(clampFacetFilter({ pricing: ["v".repeat(FACET_MAX_VALUE_LENGTH)] }).error).toBeUndefined();
    expect(clampFacetFilter({ pricing: ["v".repeat(FACET_MAX_VALUE_LENGTH + 1)] }).error).toContain(
      String(FACET_MAX_VALUE_LENGTH),
    );
  });

  it("JSON 字符串的整体长度上限只拦病态大小：合法满预算内容必须放行", () => {
    // 20 键 × 200 值 × 100 字符 ≈ 413KB —— 每一维都在预算内，
    // 字符串形态不能因为「整段太长」把它拒掉（否则又是一种形态歧视）。
    const full: Record<string, string[]> = {};
    for (let k = 0; k < FACET_MAX_KEYS; k++) {
      full[`k${k}`] = Array.from({ length: FACET_MAX_VALUES_PER_KEY }, (_, i) =>
        String(i).padStart(3, "0") + "v".repeat(FACET_MAX_VALUE_LENGTH - 3),
      );
    }
    const json = JSON.stringify(full);
    expect(json.length).toBeGreaterThan(400_000);
    const result = clampFacetFilter(json);
    expect(result.error).toBeUndefined();
    expect(Object.keys(result.facets ?? {})).toHaveLength(FACET_MAX_KEYS);
    expect(result.facets?.k0).toHaveLength(FACET_MAX_VALUES_PER_KEY);

    const huge = "x".repeat(FACET_MAX_JSON_LENGTH + 1);
    expect(clampFacetFilter(huge).error).toContain(String(FACET_MAX_JSON_LENGTH));
  });

  it("某键取值全为空串 = 明确报错，不静默折叠成「没有过滤」", () => {
    // 这是修复前的真实缺陷：客户端以为在筛选，实际拿到未过滤的全量。
    for (const bad of [[""], ["  ", ""], ""]) {
      expect(clampFacetFilter({ pricing: bad }).error, JSON.stringify(bad)).toContain("pricing");
    }
  });

  it("非纯量取值（对象 / 数组 / null / 布尔）明确报错", () => {
    for (const bad of [null, { a: 1 }, ["free"], true]) {
      const result = clampFacetFilter({ pricing: [bad] });
      expect(result.error, JSON.stringify(bad)).toContain("pricing");
      expect(result.facets).toBeUndefined();
    }
  });
});
