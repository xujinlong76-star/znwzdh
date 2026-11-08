import { describe, expect, it } from "vitest";
import { ageInDays, trendScore } from "../src/ranking.ts";

/**
 * 回归网：热度公式的**非有限值**防护（2026-11-08 实测故障）。
 *
 * 故障现场：库里 3 条站的 created_at 存成了 TEXT 日期串，`Number()` → NaN，
 * 一路传到 SQL 绑定参数变成 NULL，撞上 `sites.weight NOT NULL`，
 * 导致 `recompute_rank` 每小时整任务失败（jobs 表里 25 条 failed），
 * 全站 trend_score 长期停在 0。
 *
 * 原实现看起来在兜底（`Math.max(0, ...)` + `toFixed`），但对 NaN 全部无效：
 *   Math.max(0, NaN) === NaN，NaN.toFixed(6) === "NaN"，Number("NaN") === NaN。
 * 这里把「算不出来」钉死成 0，不允许 NaN 逃出去。
 */
describe("trendScore 非有限值防护", () => {
  const NOW = 1_700_000_000_000;

  it("ageDays 为 NaN 时返回有限值，且与「年龄 0 天」同分", () => {
    const dirty = trendScore({ visits7d: 1, favorites7d: 0, ageDays: Number.NaN }, NOW);
    const clean = trendScore({ visits7d: 1, favorites7d: 0, ageDays: 0 }, NOW);
    expect(Number.isFinite(dirty)).toBe(true);
    // 算不出年龄时按「新站」处理：不该让脏数据把分数压成 0，也不该外泄 NaN
    expect(dirty).toBeCloseTo(clean, 10);
  });

  it("visits/favorites 为 NaN 或 Infinity 时返回有限值", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Number.isFinite(trendScore({ visits7d: bad, favorites7d: 0, ageDays: 1 }, NOW))).toBe(true);
      expect(Number.isFinite(trendScore({ visits7d: 0, favorites7d: bad, ageDays: 1 }, NOW))).toBe(true);
    }
  });

  it("正常输入不受影响（防护没有把公式改坏）", () => {
    const fresh = trendScore({ visits7d: 10, favorites7d: 2, ageDays: 1 }, NOW);
    const old = trendScore({ visits7d: 10, favorites7d: 2, ageDays: 60 }, NOW);
    expect(fresh).toBeGreaterThan(old);
    expect(fresh).toBeGreaterThan(0);
  });
});

describe("ageInDays 对脏 created_at 的处理", () => {
  const NOW = 1_700_000_000_000;

  it("NaN 输入收敛为 0 天，而不是 NaN", () => {
    expect(ageInDays(Number.NaN, NOW)).toBe(0);
    expect(ageInDays(Number("2026-11-07 06:47:11"), NOW)).toBe(0);
  });

  it("未来时间戳不会算出负年龄", () => {
    expect(ageInDays(NOW + 86_400_000, NOW)).toBe(0);
  });

  it("正常时间戳照常工作", () => {
    expect(ageInDays(NOW - 2 * 86_400_000, NOW)).toBeCloseTo(2, 5);
  });
});
