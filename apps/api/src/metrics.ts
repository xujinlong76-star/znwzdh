/**
 * 轻量进程内指标：不引入 prom-client，避免为一个 /metrics 端点加依赖。
 * 只记「有界基数」维度（method / 路由模板 / 状态码），绝不以原始 URL 作标签
 * ——否则 /api/search?q=xxx 会让时间序列爆炸（cardinality 失控是 Prometheus 头号杀手）。
 * 路由模板取自 Fastify 的 routeOptions.url（如 /api/sites/:id），天然有界。
 *
 * 由 server.ts 单体抽出（升级改造方案 P1-3）。
 */
import type { AppContext } from "./context.ts";

const metricsStartedAt = Date.now();
/** key: method\u0000route\u0000status -> 次数 */
const httpCounts = new Map<string, number>();

/**
 * 延迟直方图的固定桶（秒）。
 *
 * 为什么从「500 条环形缓冲 + 内存排序」换成固定桶：
 *  1. 环缓只能回答「本进程最近 500 条」，重启即丢、多实例无法合并；
 *     而 SLO 要看的是「过去 5 分钟 P95」，跨实例、跨重启都得能算。
 *  2. 固定桶可以导出成 Prometheus histogram，`histogram_quantile` / 多窗口
 *     burn-rate 告警直接可用（这是 D3 的目标）；环缓在 /metrics 上只能给
 *     summary 的 _sum/_count，根本推不出分位数。
 *  3. 桶边界覆盖 5ms~10s：本机 P50 在几毫秒、P95 几十~几百毫秒，
 *     LLM/富化类路由到秒级；超出 10s 的落进 +Inf，不丢样本。
 */
export const HTTP_DURATION_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
const BUCKET_COUNT = HTTP_DURATION_BUCKETS_S.length + 1; // 末尾为 +Inf

interface DurationHistogram {
  count: number;
  sumMs: number;
  /** 非累计：每档只装落在该档的样本，导出时再算累计 */
  buckets: number[];
}

/** key: method\u0000route */
const httpDurations = new Map<string, DurationHistogram>();
/** 全局直方图：summary API 的 P50/P95/P99 从这里算，口径与 /metrics 一致 */
const globalDurations: DurationHistogram = { count: 0, sumMs: 0, buckets: new Array(BUCKET_COUNT).fill(0) };

const SECOND_BUCKETS = 60;
const secondCounts = new Array(SECOND_BUCKETS).fill(0);
const secondTimestamps = new Array(SECOND_BUCKETS).fill(0);

function bucketIndex(elapsedMs: number): number {
  const seconds = elapsedMs / 1000;
  for (let i = 0; i < HTTP_DURATION_BUCKETS_S.length; i++) {
    if (seconds <= HTTP_DURATION_BUCKETS_S[i]!) return i;
  }
  return HTTP_DURATION_BUCKETS_S.length;
}

function observe(hist: DurationHistogram, elapsedMs: number): void {
  const ms = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;
  hist.count += 1;
  hist.sumMs += ms;
  const idx = bucketIndex(ms);
  hist.buckets[idx] = (hist.buckets[idx] ?? 0) + 1;
}

/**
 * 从固定桶估算分位数（与 Prometheus `histogram_quantile` 同法：桶内线性插值）。
 * 返回毫秒；+Inf 档只能给「最高有限边界」作为下界估计。
 */
export function quantileFromBuckets(buckets: readonly number[], count: number, q: number): number {
  if (count <= 0) return 0;
  const rank = Math.min(Math.max(q, 0), 1) * count;
  let prevCum = 0;
  let prevUpperS = 0;
  for (let i = 0; i < buckets.length; i++) {
    const inBucket = buckets[i] ?? 0;
    const cum = prevCum + inBucket;
    if (cum >= rank) {
      const upperS = i < HTTP_DURATION_BUCKETS_S.length ? HTTP_DURATION_BUCKETS_S[i]! : null;
      if (upperS === null) return prevUpperS * 1000;
      const fraction = inBucket > 0 ? (rank - prevCum) / inBucket : 0;
      return (prevUpperS + (upperS - prevUpperS) * fraction) * 1000;
    }
    prevCum = cum;
    if (i < HTTP_DURATION_BUCKETS_S.length) prevUpperS = HTTP_DURATION_BUCKETS_S[i]!;
  }
  return prevUpperS * 1000;
}

