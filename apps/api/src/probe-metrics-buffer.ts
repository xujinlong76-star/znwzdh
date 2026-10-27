/**
 * 探活指标的进程内采样缓冲。
 *
 * 为什么放内存而不是数据库：指标是**运行态观测**，不是业务数据。
 * 落库要维护 SQLite/PG 两套 DDL、还要配套保留策略；而运营真正要的是
 * 「这一轮体检为什么掉下来了」，进程内最近 5000 条足够回答。
 * 多副本场景下每个实例各自暴露自己的指标，由 Prometheus 侧做聚合——这正是
 * 标准做法（instance 标签），不需要我们在应用层做分布式汇总。
 *
 * 内存占用：5000 × ~120 字节 ≈ 600KB，可忽略；超出后按环形覆盖最旧的样本。
 */
import {
  classifyProbeStatus,
  isBotBlockedStatus,
  summarizeProbeSamples,
  toPrometheusText,
  type ProbeOutcomeKind,
  type ProbeSample,
} from "@navhub/core";
import type { UrlProbeResult } from "./plugin-audit.ts";

/** 保留窗口：最近 5000 条探活 */
const MAX_SAMPLES = 5_000;

const samples: ProbeSample[] = [];
let startedAt = Date.now();

/**
 * 抽样体检结果 → 指标结论。
 *
 * 这里刻意不重写判定：状态码交给 `classifyProbeStatus`，剩下只有「内容层」
 * （suspicious）与「超时」两类需要本层补充，因为它们不在状态码里。
 */
export function probeSampleOf(result: UrlProbeResult): ProbeSample {
  let kind: ProbeOutcomeKind;
  if (result.suspicious) {
    kind = "parked";
  } else if (result.ok) {
    kind = "ok";
  } else if (result.blocked ?? isBotBlockedStatus(result.status ?? 0)) {
    kind = "blocked";
  } else if (result.error === "timeout" || result.failureKind === "timeout") {
    kind = "unverified";
  } else {
    const byStatus = typeof result.status === "number" ? classifyProbeStatus(result.status) : null;
    kind = byStatus ? byStatus.kind : "dead";
  }

  const reason = result.suspiciousReason ?? result.error ?? (result.status ? `HTTP ${result.status}` : undefined);
  return {
    kind,
    ...(typeof result.latencyMs === "number" ? { latencyMs: result.latencyMs } : {}),
    ...(reason ? { reason } : {}),
    at: Date.now(),
  };
}

/** 记录一轮体检的样本（环形覆盖，永不抛错） */
export function recordProbeResults(results: readonly UrlProbeResult[]): void {
  if (results.length === 0) return;
  for (const result of results) {
    if (samples.length >= MAX_SAMPLES) samples.shift();
    samples.push(probeSampleOf(result));
  }
}

/** 汇总当前窗口 */
export function probeMetricsSummary() {
  return summarizeProbeSamples(samples);
}

/** 导出 Prometheus 文本 */
export function probeMetricsPrometheus(instance?: string): string {
  return toPrometheusText(probeMetricsSummary(), { instance, since: startedAt });
}

/** 测试与运维用：清空窗口 */
export function resetProbeMetrics(): void {
  samples.length = 0;
  startedAt = Date.now();
}
