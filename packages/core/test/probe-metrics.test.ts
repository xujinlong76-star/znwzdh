/**
 * 探活指标聚合的契约测试。
 *
 * 重点锁三件事：
 *   1. 分桶是**累计**语义（Prometheus histogram 的 le 是「≤ 该值」）；
 *   2. 分位数用最近秩法，绝不报出样本里不存在的值；
 *   3. 没发起连接的样本（缓存命中 latencyMs=0 之外的空值）不污染延迟统计。
 */
import { describe, expect, it } from "vitest";
import { LATENCY_BUCKETS_MS, summarizeProbeSamples, toPrometheusText } from "../src/probe-metrics.ts";

describe("按结论分桶", () => {
  it("六类结论各自计数，未出现的为 0", () => {
    const s = summarizeProbeSamples([
      { kind: "ok", latencyMs: 120 },
      { kind: "ok", latencyMs: 140 },
      { kind: "dead", latencyMs: 30, reason: "HTTP 404：页面不存在或已下线" },
      { kind: "unverified", reason: "连接中断，未能确认可达性" },
    ]);
    expect(s.total).toBe(4);
    expect(s.byKind.ok).toBe(2);
    expect(s.byKind.dead).toBe(1);
    expect(s.byKind.unverified).toBe(1);
    expect(s.byKind.blocked).toBe(0);
    expect(s.byKind.parked).toBe(0);
    expect(s.byKind["server-error"]).toBe(0);
  });

  it("原因分布按出现次数降序，最多 10 条", () => {
    const samples = Array.from({ length: 12 }, (_, i) => ({
      kind: "unverified" as const,
      reason: `原因-${i}`,
    }));
    samples.push({ kind: "unverified", reason: "原因-0" });
    const s = summarizeProbeSamples(samples);
    expect(s.topReasons).toHaveLength(10);
    expect(s.topReasons[0]).toEqual({ reason: "原因-0", count: 2 });
  });
});

describe("延迟直方图与分位数", () => {
  it("桶是累计计数，最后一项等于样本数", () => {
    const s = summarizeProbeSamples([
      { kind: "ok", latencyMs: 50 },
      { kind: "ok", latencyMs: 200 },
      { kind: "ok", latencyMs: 900 },
      { kind: "ok", latencyMs: 20_000 },
    ]);
    const byLe = Object.fromEntries(s.buckets.map((b) => [b.le ?? "+Inf", b.count]));
    expect(byLe[100]).toBe(1);
    expect(byLe[250]).toBe(2);
    expect(byLe[1000]).toBe(3);
    expect(byLe["+Inf"]).toBe(4);
    expect(s.measured).toBe(4);
    expect(s.latencySum).toBe(21_150);
  });

  it("最近秩法：小样本下返回的必须是真实样本值", () => {
    const s = summarizeProbeSamples([
      { kind: "ok", latencyMs: 10 },
      { kind: "ok", latencyMs: 20 },
      { kind: "ok", latencyMs: 300 },
    ]);
    expect(s.latency.p50).toBe(20); // ceil(0.5*3)=2 → 第 2 个
    expect(s.latency.p90).toBe(300);
    expect(s.latency.p99).toBe(300);
    expect(s.latency.max).toBe(300);
  });

  it("没有延迟样本时分位数全为 null，而不是 0", () => {
    const s = summarizeProbeSamples([{ kind: "unverified", reason: "超时" }]);
    expect(s.latency).toEqual({ p50: null, p90: null, p99: null, max: null });
    expect(s.latencySum).toBe(0);
    expect(s.measured).toBe(0);
  });

  it("负数与 NaN 等非法耗时被丢弃，不污染统计", () => {
    const s = summarizeProbeSamples([
      { kind: "ok", latencyMs: -5 },
      { kind: "ok", latencyMs: Number.NaN },
      { kind: "ok", latencyMs: 100 },
    ]);
    expect(s.measured).toBe(1);
    expect(s.byKind.ok).toBe(3);
  });

  it("空样本不抛错", () => {
    const s = summarizeProbeSamples([]);
    expect(s.total).toBe(0);
    expect(s.buckets.at(-1)?.count).toBe(0);
    expect(s.topReasons).toEqual([]);
  });
});