/** onResponse hook 调用：记录一次请求（server.ts 负责挂 hook，这里只存数据） */
export function recordHttpMetric(route: string, method: string, status: number, elapsedMs: number): void {
  const ckey = method + "\u0000" + route + "\u0000" + String(status);
  httpCounts.set(ckey, (httpCounts.get(ckey) ?? 0) + 1);
  const dkey = method + "\u0000" + route;
  const d = httpDurations.get(dkey) ?? { count: 0, sumMs: 0, buckets: new Array(BUCKET_COUNT).fill(0) };
  observe(d, elapsedMs);
  httpDurations.set(dkey, d);
  observe(globalDurations, elapsedMs);

  // 秒级计数滑动桶（用于毫秒级平滑 QPS 估算）
  const sec = Math.floor(Date.now() / 1000);
  const slot = sec % SECOND_BUCKETS;
  if (secondTimestamps[slot] === sec) {
    secondCounts[slot]++;
  } else {
    secondTimestamps[slot] = sec;
    secondCounts[slot] = 1;
  }
}

export interface HttpMetricsSummary {
  uptimeSeconds: number;
  totalRequests: number;
  qps: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  statusCodes: {
    s2xx: number;
    s3xx: number;
    s4xx: number;
    s5xx: number;
    errorRate: number;
  };
  topSlowRoutes: Array<{ route: string; method: string; avgLatencyMs: number; count: number }>;
  topHotRoutes: Array<{ route: string; method: string; count: number }>;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
}

export function getHttpMetricsSummary(): HttpMetricsSummary {
  const now = Date.now();
  const uptimeSeconds = Math.max(1, Math.round((now - metricsStartedAt) / 1000));

  // 计算滑动窗口 QPS
  const curSec = Math.floor(now / 1000);
  let recentReqSum = 0;
  let activeSecs = 0;
  for (let i = 0; i < SECOND_BUCKETS; i++) {
    const t = secondTimestamps[i];
    if (t && curSec - t < 60) {
      recentReqSum += secondCounts[i];
      activeSecs++;
    }
  }
  const qps = activeSecs > 0 ? Math.round((recentReqSum / activeSecs) * 10) / 10 : 0;

  // 状态码聚合与总请求
  let totalRequests = 0;
  let s2xx = 0;
  let s3xx = 0;
  let s4xx = 0;
  let s5xx = 0;

  for (const [k, count] of httpCounts.entries()) {
    const [, , statusStr] = splitKey(k);
    totalRequests += count;
    if (statusStr.startsWith("2")) s2xx += count;
    else if (statusStr.startsWith("3")) s3xx += count;
    else if (statusStr.startsWith("4")) s4xx += count;
    else if (statusStr.startsWith("5")) s5xx += count;
  }
  const errorRate = totalRequests > 0 ? Math.round(((s4xx + s5xx) / totalRequests) * 1000) / 10 : 0;

  // 延迟分位数：从全局固定桶估算（与 /metrics 的 histogram 同源，重启前口径一致）
  const avgLatencyMs = globalDurations.count > 0
    ? Math.round((globalDurations.sumMs / globalDurations.count) * 10) / 10
    : 0;
  const p50LatencyMs = Math.round(quantileFromBuckets(globalDurations.buckets, globalDurations.count, 0.5) * 10) / 10;
  const p95LatencyMs = Math.round(quantileFromBuckets(globalDurations.buckets, globalDurations.count, 0.95) * 10) / 10;
  const p99LatencyMs = Math.round(quantileFromBuckets(globalDurations.buckets, globalDurations.count, 0.99) * 10) / 10;

  // 慢路由 Top 5 (avgLatencyMs >= 5ms, sorted by avgLatency desc)
  const routeStats: Array<{ route: string; method: string; avgLatencyMs: number; count: number }> = [];
  for (const [k, d] of httpDurations.entries()) {
    const [method, route] = splitKey(k);
    routeStats.push({
      route,
      method,
      count: d.count,
      avgLatencyMs: d.count > 0 ? Math.round((d.sumMs / d.count) * 10) / 10 : 0,
    });
  }
  const topSlowRoutes = [...routeStats]
    .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
    .slice(0, 5);

  const topHotRoutes = [...routeStats]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((r) => ({ route: r.route, method: r.method, count: r.count }));

  const mem = process.memoryUsage();
  return {
    uptimeSeconds,
    totalRequests,
    qps,
    avgLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    statusCodes: {
      s2xx,
      s3xx,
      s4xx,
      s5xx,
      errorRate,
    },
    topSlowRoutes,
    topHotRoutes,
    memory: {
      rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
    },
  };
}

