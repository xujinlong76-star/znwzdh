/**
 * 压测基线与压测种子的纯逻辑守卫（规划 P2「压测基线」）。
 *
 * 这些都是「跑一次才知道对不对」的东西：分位数算法错了会把一次偶然的长尾当成回归，
 * 阈值判定错了会让夜间任务永远绿或永远红，路径安全网错了会删掉别人的开发库。
 * 不需要起服务，纯函数逐条钉死。
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TARGETS,
  evaluateThresholds,
  parseArgs,
  percentile,
  summarize,
  type Sample,
} from "./load-baseline.mts";
import { assertSafeLoadTestDb } from "./seed-loadtest.mts";

describe("percentile（最近秩法）", () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1);

  it("空样本返回 0，单样本返回自身", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
  });

  it("1..100 上 p50/p95/p99 取到实际存在的样本，不插值", () => {
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile(sorted, 100)).toBe(100);
  });

  it("奇数样本的 p50 取「升序后第 ⌈n/2⌉ 个」，不是下中位数", () => {
    // 最近秩法的分界就藏在这里：n=5,p=50 → ceil(2.5)=3 → 第 3 个（30）。
    // 改成向下取整会得到 20，中位数会系统性地偏快一半。
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });

  it("小于 1% 的分位也至少返回最小值（不会越界）", () => {
    expect(percentile([3, 9, 27], 0)).toBe(3);
    expect(percentile([3, 9, 27], 1)).toBe(3);
  });
});

describe("summarize", () => {
  const at = (target: Sample["target"], ms: number, status: number): Sample => ({ target, ms, status });

  it("429 与 4xx 不算服务故障，5xx 与网络错误才算", () => {
    const summaries = summarize(
      [
        at("search", 10, 200),
        at("search", 20, 429),
        at("search", 30, 400),
        at("search", 40, 503),
        at("search", 50, 0),
      ],
      1,
    );
    expect(summaries).toHaveLength(1);
    const s = summaries[0];
    expect(s.count).toBe(5);
    expect(s.rps).toBe(5);
    // 503 + network = 2/5，429/400 只出现在 statuses 里
    expect(s.errorRate).toBe(0.4);
    expect(s.statuses).toEqual({ "200": 1, "429": 1, "400": 1, "503": 1, network: 1 });
    expect(s.p50).toBe(30);
    expect(s.max).toBe(50);
  });

  it("多目标按 TARGETS 顺序输出，且各自独立统计", () => {
    const summaries = summarize([at("jobs", 5, 200), at("health", 1, 200), at("health", 3, 200)], 2);
    expect(summaries.map((s) => s.target)).toEqual(["health", "jobs"]);
    expect(summaries[0]).toMatchObject({ count: 2, rps: 1, p50: 1, max: 3, errorRate: 0 });
  });

  it("elapsedSec 为 0 时 rps 记 0 而不是 Infinity", () => {
    const [s] = summarize([at("ready", 1, 200)], 0);
    expect(s.rps).toBe(0);
  });
});

describe("evaluateThresholds", () => {
  const summary = (target: "search" | "sites", p95: number, errorRate: number) => ({
    target,
    count: 100,
    rps: 10,
    p50: p95 / 2,
    p95,
    p99: p95,
    max: p95,
    errorRate,
    statuses: {},
  });

  it("未给阈值时永远不判红", () => {
    expect(evaluateThresholds([summary("search", 9999, 1)], { maxP95Ms: null, maxErrorRate: null })).toEqual([]);
  });

  it("p95 与错误率各自独立判定，命中时点名目标与实测值", () => {
    const failures = evaluateThresholds([summary("search", 900, 0), summary("sites", 100, 0.05)], {
      maxP95Ms: 800,
      maxErrorRate: 0.01,
    });
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ target: "search" });
    expect(failures[0].reason).toContain("900ms");
    expect(failures[1]).toMatchObject({ target: "sites" });
    expect(failures[1].reason).toContain("5.00%");
  });

  it("恰好等于阈值算通过（只有严格超过才红）", () => {
    expect(
      evaluateThresholds([summary("search", 800, 0.01)], { maxP95Ms: 800, maxErrorRate: 0.01 }),
    ).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("默认值：全部目标、去掉尾部斜杠、从环境变量取 token", () => {
    const opts = parseArgs([], { NAVHUB_LOAD_URL: "http://127.0.0.1:8799/", NAVHUB_LOAD_TOKEN: "tok" });
    expect(opts.url).toBe("http://127.0.0.1:8799");
    expect(opts.targets).toEqual([...TARGETS]);
    expect(opts.token).toBe("tok");
    expect(opts.durationSec).toBe(10);
    expect(opts.concurrency).toBe(8);
  });

  it("命令行覆盖环境变量，并解析阈值", () => {
    const opts = parseArgs(
      ["--url", "http://h:1", "--token", "a", "--targets", "health, search", "--max-p95-ms", "250", "--max-error-rate", "0.02"],
      { NAVHUB_LOAD_URL: "http://ignored:1" },
    );
    expect(opts.url).toBe("http://h:1");
    expect(opts.token).toBe("a");
    expect(opts.targets).toEqual(["health", "search"]);
    expect(opts.maxP95Ms).toBe(250);
    expect(opts.maxErrorRate).toBe(0.02);
  });

  it("未知目标、越界错误率、缺值都拒绝", () => {
    expect(() => parseArgs(["--targets", "health,nope"])).toThrow(/未知目标/);
    expect(() => parseArgs(["--max-error-rate", "1.5"])).toThrow(/0\.\.1/);
    expect(() => parseArgs(["--duration", "--json"])).toThrow(/缺少取值/);
    expect(() => parseArgs(["--concurrency", "0"])).toThrow(/concurrency/);
  });
});

describe("压测种子路径安全网", () => {
  const exists = () => true;
  const missing = () => false;

  it("没给路径 → 拒绝（否则会写进开发库）", () => {
    expect(() => assertSafeLoadTestDb(undefined)).toThrow(/NAVHUB_SQLITE_PATH/);
    expect(() => assertSafeLoadTestDb("   ")).toThrow(/NAVHUB_SQLITE_PATH/);
  });

  it("共享开发库 → 拒绝，无论是否 --fresh", () => {
    expect(() => assertSafeLoadTestDb(resolve("./data/navhub.db"))).toThrow(/共享开发库/);
    expect(() => assertSafeLoadTestDb(resolve("./data/navhub.db"), { fresh: true, exists })).toThrow(/共享开发库/);
  });

  it("--fresh 只删 loadtest*.db：别的现存库拒绝，压测库放行", () => {
    expect(() => assertSafeLoadTestDb(resolve("./data/backup.db"), { fresh: true, exists })).toThrow(/loadtest/);
    expect(assertSafeLoadTestDb(resolve("./data/loadtest-2026.db"), { fresh: true, exists })).toBe(
      resolve("./data/loadtest-2026.db"),
    );
  });

  it("不带 --fresh 时只补齐不删除：任意隔离库都放行", () => {
    expect(assertSafeLoadTestDb(resolve("./data/other.db"), { exists })).toBe(resolve("./data/other.db"));
    expect(assertSafeLoadTestDb(resolve("./data/loadtest.db"), { fresh: true, exists: missing })).toBe(
      resolve("./data/loadtest.db"),
    );
  });
});