describe("Prometheus 文本格式", () => {
  it("输出六类计数、直方图桶、分位数与原因分布", () => {
    const text = toPrometheusText(
      summarizeProbeSamples([
        { kind: "ok", latencyMs: 120, reason: "内容检测通过" },
        { kind: "server-error", latencyMs: 800, reason: 'HTTP 503：服务端暂时不可用，未能确认可用性（不等于站点已死）' },
      ]),
      { instance: "api-1" },
    );
    expect(text).toContain('navhub_probe_total{kind="ok",instance="api-1"} 1');
    expect(text).toContain('navhub_probe_total{kind="server-error",instance="api-1"} 1');
    expect(text).toContain('navhub_probe_duration_ms_bucket{le="250",instance="api-1"} 1');
    expect(text).toContain('navhub_probe_duration_ms_bucket{le="+Inf",instance="api-1"} 2');
    expect(text).toContain('navhub_probe_duration_ms_count{instance="api-1"} 2');
    expect(text).toContain('navhub_probe_latency_percentile_ms{quantile="p50",instance="api-1"} 120');
    // 标签里的双引号必须转义，否则整行解析失败
    expect(text).toContain('reason="HTTP 503：服务端暂时不可用，未能确认可用性（不等于站点已死）"');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("没有样本时仍然输出合法的空指标（抓取端不会因为 404 报警）", () => {
    const text = toPrometheusText(summarizeProbeSamples([]));
    expect(text).toContain('navhub_probe_total{kind="ok"} 0');
    expect(text).toContain('navhub_probe_duration_ms_count 0');
    expect(text).not.toContain("NaN");
  });

  it("不传 instance 时不产生多余标签", () => {
    const text = toPrometheusText(summarizeProbeSamples([]));
    expect(text).not.toContain("instance=");
  });

  it("直方图桶定义有序且覆盖到 10 秒", () => {
    expect([...LATENCY_BUCKETS_MS]).toEqual([...LATENCY_BUCKETS_MS].sort((a, b) => a - b));
    expect(LATENCY_BUCKETS_MS.at(-1)).toBe(10_000);
  });
});

describe("可达率置信下界（Wilson）", () => {
  it("小样本满分不会报 100%：30 条全绿的下界明显低于 1", () => {
    const s = summarizeProbeSamples(Array.from({ length: 30 }, () => ({ kind: "ok" as const, latencyMs: 100 })));
    expect(s.reachabilityLower95).not.toBeNull();
    expect(s.reachabilityLower95!).toBeGreaterThan(0.8);
    expect(s.reachabilityLower95!).toBeLessThan(0.95);
  });

  it("blocked 计入可达（WAF 挡我不等于站点挂了）", () => {
    const all = summarizeProbeSamples(Array.from({ length: 20 }, () => ({ kind: "ok" as const })));
    const mixed = summarizeProbeSamples([
      ...Array.from({ length: 10 }, () => ({ kind: "ok" as const })),
      ...Array.from({ length: 10 }, () => ({ kind: "blocked" as const })),
    ]);
    expect(mixed.reachabilityLower95).toBeCloseTo(all.reachabilityLower95 ?? 0, 5);
  });

  it("样本越多区间越窄（下界更接近点估计）", () => {
    const small = summarizeProbeSamples(Array.from({ length: 10 }, () => ({ kind: "ok" as const })));
    const large = summarizeProbeSamples(Array.from({ length: 200 }, () => ({ kind: "ok" as const })));
    expect(large.reachabilityLower95!).toBeGreaterThan(small.reachabilityLower95!);
  });

  it("全灭时报 0，空样本报 null", () => {
    const dead = summarizeProbeSamples(Array.from({ length: 10 }, () => ({ kind: "dead" as const })));
    expect(dead.reachabilityLower95).toBe(0);
    expect(summarizeProbeSamples([]).reachabilityLower95).toBeNull();
  });
});