/** 转义 Prometheus 文本格式的标签值（反斜杠 / 引号 / 换行） */
const escLabel = (v: string): string => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
/** 还原采集时的复合 key；缺失位以空串兜底（noUncheckedIndexedAccess 友好） */
const splitKey = (k: string): [string, string, string] => {
  const p = k.split("\u0000");
  return [p[0] ?? "", p[1] ?? "", p[2] ?? ""];
};

/* ---------------- 检索通道观测（升级 #6：Query Planner 效果量化） ---------------- */

/** planner 决策计数：early-exit（剪掉语义） vs full（全通道） */
let plannerEarlyExit = 0;
let plannerFull = 0;
/** 语义通道未执行的次数（planner 剪枝或调用方显式 disableSemantic，≈ 省下的 embedding 推理） */
let semanticSkipped = 0;
/** 各通道累计耗时（毫秒，通道自身墙钟；并行区间可重叠） */
const channelSums = { exact: 0, fts: 0, pinyin: 0, semantic: 0 };
let channelSamples = 0;

/** routes/search.ts 在每次检索后调用：记录 planner 决策、通道耗时与语义剪枝 */
export function recordSearchChannels(
  t: {
    exactMs: number;
    ftsMs: number;
    pinyinMs: number;
    semanticMs: number;
    skippedSemantic: boolean;
  },
  /** search() 的真实 planner 决策（"early-exit" | "full"）；不要从 skippedSemantic 反推——
   *  显式 disableSemantic 的请求语义没跑但并非 planner 剪枝，反推会让 early_exit 计数虚高 */
  decision: "early-exit" | "full",
): void {
  if (decision === "early-exit") {
    plannerEarlyExit++;
  } else {
    plannerFull++;
  }
  if (t.skippedSemantic) semanticSkipped++;
  channelSums.exact += t.exactMs;
  channelSums.fts += t.ftsMs;
  channelSums.pinyin += t.pinyinMs;
  channelSums.semantic += t.semanticMs;
  channelSamples++;
}

export function getSearchPlannerStats(): {
  earlyExit: number;
  full: number;
  semanticSkipped: number;
  samples: number;
  avgMs: { exact: number; fts: number; pinyin: number; semantic: number };
} {
  const avg = (s: number) => (channelSamples > 0 ? Math.round((s / channelSamples) * 10) / 10 : 0);
  return {
    earlyExit: plannerEarlyExit,
    full: plannerFull,
    semanticSkipped,
    samples: channelSamples,
    avgMs: { exact: avg(channelSums.exact), fts: avg(channelSums.fts), pinyin: avg(channelSums.pinyin), semantic: avg(channelSums.semantic) },
  };
}

/* ---------------- 检索写入失败观测（run54） ---------------- */

/**
 * 降级写入的失败计数：事件 / 零结果 / 历史 / 通道观测。
 *
 * 为什么不能只 `.catch(() => undefined)`：写入失败与「这次搜索本来就没数据」
 * 在响应和后续读数里完全同形——HTTP 200、库里没有行，运维无法区分
 * 「用户没搜」与「搜了但没记上」。这里只记固定四类（有界基数），
 * 主链路仍降级继续，但失败可通过 /api/metrics 的 counter 速率看见。
 */
