import { describe, expect, it } from "vitest";
import { normalizeCreatedAt } from "../src/repository/sites.ts";

/**
 * 写入边界回归网（2026-11-08）。
 *
 * 为什么值得单独锁：库里的 3 行 TEXT `created_at` 正是从"调用方给什么存什么"
 * 进来的（批量写入用 `input.createdAt ?? now`）。迁移修的是**存量**，
 * 本函数保证**增量**不再污染——只修存量的话，下一次导入又会复现同一个故障。
 */
describe("normalizeCreatedAt", () => {
  const NOW = 1_700_000_000_000;

  it("数字原样保留（截断小数）", () => {
    expect(normalizeCreatedAt(1_600_000_000_000, NOW)).toBe(1_600_000_000_000);
    expect(normalizeCreatedAt(1_600_000_000_000.7, NOW)).toBe(1_600_000_000_000);
  });

  it("数字字符串按数字解析（REST/JSON 传参常见）", () => {
    expect(normalizeCreatedAt("1600000000000", NOW)).toBe(1_600_000_000_000);
  });

  it("TEXT 日期串按日期解析——这是库里真实出现过的脏值形态", () => {
    expect(normalizeCreatedAt("2026-11-07 06:47:11", NOW)).toBe(Date.parse("2026-11-07T06:47:11"));
    expect(normalizeCreatedAt("2026-11-07T06:47:11Z", NOW)).toBe(Date.parse("2026-11-07T06:47:11Z"));
  });

  it("undefined / null / 垃圾串回落到 fallback（绝不放 NaN 进 SQL）", () => {
    for (const bad of [undefined, null, "", "not-a-date", Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      const v = normalizeCreatedAt(bad, NOW);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(NOW);
    }
  });

  it("0 与负数视为无效（时间戳 0 是 epoch，不是「未知」，但 0 更像缺失标记）", () => {
    expect(normalizeCreatedAt(0, NOW)).toBe(NOW);
    expect(normalizeCreatedAt(-1, NOW)).toBe(NOW);
  });
});
