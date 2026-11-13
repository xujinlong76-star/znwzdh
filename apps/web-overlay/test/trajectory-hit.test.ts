import { describe, expect, it } from "vitest";
import {
  compileSpeculationRules,
  isSafeForSpeculation,
} from "@/lib/speculative-prerender";
import {
  PREFETCH_CONFIDENCE_THRESHOLD,
  PRERENDER_CONFIDENCE_THRESHOLD,
  SANDBOX_CANDIDATE_PATHS,
  classifyCandidate,
  computeCosTheta,
  computeHitConfidence,
  evaluateTrajectoryHit,
  median,
  toAbsoluteCandidates,
} from "@/lib/trajectory-hit";

const ORIGIN = "http://localhost:3000";

describe("轨迹命中判定：速度、夹角、距离、抵达四项条件", () => {
  const base = { speed: 0.5, cosTheta: 0.95, distPx: 80 };

  it("四项全部满足时命中，置信度与夹角、预计抵达一致", () => {
    const result = evaluateTrajectoryHit(base);
    expect(result.hit).toBe(true);
    expect(result.etaMs).toBeCloseTo(160, 5);
    expect(result.confidence).toBeCloseTo(0.8825, 4);
    expect(result.angleDeg).toBeCloseTo(18.19, 2);
    expect(result.reason).toContain("全部满足");
  });

  it("速度低于 0.15px/ms 时不命中", () => {
    const result = evaluateTrajectoryHit({ ...base, speed: 0.1 });
    expect(result.hit).toBe(false);
    expect(result.reason).toContain("低于阈值");
  });

  it("夹角超出 35° 锥（cosθ < 0.819）时不命中", () => {
    const result = evaluateTrajectoryHit({ ...base, cosTheta: 0.7 });
    expect(result.hit).toBe(false);
    expect(result.reason).toContain("锥外");
  });

  it("距离超过 220px 时不命中", () => {
    const result = evaluateTrajectoryHit({ ...base, distPx: 300 });
    expect(result.hit).toBe(false);
    expect(result.reason).toContain("超出命中范围");
  });

  it("预计抵达 ≥ 180ms 时不命中", () => {
    const result = evaluateTrajectoryHit({ speed: 0.2, cosTheta: 0.95, distPx: 50 });
    expect(result.etaMs).toBeCloseTo(250, 5);
    expect(result.hit).toBe(false);
    expect(result.reason).toContain("来不及");
  });

  it("边界值恰好等于阈值时命中（速度 0.15、cosθ 0.819、抵达 < 180ms）", () => {
    const result = evaluateTrajectoryHit({ speed: 0.15, cosTheta: 0.819, distPx: 26 });
    expect(result.etaMs).toBeLessThan(180);
    expect(result.hit).toBe(true);
  });

  it("抵达恰好 180ms 时不命中，179ms 时命中", () => {
    expect(evaluateTrajectoryHit({ speed: 1, cosTheta: 0.95, distPx: 180 }).hit).toBe(false);
    expect(evaluateTrajectoryHit({ speed: 1, cosTheta: 0.95, distPx: 179 }).hit).toBe(true);
  });
});

describe("实验室评分公式 computeHitConfidence", () => {
  it("正对目标全速时为 1", () => {
    expect(computeHitConfidence(1, 1)).toBe(1);
  });

  it("阈值下限组合为 0.45 + 0.35·0.819 + 0.20·0.15", () => {
    expect(computeHitConfidence(0.819, 0.15)).toBeCloseTo(0.76665, 4);
  });

  it("无朝向、无速度时为基准分 0.45", () => {
    expect(computeHitConfidence(0, 0)).toBe(0.45);
  });

  it("速度超过 1px/ms 后速度项不再增长", () => {
    expect(computeHitConfidence(1, 5)).toBe(1);
    expect(computeHitConfidence(1, 1)).toBe(1);
  });
});

describe("computeCosTheta", () => {
  const from = { x: 0, y: 0 };
  const east = { vx: 1, vy: 0, speed: 1 };

  it("正对目标为 1，垂直为 0，背向为 -1", () => {
    expect(computeCosTheta(from, east, { x: 10, y: 0 })).toBe(1);
    expect(computeCosTheta(from, east, { x: 0, y: 10 })).toBe(0);
    expect(computeCosTheta(from, east, { x: -10, y: 0 })).toBe(-1);
  });

  it("45° 夹角为 √2/2", () => {
    expect(computeCosTheta(from, east, { x: 10, y: 10 })).toBeCloseTo(0.7071, 4);
  });
});