export type SearchWriteComponent = "event_search" | "event_zero_result" | "history" | "channels";
const SEARCH_WRITE_COMPONENTS: SearchWriteComponent[] = ["event_search", "event_zero_result", "history", "channels"];
const searchWriteFailures = new Map<SearchWriteComponent, number>();

export function recordSearchWriteFailure(component: SearchWriteComponent): void {
  searchWriteFailures.set(component, (searchWriteFailures.get(component) ?? 0) + 1);
}

export function getSearchWriteFailureStats(): Record<SearchWriteComponent, number> {
  return {
    event_search: searchWriteFailures.get("event_search") ?? 0,
    event_zero_result: searchWriteFailures.get("event_zero_result") ?? 0,
    history: searchWriteFailures.get("history") ?? 0,
    channels: searchWriteFailures.get("channels") ?? 0,
  };
}

/* ---------------- 检索建议读失败观测（run59） ---------------- */

/**
 * 建议读侧（topQueries / zeroResultQueries）失败次数。
 *
 * 与写失败分开：读失败不改变检索命中，只是建议区退化为空；混进
 * search_write_failures_total 会让「数据没写进去」与「建议没读出来」
 * 同形，而两者的排查方向完全不同。无标签，恒导出 0。
 */
let searchSuggestionsDegraded = 0;

export function recordSearchSuggestionsDegraded(): void {
  searchSuggestionsDegraded++;
}

export function getSearchSuggestionsDegradedCount(): number {
  return searchSuggestionsDegraded;
}

/** DB 统计加重询，避免 Prometheus 高频抓取把 COUNT 打满（5s 内复用；缓存为模块级，跨请求生效） */
let statsCache: { at: number; value: Awaited<ReturnType<AppContext["repo"]["stats"]>> } | null = null;
async function cachedStats(ctx: AppContext) {
  if (statsCache && Date.now() - statsCache.at < 5000) return statsCache.value;
  const value = await ctx.repo.stats();
  statsCache = { at: Date.now(), value };
  return value;
}

