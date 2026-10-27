/**
 * 探活指标的聚合与导出（RED 方法）。
 *
 * 现状问题：面板只有一个「可达率」，看不出**为什么**掉——是 5xx 变多了，
 * 还是我们的超时变多了？也看不出延迟分布（p99 拖长通常是对方限速的先兆）。
 *
 * 这里做两件事，都是纯函数：
 *   1. `summarizeProbeSamples`：按结论分桶 + 延迟直方图 + 分位数 + 原因 TopN；
 *   2. `toPrometheusText`：输出 Prometheus 文本格式，可直接被抓取。
 *
 * 刻意不引入 prom-client 之类的依赖：本仓的指标量级是「一次体检几十到几百条」，
 * 自己算直方图足够，多一个依赖反而增加部署负担。
 */
import type { ProbeOutcomeKind } from "./probe-policy.ts";

export interface ProbeSample {
  kind: ProbeOutcomeKind;
  /** 实际耗时；只为「真的发起了连接」的样本取值 */
  latencyMs?: number;
  /** 原因文案（用于归因；不做自由文本聚合，直接按字符串计数） */
  reason?: string;
  /** 采样时间（毫秒） */
  at?: number;
}

/** 直方图桶（毫秒）：覆盖「很快 → 明显卡顿 → 被判超时」三档 */
export const LATENCY_BUCKETS_MS = [100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const;

export interface ProbeMetricsSummary {
  total: number;
  byKind: Record<ProbeOutcomeKind, number>;
  /** 真的连上了的样本数（决定延迟分位数的分母） */
  measured: number;
  /** 延迟直方图：每个桶是「≤ 该值」的累计条数，最后一项为 +Inf */
  buckets: Array<{ le: number | null; count: number }>;
  latency: { p50: number | null; p90: number | null; p99: number | null; max: number | null };
  /** 延迟总和（Prometheus histogram 的 _sum，必须是真实累加而不是估算） */
  latencySum: number;
  /** 原因计数，按出现次数降序，最多 10 条 */
  topReasons: Array<{ reason: string; count: number }>;
  /**
   * 可达率的 95% Wilson 下界（ok + blocked 视为可达）。
   *
   * 为什么不用点估计：抽 30 条里 29 条活着，点估计是 96.7%，但真实总体可能低到 88%。
   * 直接展示 96.7% 会让运营以为「几乎全好」，而 Wilson 下界给出的是「有 95% 把握
   * 不低于这个数」——这才是能拿去做决策的数字。
   */
  reachabilityLower95: number | null;
}

/**
 * Wilson score interval 下界（z=1.96 对应 95%）。
 *
 * 相比正态近似，它在小样本与极端比例（0% 或 100%）下依然给出有意义的区间：
 * 30 条全绿时报的是约 0.89 而不是 1.0，符合「样本有限就不该声称满分」的常识。
 */
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number | null {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0) return null;
  const n = total;
  const p = Math.min(1, Math.max(0, successes / n));
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / denominator);
}

const KINDS: ProbeOutcomeKind[] = ["ok", "blocked", "parked", "dead", "unverified", "server-error"];

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  // 最近秩法（nearest-rank）：小样本下比线性插值更诚实，不会报出样本里不存在的值
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

export function summarizeProbeSamples(samples: readonly ProbeSample[]): ProbeMetricsSummary {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<ProbeOutcomeKind, number>;
  const reasons = new Map<string, number>();
  const latencies: number[] = [];

  for (const sample of samples) {
    byKind[sample.kind] = (byKind[sample.kind] ?? 0) + 1;
    if (sample.reason) reasons.set(sample.reason, (reasons.get(sample.reason) ?? 0) + 1);
    if (typeof sample.latencyMs === "number" && Number.isFinite(sample.latencyMs) && sample.latencyMs >= 0) {
      latencies.push(sample.latencyMs);
    }
  }

  latencies.sort((a, b) => a - b);
  const buckets = LATENCY_BUCKETS_MS.map((le) => ({
    le: le as number | null,
    count: latencies.filter((ms) => ms <= le).length,
  }));
  buckets.push({ le: null, count: latencies.length });

  return {
    total: samples.length,
    byKind,
    measured: latencies.length,
    buckets,
    latency: {
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p99: percentile(latencies, 99),
      max: latencies.length > 0 ? (latencies[latencies.length - 1] ?? null) : null,
    },
    latencySum: latencies.reduce((acc, ms) => acc + ms, 0),
    reachabilityLower95: wilsonLowerBound(byKind.ok + byKind.blocked, samples.length),
    topReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
      .slice(0, 10),
  };
}

/** 把原因文案里的引号与换行处理掉，避免破坏 Prometheus 行格式 */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

export interface PrometheusOptions {
  /** 实例标识（多副本时区分来源） */
  instance?: string;
  /** 采样窗口起点（毫秒时间戳），作为注释输出，便于判断指标新鲜度 */
  since?: number;
}

/**
 * 输出 Prometheus 文本格式（exposition format 0.0.4）。
 * 指标名统一 `navhub_probe_` 前缀，`kind` 标签取值与 ProbeOutcomeKind 一致。
 */
export function toPrometheusText(summary: ProbeMetricsSummary, options: PrometheusOptions = {}): string {
  const lines: string[] = [];
  const instanceLabel = options.instance ? `,instance="${escapeLabel(options.instance)}"` : "";

  if (options.since) lines.push(`# 采样窗口起点: ${new Date(options.since).toISOString()}`);
  lines.push("# HELP navhub_probe_total 探活次数（按结论分类）");
  lines.push("# TYPE navhub_probe_total counter");
  for (const kind of KINDS) {
    lines.push(`navhub_probe_total{kind="${kind}"${instanceLabel}} ${summary.byKind[kind] ?? 0}`);
  }

  lines.push("# HELP navhub_probe_duration_ms 探活耗时分布（仅统计真正建立连接的样本）");
  lines.push("# TYPE navhub_probe_duration_ms histogram");
  for (const bucket of summary.buckets) {
    const le = bucket.le === null ? "+Inf" : String(bucket.le);
    lines.push(`navhub_probe_duration_ms_bucket{le="${le}"${instanceLabel}} ${bucket.count}`);
  }
  lines.push(`navhub_probe_duration_ms_sum${instanceLabel ? `{${instanceLabel.slice(1)}}` : ""} ${summary.latencySum}`);
  lines.push(`navhub_probe_duration_ms_count${instanceLabel ? `{${instanceLabel.slice(1)}}` : ""} ${summary.measured}`);

  lines.push("# HELP navhub_probe_latency_percentile_ms 延迟分位数（最近秩法）");
  lines.push("# TYPE navhub_probe_latency_percentile_ms gauge");
  for (const [q, value] of [
    ["p50", summary.latency.p50],
    ["p90", summary.latency.p90],
    ["p99", summary.latency.p99],
  ] as const) {
    if (value === null) continue;
    lines.push(`navhub_probe_latency_percentile_ms{quantile="${q}"${instanceLabel}} ${value}`);
  }

  lines.push("# HELP navhub_probe_reason_total 探活原因分布（Top 10）");
  lines.push("# TYPE navhub_probe_reason_total counter");
  for (const item of summary.topReasons) {
    lines.push(`navhub_probe_reason_total{reason="${escapeLabel(item.reason)}"${instanceLabel}} ${item.count}`);
  }

  return lines.join("\n") + "\n";
}