describe("median", () => {
  it("空数组为 0，奇数取中值，偶数取中间两数均值", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([0.3, 0.1, 0.2])).toBeCloseTo(0.2, 10);
  });
});

describe("沙箱候选：同源绝对地址与规则守卫", () => {
  it("未挂载（origin 为空）时保持相对路径", () => {
    const candidates = toAbsoluteCandidates(SANDBOX_CANDIDATE_PATHS, "");
    expect(candidates.map((candidate) => candidate.url)).toEqual(
      SANDBOX_CANDIDATE_PATHS.map((candidate) => candidate.path),
    );
  });

  it("挂载后拼出同源绝对地址，置信度与抵达时间原样保留", () => {
    const candidates = toAbsoluteCandidates(SANDBOX_CANDIDATE_PATHS, ORIGIN);
    expect(candidates[0]).toEqual({
      url: `${ORIGIN}/algorithms`,
      confidence: 0.92,
      predictedArrivalMs: 110,
    });
  });

  it("默认阈值下 /algorithms 进 prerender，/hot 与 /collections 进 prefetch", () => {
    const candidates = toAbsoluteCandidates(SANDBOX_CANDIDATE_PATHS, ORIGIN);
    const compiled = compileSpeculationRules(candidates, {
      prerenderConfidenceThreshold: PRERENDER_CONFIDENCE_THRESHOLD,
      prefetchConfidenceThreshold: PREFETCH_CONFIDENCE_THRESHOLD,
    });
    expect(compiled).not.toBeNull();
    if (!compiled) return;
    expect(classifyCandidate(`${ORIGIN}/algorithms`, compiled)).toBe("prerender");
    expect(classifyCandidate(`${ORIGIN}/hot`, compiled)).toBe("prefetch");
    expect(classifyCandidate(`${ORIGIN}/collections`, compiled)).toBe("prefetch");
  });

  it("/logout 与 /admin 永远进不了规则（被安全拦截）", () => {
    const candidates = toAbsoluteCandidates(SANDBOX_CANDIDATE_PATHS, ORIGIN);
    const compiled = compileSpeculationRules(candidates, {
      prerenderConfidenceThreshold: PRERENDER_CONFIDENCE_THRESHOLD,
      prefetchConfidenceThreshold: PREFETCH_CONFIDENCE_THRESHOLD,
    });
    expect(compiled).not.toBeNull();
    if (!compiled) return;
    expect(classifyCandidate(`${ORIGIN}/logout`, compiled)).toBe("blocked");
    expect(classifyCandidate(`${ORIGIN}/admin`, compiled)).toBe("blocked");
    const allUrls = [...(compiled.prerender ?? []), ...(compiled.prefetch ?? [])].flatMap(
      (group) => group.urls,
    );
    expect(allUrls).not.toContain(`${ORIGIN}/logout`);
    expect(allUrls).not.toContain(`${ORIGIN}/admin`);
  });

  it("prerender 阈值提高到 0.95 时 /algorithms 降级为 prefetch", () => {
    const candidates = toAbsoluteCandidates(SANDBOX_CANDIDATE_PATHS, ORIGIN);
    const compiled = compileSpeculationRules(candidates, {
      prerenderConfidenceThreshold: 0.95,
      prefetchConfidenceThreshold: PREFETCH_CONFIDENCE_THRESHOLD,
    });
    expect(compiled).not.toBeNull();
    if (!compiled) return;
    expect(classifyCandidate(`${ORIGIN}/algorithms`, compiled)).toBe("prefetch");
    const prerenderUrls = (compiled.prerender ?? []).flatMap((group) => group.urls);
    expect(prerenderUrls).not.toContain(`${ORIGIN}/algorithms`);
  });
});

describe("回归说明：相对路径进 isSafeForSpeculation 会被误判", () => {
  it("相对路径会被解析成 host，/logout 与 /admin 被误判为安全", () => {
    // new URL('https://' + '/logout') 解析为 https://logout/（pathname 为 '/'），
    // 不安全正则匹配不到路径，因此必须先在挂载后拼成同源绝对地址再编译。
    expect(isSafeForSpeculation("/logout")).toBe(true);
    expect(isSafeForSpeculation("/admin")).toBe(true);
  });

  it("同源绝对地址下 /logout 与 /admin 正确被拦截，/algorithms 正确放行", () => {
    expect(isSafeForSpeculation(`${ORIGIN}/logout`)).toBe(false);
    expect(isSafeForSpeculation(`${ORIGIN}/admin`)).toBe(false);
    expect(isSafeForSpeculation(`${ORIGIN}/algorithms`)).toBe(true);
  });
});