export async function renderMetrics(ctx: AppContext): Promise<string> {
  const out: string[] = [];
  const metric = (name: string, help: string, type: "gauge" | "counter" | "summary" | "histogram", lines: string[]) => {
    if (lines.length === 0) return;
    out.push("# HELP " + name + " " + help);
    out.push("# TYPE " + name + " " + type);
    out.push(...lines);
  };
  const gauge = (name: string, help: string, value: number, labels = "") =>
    metric(name, help, "gauge", [name + labels + " " + value]);

  const mem = process.memoryUsage();
  const caps = ctx.capabilities;
  const embeddingReady = ctx.embedding ? ctx.embedding.ready() : false;
  const stats = await cachedStats(ctx);
  const planner = getSearchPlannerStats();

  out.push("# HELP navhub_build_info 构建与运行模式信息（值恒为 1）");
  out.push("# TYPE navhub_build_info gauge");
  out.push(`navhub_build_info{mode="${escLabel(ctx.config.mode)}",node="${escLabel(process.version)}"} 1`);

  gauge("navhub_up", "进程存活（值恒为 1）", 1);
  gauge("navhub_process_uptime_seconds", "进程运行时长（秒）", Math.round((Date.now() - metricsStartedAt) / 1000));
  gauge("navhub_process_resident_memory_bytes", "常驻内存 RSS（字节）", mem.rss);
  gauge("navhub_process_heap_used_bytes", "V8 堆已用（字节）", mem.heapUsed);
  gauge("navhub_process_heap_total_bytes", "V8 堆总量（字节）", mem.heapTotal);

  // 能力开关：0/1，便于告警「语义检索掉线」
  metric("navhub_capability", "能力开关（1=可用）", "gauge", [
    `navhub_capability{name="semantic"} ${caps.semantic ? 1 : 0}`,
    `navhub_capability{name="fts"} ${caps.fts ? 1 : 0}`,
    `navhub_capability{name="llm"} ${caps.llm ? 1 : 0}`,
  ]);
  gauge("navhub_embedding_ready", "embedding 模型是否已加载", embeddingReady ? 1 : 0);

  // 数据规模
  metric("navhub_sites", "站点数（按状态）", "gauge", [
    `navhub_sites{status="active"} ${stats.sites}`,
    `navhub_sites{status="broken"} ${stats.broken}`,
    `navhub_sites{status="pending"} ${stats.pending}`,
    `navhub_sites{status="trashed"} ${stats.trashed}`,
  ]);
  gauge("navhub_categories_total", "分类数", stats.categories);
  gauge("navhub_tags_total", "标签数", stats.tags);

  // HTTP：请求计数（method × 路由模板 × 状态码）
  const countLines = [...httpCounts.entries()].map(([k, n]) => {
    const [method, route, status] = splitKey(k);
    return `navhub_http_requests_total{method="${escLabel(method)}",route="${escLabel(route)}",status="${escLabel(status)}"} ${n}`;
  }).sort();
  metric("navhub_http_requests_total", "HTTP 请求总数", "counter", countLines);

  // HTTP：耗时直方图（_bucket 累计 + _sum 秒 + _count）
  const durLines: string[] = [];
  for (const [k, d] of [...httpDurations.entries()].sort()) {
    const [method, route] = splitKey(k);
    const labels = `{method="${escLabel(method)}",route="${escLabel(route)}"`;
    let cumulative = 0;
    for (let i = 0; i < d.buckets.length; i++) {
      cumulative += d.buckets[i] ?? 0;
      const le = i < HTTP_DURATION_BUCKETS_S.length ? String(HTTP_DURATION_BUCKETS_S[i]) : "+Inf";
      durLines.push(`navhub_http_request_duration_seconds_bucket${labels},le="${le}"} ${cumulative}`);
    }
    durLines.push(`navhub_http_request_duration_seconds_sum${labels}} ${(d.sumMs / 1000).toFixed(6)}`);
    durLines.push(`navhub_http_request_duration_seconds_count${labels}} ${d.count}`);
  }
  metric("navhub_http_request_duration_seconds", "HTTP 请求耗时（秒）", "histogram", durLines);

  // 检索 planner：early-exit 剪枝计数 + 各通道平均耗时（毫秒）
  metric("navhub_search_planner_total", "Query Planner 决策总数", "counter", [
    `navhub_search_planner_total{decision="early_exit"} ${planner.earlyExit}`,
    `navhub_search_planner_total{decision="full"} ${planner.full}`,
  ]);
  metric("navhub_search_semantic_skipped_total", "语义通道未执行次数（planner 剪枝或显式禁用，≈省下的 embedding 推理）", "counter", [
    `navhub_search_semantic_skipped_total ${planner.semanticSkipped}`,
  ]);
  metric("navhub_search_channel_avg_ms", "检索各通道平均耗时（毫秒）", "gauge", [
    `navhub_search_channel_avg_ms{channel="exact"} ${planner.avgMs.exact}`,
    `navhub_search_channel_avg_ms{channel="fts"} ${planner.avgMs.fts}`,
    `navhub_search_channel_avg_ms{channel="pinyin"} ${planner.avgMs.pinyin}`,
    `navhub_search_channel_avg_ms{channel="semantic"} ${planner.avgMs.semantic}`,
  ]);

  // 检索写入失败：四类固定组件全量暴露（含 0），避免「没有序列」与「没失败」混淆
  const writeFailures = getSearchWriteFailureStats();
  metric(
    "navhub_search_write_failures_total",
    "检索写入失败次数（事件/零结果/历史/通道观测；失败≠空，主链路已降级继续）",
    "counter",
    SEARCH_WRITE_COMPONENTS.map((c) => `navhub_search_write_failures_total{component="${c}"} ${writeFailures[c]}`),
  );

  // 检索建议读失败：独立于写失败；恒导出 0，区分「没有降级」与「序列不存在」
  metric(
    "navhub_search_suggestions_degraded_total",
    "搜索建议读失败降级次数（建议区为空，检索命中不受影响）",
    "counter",
    [`navhub_search_suggestions_degraded_total ${getSearchSuggestionsDegradedCount()}`],
  );

  return out.join("\n") + "\n";
}
