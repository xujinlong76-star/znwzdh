import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIBULL,
  PATROL_MAX_DAYS,
  PATROL_MIN_DAYS,
  fitWeibullByMoments,
  gamma,
  logGamma,
  nextPatrolDelayDays,
  planPatrol,
  weibullHazard,
  weibullSurvival,
} from "../src/health-sentinel.ts";

/** 反变换采样：给定期望参数生成一批寿命样本（确定性 PRNG，测试可复现） */
function sampleWeibull(n: number, shape: number, scale: number, seed = 42): number[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = Math.max(1e-9, Math.min(1 - 1e-9, rnd()));
    out.push(scale * Math.pow(-Math.log(1 - u), 1 / shape));
  }
  return out;
}

describe("Gamma（Weibull 矩估计的基础）", () => {
  it("整数点精确：Γ(n) = (n-1)!", () => {
    expect(gamma(1)).toBeCloseTo(1, 6);
    expect(gamma(2)).toBeCloseTo(1, 6);
    expect(gamma(5)).toBeCloseTo(24, 4);
    expect(gamma(6)).toBeCloseTo(120, 3);
  });

  it("Γ(0.5) = √π（验证反射公式那条分支）", () => {
    expect(gamma(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 6);
  });

  it("logGamma 与 gamma 一致", () => {
    expect(Math.exp(logGamma(3.5))).toBeCloseTo(gamma(3.5), 8);
  });
});

describe("weibullSurvival / weibullHazard", () => {
  it("t=0 时必存活，随年龄单调递减收敛到 0", () => {
    expect(weibullSurvival(0)).toBe(1);
    const s = [0, 100, 400, 900, 3000, 9000].map((t) => weibullSurvival(t));
    for (let i = 1; i < s.length; i++) expect(s[i]!).toBeLessThan(s[i - 1]!);
    expect(s.at(-1)!).toBeLessThan(0.01);
  });

  it("λ 处存活概率 = e^-1（尺度参数的定义）", () => {
    expect(weibullSurvival(900, DEFAULT_WEIBULL)).toBeCloseTo(Math.exp(-1), 4);
  });

  it("k>1 时失效率随年龄上升（老链接更该被查）", () => {
    const h = [10, 100, 500, 1500].map((t) => weibullHazard(t));
    for (let i = 1; i < h.length; i++) expect(h[i]!).toBeGreaterThan(h[i - 1]!);
  });

  it("非法输入不产生 NaN", () => {
    for (const t of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Number.isFinite(weibullSurvival(t))).toBe(true);
      expect(Number.isFinite(weibullHazard(t))).toBe(true);
    }
  });
});

describe("fitWeibullByMoments", () => {
  it("能从样本里恢复出形状与尺度（矩估计自洽）", () => {
    const samples = sampleWeibull(20000, 1.6, 900, 7);
    const fit = fitWeibullByMoments(samples);
    expect(fit.shape).toBeGreaterThan(1.35);
    expect(fit.shape).toBeLessThan(1.9);
    expect(fit.scale).toBeGreaterThan(780);
    expect(fit.scale).toBeLessThan(1020);
  });

  it("k<1（早期失效）也能拟合出来", () => {
    const fit = fitWeibullByMoments(sampleWeibull(20000, 0.7, 120, 11));
    expect(fit.shape).toBeGreaterThan(0.55);
    expect(fit.shape).toBeLessThan(0.9);
  });

  it("样本不足 / 退化时退回默认参数，绝不产出病态值", () => {
    expect(fitWeibullByMoments([])).toEqual(DEFAULT_WEIBULL);
    expect(fitWeibullByMoments([100])).toEqual(DEFAULT_WEIBULL);
    expect(fitWeibullByMoments([100, 100, 100])).toEqual(DEFAULT_WEIBULL); // 方差为 0
    const bad = fitWeibullByMoments([Number.NaN, -1, 0]);
    expect(Number.isFinite(bad.shape)).toBe(true);
    expect(Number.isFinite(bad.scale)).toBe(true);
  });
});

describe("nextPatrolDelayDays", () => {
  it("年龄越大 -> 下次巡检间隔越短（k>1 的直接推论）", () => {
    const young = nextPatrolDelayDays(10);
    const mid = nextPatrolDelayDays(400);
    const old = nextPatrolDelayDays(1200);
    expect(young).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(old);
  });

  it("风险预算越紧（越小）-> 查得越勤", () => {
    expect(nextPatrolDelayDays(500, 0.05)).toBeLessThan(nextPatrolDelayDays(500, 0.3));
  });

  it("间隔被夹在 [1, 180] 天，不会退化成 0 或无限大", () => {
    for (const t of [0, 1, 100, 5000, 100000]) {
      const d = nextPatrolDelayDays(t);
      expect(d).toBeGreaterThanOrEqual(PATROL_MIN_DAYS);
      expect(d).toBeLessThanOrEqual(PATROL_MAX_DAYS);
    }
    expect(nextPatrolDelayDays(Number.NaN)).toBeGreaterThanOrEqual(PATROL_MIN_DAYS);
  });

  it("k=1（指数分布、无老化）时间隔与年龄无关", () => {
    const exp = { shape: 1, scale: 900 };
    expect(nextPatrolDelayDays(0, 0.15, exp)).toBeCloseTo(nextPatrolDelayDays(2000, 0.15, exp), 2);
  });
});

describe("planPatrol", () => {
  const now = Date.UTC(2026, 0, 1);
  const DAY = 86_400_000;

  it("最久没查、存活概率最低的排最前", () => {
    const plan = planPatrol(
      [
        { siteId: "fresh", lastCheckedAt: now - 2 * DAY },
        { siteId: "stale", lastCheckedAt: now - 1500 * DAY },
        { siteId: "mid", lastCheckedAt: now - 600 * DAY },
      ],
      now,
    );
    expect(plan.map((p) => p.siteId)).toEqual(["stale", "mid", "fresh"]);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.survival).toBeGreaterThanOrEqual(plan[i - 1]!.survival);
    }
  });

  it("没查过的站点按创建时间算年龄，且不会崩", () => {
    const plan = planPatrol([{ siteId: "never", createdAt: now - 900 * DAY }], now);
    expect(plan[0]!.ageDays).toBeCloseTo(900, 1);
    expect(plan[0]!.survival).toBeCloseTo(Math.exp(-1), 3);
  });

  it("完全无时间戳的站点视为 0 天（必存活），排最后", () => {
    const plan = planPatrol([{ siteId: "unknown" }, { siteId: "old", lastCheckedAt: now - 2000 * DAY }], now);
    expect(plan[0]!.siteId).toBe("old");
    expect(plan[1]!.survival).toBe(1);
  });

  it("同一输入必得同一输出（巡检队列可复现）", () => {
    const targets = [
      { siteId: "a", lastCheckedAt: now - 100 * DAY },
      { siteId: "b", lastCheckedAt: now - 800 * DAY },
    ];
    expect(planPatrol(targets, now)).toEqual(planPatrol(targets, now));
  });

  it("nextCheckAt 与 nextCheckInDays 自洽", () => {
    const p = planPatrol([{ siteId: "x", lastCheckedAt: now - 700 * DAY }], now)[0]!;
    expect(p.nextCheckAt).toBeCloseTo(now + p.nextCheckInDays * DAY, -3);
  });
});
