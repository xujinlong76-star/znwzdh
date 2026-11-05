/**
 * 轻量进程内指标：不引入 prom-client，避免为一个 /metrics 端点加依赖。
 * 只记「有界基数」维度（method / 路由模板 / 状态码），绝不以原始 URL 作标签
 * ——否则 /api/search?q=xxx 会让时间序列爆炸（cardinality 失控是 Prometheus 头号杀手）。
 * 路由模板取自 Fastify 的 routeOptions.url（如 /api/sites/:id），天然有界。
 *
 * 由 server.ts 单体抽出（升级改造方案 P1-3）。
 */
import type { AppContext } from "./context.ts";
import { snapshotCacheInfo } from "./storage.ts";
import { cacheSnapshot, cachedSiteStats } from "./stats-cache.ts";
import { setOutboundObserver } from "@navhub/ai";
/**
 * 任务队列读数直接取自 JobRunner 的进程内登记表（P1-4）。
 *
 * 这里存在一条**刻意的**循环依赖：jobs.ts → llm-quota.ts → metrics.ts。
 * 安全的前提是所有引用都发生在调用时（renderMetrics 内部），模块初始化阶段
 * 只做类型/常量声明——两边都不在顶层读对方的绑定，因此不存在 TDZ 问题。
 * 换成「注入 provider」要多一层间接，而收益只是消除一个无害的环。
 */
import { JOB_KINDS, inFlightRunsSnapshot, jobStatsSnapshot } from "./jobs.ts";

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


/* ---------------- LLM 额度闸门观测（升级改造方案 P0-3） ---------------- */

/**
 * 额度拒绝计数：按「哪一档 + 哪个计量维度」展开，标签基数固定为 3×2=6。
 *
 * 为什么值得单独一档：拒绝发生在**调用之前**，所以 llm_usage 里不会有行——
 * 只看用量曲线无法回答「今天闸门拦掉了多少」。有了它，运维能区分
 * 「没人用」与「用量顶到上限被拦」，这两种情况的处置完全不同。
 */
const QUOTA_SCOPES = ["identity", "anonymous", "system"] as const;
const QUOTA_METRICS = ["calls", "tokens"] as const;
const quotaRejections = new Map<string, number>();
/** 拒绝完全由**在途预留**造成的次数：闸门开始吃并发时的第一手证据 */
let quotaRejectionsByReservation = 0;
/** 结算失败次数（预留只能等 TTL 回收，期间白占额度） */
let quotaSettleFailures = 0;

export function recordLlmQuotaRejected(scope: string, metric: string, blockedByReservation: boolean): void {
  const s = (QUOTA_SCOPES as readonly string[]).includes(scope) ? scope : "identity";
  const m = (QUOTA_METRICS as readonly string[]).includes(metric) ? metric : "calls";
  const key = `${s}\u0000${m}`;
  quotaRejections.set(key, (quotaRejections.get(key) ?? 0) + 1);
  if (blockedByReservation) quotaRejectionsByReservation++;
}

export function recordLlmQuotaSettleFailure(): void {
  quotaSettleFailures++;
}

export function getLlmQuotaRejectionStats(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const scope of QUOTA_SCOPES) {
    for (const metric of QUOTA_METRICS) {
      out[`${scope}|${metric}`] = quotaRejections.get(`${scope}\u0000${metric}`) ?? 0;
    }
  }
  return out;
}

/**
 * 在途预留读数同样走 5s 复用：它是 COUNT+SUM，抓取风暴下不能每次 /metrics 都打一遍表。
 *
 * 失败时返回上一次的缓存值（没有则 0）而不是抛出——预留 gauge 坏了不该让整条
 * /metrics 500，那会把「进程还活着」的探针一起带走。
 */
let quotaReservationsCache: { at: number; value: { active: number; tokens: number } } | null = null;
async function cachedQuotaReservations(ctx: AppContext): Promise<{ active: number; tokens: number }> {
  if (quotaReservationsCache && Date.now() - quotaReservationsCache.at < 5000) return quotaReservationsCache.value;
  try {
    const value = await ctx.repo.sumAllLlmQuotaReservations();
    quotaReservationsCache = { at: Date.now(), value: { active: value.active, tokens: value.tokens } };
    return quotaReservationsCache.value;
  } catch {
    return quotaReservationsCache?.value ?? { active: 0, tokens: 0 };
  }
}

/**
 * 快照版本号的健康态（升级改造方案 P1-1）。
 *
 * 三态而不是一个布尔：`data_version` 的**触发器创建失败**（权限受限的 PG 部署、
 * 并发启动撞 DDL）不会让服务起不来，但会让版本号冻结 —— 而冻结的版本号比没有
 * 版本号更危险，因为缓存看起来一直在正确失效。健康度必须能区分：
 *   - ok：触发器齐全且版本号读得到；
 *   - triggers_missing：应有而没有（写入不会 bump，缓存退回 TTL）；
 *   - unreadable：版本号本身读不到（老库没这张表 / 单行没种下 / 目录查询失败）。
 * 枚举固定为这三个值 ⇒ 序列数恒定。
 */
type SnapshotVersionHealth = "ok" | "triggers_missing" | "unreadable";
const SNAPSHOT_HEALTH_STATES: SnapshotVersionHealth[] = ["ok", "triggers_missing", "unreadable"];

/** 探针是一次目录查询（sqlite_master / pg_trigger），与 stats 同样 5s 复用，避免抓取风暴打库 */
let versionHealthCache: { at: number; value: SnapshotVersionHealth } | null = null;
async function cachedVersionHealth(ctx: AppContext): Promise<SnapshotVersionHealth> {
  if (versionHealthCache && Date.now() - versionHealthCache.at < 5000) return versionHealthCache.value;
  let value: SnapshotVersionHealth = "unreadable";
  try {
    const probe = await ctx.repo.navVersionProbe();
    if (probe.version === null) value = "unreadable";
    else value = probe.missing.length === 0 ? "ok" : "triggers_missing";
  } catch {
    value = "unreadable";
  }
  versionHealthCache = { at: Date.now(), value };
  return value;
}

/* ---------------- 任务队列观测（升级改造方案 P1-4） ---------------- */

/**
 * 待跑任务按 kind 的积压读数，5s 复用（与 stats 同口径）。
 *
 * 失败时退回上一次缓存（没有则空表 → 渲染成 0）：队列读数坏了不该让 /metrics 500，
 * 那会把「进程还活着」的探针一起带走。0 与「读不到」在抓取侧无法区分，所以
 * `navhub_job_queue_readable` 同时导出，别让一个坏掉的 GROUP BY 伪装成清空队列。
 */
let pendingByKindCache: { at: number; value: Map<string, number>; readable: boolean } | null = null;
async function cachedPendingByKind(ctx: AppContext): Promise<Map<string, number>> {
  if (pendingByKindCache && Date.now() - pendingByKindCache.at < 5000) return pendingByKindCache.value;
  try {
    const value = await ctx.repo.pendingJobsByKind();
    pendingByKindCache = { at: Date.now(), value, readable: true };
    return value;
  } catch {
    const value = pendingByKindCache?.value ?? new Map<string, number>();
    pendingByKindCache = { at: Date.now(), value, readable: false };
    return value;
  }
}

/* ---------------- 出站请求观测（升级改造方案 P2） ---------------- */

/**
 * 服务端主动出站的读数（富化、探活、插件体检、订阅源抓取、动态 REST 工具……
 * 全部经 `@navhub/ai` 的 `guardedFetch`，所以在这里一处接上就全覆盖）。
 *
 * 为什么维度是「结果分类 + 拦截原因」而不是目标域名：域名是无界的（用户能提交
 * 任意 URL），按域名打标签等于让时间序列随站点数量增长——这正是本文件开头写明
 * 的红线。想知道「哪个目标在失败」去看审计日志与任务台账，那里有完整上下文。
 *
 * 结果分四类而不是成功/失败两类（分类定义在 packages/ai 的 OutboundOutcome）：
 *   - ok：拿到 2xx/3xx 应答；
 *   - http_error：对端应答了但是 4xx/5xx —— 目标站的问题；
 *   - network_error：根本没拿到应答（DNS/连接/超时/跳数超限）—— 我们出口的问题；
 *   - blocked：SSRF 防护拦截 —— 有人在拿内网地址试探，或配置放行了不该放行的输入。
 * 拦截再按 reason 细分（reason 是代码里的有界枚举），因为「协议被拒」与
 * 「解析到 169.254.169.254」的处置完全不同：前者多是脏数据，后者是攻击。
 *
 * 没有按 profile（fetch/probe/candidate）再加一维：32 个调用点里只有 2 个真的
 * 走 profile 表，其余各自传超时常量，按 profile 打标签得到的只是一个九成落在
 * unknown 的假维度。想知道调用方，看任务台账与审计日志。
 */
const OUTBOUND_OUTCOMES = ["ok", "http_error", "blocked", "network_error"] as const;
type OutboundOutcomeName = (typeof OUTBOUND_OUTCOMES)[number];
/** SsrfBlockedError.reason 的有界枚举；未知一律归到 other，不让新原因悄悄造出新序列 */
const OUTBOUND_BLOCK_REASONS = [
  "malformed",
  "protocol",
  "no-host",
  "credentials",
  "blocked-port",
  "dns-timeout",
  "dns-failure",
  "dns-empty",
  "blocked-ip",
  "method",
  "header-injection",
  "unsupported-body",
  "body-not-allowed",
  "body-too-large",
] as const;
const outboundOutcomeCounts = new Map<OutboundOutcomeName, number>();
const outboundBlockCounts = new Map<string, number>();
let outboundRequests = 0;
let outboundHops = 0;
let outboundBytes = 0;
let outboundSecondsTotal = 0;

export function recordOutbound(observation: {
  outcome: string;
  reason: string | null;
  hops: number;
  bytes: number;
  durationMs: number;
}): void {
  const outcome = (OUTBOUND_OUTCOMES as readonly string[]).includes(observation.outcome)
    ? (observation.outcome as OutboundOutcomeName)
    : "network_error";
  outboundOutcomeCounts.set(outcome, (outboundOutcomeCounts.get(outcome) ?? 0) + 1);
  if (outcome === "blocked") {
    const reason = observation.reason && (OUTBOUND_BLOCK_REASONS as readonly string[]).includes(observation.reason)
      ? observation.reason
      : "other";
    outboundBlockCounts.set(reason, (outboundBlockCounts.get(reason) ?? 0) + 1);
  }
  outboundRequests += 1;
  // 失败路径的 hops 是 0（不知道走到第几跳），如实累加而不是按 1 估算
  outboundHops += Math.max(0, observation.hops);
  outboundBytes += Math.max(0, observation.bytes);
  outboundSecondsTotal += Math.max(0, observation.durationMs / 1000);
}

export function getOutboundStats(): {
  requests: number;
  byOutcome: Record<OutboundOutcomeName, number>;
  blockedByReason: Record<string, number>;
  hops: number;
  bytes: number;
  secondsTotal: number;
} {
  const byOutcome = {} as Record<OutboundOutcomeName, number>;
  for (const outcome of OUTBOUND_OUTCOMES) byOutcome[outcome] = outboundOutcomeCounts.get(outcome) ?? 0;
  const blockedByReason: Record<string, number> = {};
  // 全量导出（含 0）：只导非零值的话，「今天没有 blocked-ip 试探」和
  // 「这条序列还没被渲染」在 Grafana 里长得一模一样。
  for (const reason of [...OUTBOUND_BLOCK_REASONS, "other"]) {
    blockedByReason[reason] = outboundBlockCounts.get(reason) ?? 0;
  }
  return { requests: outboundRequests, byOutcome, blockedByReason, hops: outboundHops, bytes: outboundBytes, secondsTotal: outboundSecondsTotal };
}

/** 测试用：清零出站计数（进程内累加器，跨用例不复位会让断言互相污染） */
export function resetOutboundMetricsForTest(): void {
  outboundOutcomeCounts.clear();
  outboundBlockCounts.clear();
  outboundRequests = 0;
  outboundHops = 0;
  outboundBytes = 0;
  outboundSecondsTotal = 0;
}

/**
 * 把 `guardedFetch` 的观测接到本模块。
 *
 * 由 server.ts 在装配时调用一次。刻意不做模块初始化的副作用导入：测试里
 * 也会加载 @navhub/ai，自动注册会让「谁在什么时候开始计数」变成隐式约定。
 */
let outboundObserverInstalled = false;
export function installOutboundObserver(): void {
  if (outboundObserverInstalled) return;
  outboundObserverInstalled = true;
  setOutboundObserver((observation) => recordOutbound(observation));
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
  const stats = await cachedSiteStats(ctx);
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

  // 高频计数缓存（P1-5）：命中率突然掉到 0 通常意味着写入风暴或 TTL 被改小
  const cache = cacheSnapshot(ctx);
  metric("navhub_stats_cache_total", "全站计数缓存的命中/共享/回源次数", "counter", [
    `navhub_stats_cache_total{result="hit"} ${cache.stats.hits}`,
    `navhub_stats_cache_total{result="shared"} ${cache.stats.shared}`,
    `navhub_stats_cache_total{result="miss"} ${cache.stats.misses}`,
  ]);
  gauge("navhub_stats_refresh_seconds", "全站计数最近一次刷新耗时（秒）", Number((cache.stats.lastMs / 1000).toFixed(3)));
  metric("navhub_dashboard_cache_total", "管理总览缓存的命中/共享/回源次数", "counter", [
    `navhub_dashboard_cache_total{result="hit"} ${cache.dashboard.hits}`,
    `navhub_dashboard_cache_total{result="shared"} ${cache.dashboard.shared}`,
    `navhub_dashboard_cache_total{result="miss"} ${cache.dashboard.misses}`,
  ]);
  gauge("navhub_dashboard_refresh_seconds", "管理总览最近一次刷新耗时（秒）", Number((cache.dashboard.lastMs / 1000).toFixed(3)));

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

  // LLM 额度拒绝：三档×两维度固定全量导出（含 0），同上「没有序列 ≠ 没被拦」
  const quotaStats = getLlmQuotaRejectionStats();
  metric(
    "navhub_llm_quota_rejected_total",
    "LLM 额度闸门在调用前拒绝的请求数（按档位与计量维度；拒绝不落 llm_usage）",
    "counter",
    Object.entries(quotaStats).map(
      ([key, value]) =>
        `navhub_llm_quota_rejected_total{scope="${key.split("|")[0]}",metric="${key.split("|")[1]}"} ${value}`,
    ),
  );
  metric(
    "navhub_llm_quota_rejected_by_reservation_total",
    "仅由在途预留（而非已落账用量）造成的额度拒绝次数：>0 说明闸门开始吃并发",
    "counter",
    [`navhub_llm_quota_rejected_by_reservation_total ${quotaRejectionsByReservation}`],
  );
  metric(
    "navhub_llm_quota_settle_failures_total",
    "额度预留结算失败次数（行留在表里等 TTL 回收，期间白占额度）",
    "counter",
    [`navhub_llm_quota_settle_failures_total ${quotaSettleFailures}`],
  );
  // 在途预留：gauge，读 DB（与 stats 同样 5s 复用，避免抓取把表打满）
  const reservations = await cachedQuotaReservations(ctx);
  gauge(
    "navhub_llm_quota_reservations_active",
    "当前未结算的 LLM 额度预留行数（异常/断流的残留会在这里现形）",
    reservations.active,
  );
  gauge(
    "navhub_llm_quota_reserved_tokens",
    "当前在途预留占用的 token 合计（预留只用于并发判定，不参与成本统计）",
    reservations.tokens,
  );

  // 快照读缓存（升级改造方案 P1-1）
  // 命中的那一路现在只付一次主键点查（版本号），所以 hit/miss 比例是
  // 「读放大有没有真的消掉」的直接证据；build_seconds_total / builds_total
  // 相除得到平均重建成本，last_bytes 是网络上的那个体积。
  const snap = snapshotCacheInfo();
  metric(
    "navhub_snapshot_cache_total",
    "导航快照读缓存的命中与回源次数（miss 含冷启动与 TTL 过期）",
    "counter",
    [
      `navhub_snapshot_cache_total{result="hit"} ${snap.hits}`,
      `navhub_snapshot_cache_total{result="miss"} ${snap.misses}`,
    ],
  );
  metric(
    "navhub_snapshot_builds_total",
    "导航快照全量重建次数（每次都是一条类目 + 站点批量查询）",
    "counter",
    [`navhub_snapshot_builds_total ${snap.builds}`],
  );
  metric(
    "navhub_snapshot_build_seconds_total",
    "导航快照重建累计耗时（秒），与 builds_total 相除即平均重建成本",
    "counter",
    [`navhub_snapshot_build_seconds_total ${snap.buildSecondsTotal.toFixed(6)}`],
  );
  gauge("navhub_snapshot_last_build_seconds", "最近一次快照重建耗时（秒）", Number(snap.lastBuildSeconds.toFixed(6)));
  gauge("navhub_snapshot_last_bytes", "最近一次快照的序列化体积（字节）", snap.bytes);
  metric(
    "navhub_snapshot_degraded_reads_total",
    "版本号读不到、一致性退回 TTL 的快照读取次数（持续增长 = bump 触发器没生效或老库）",
    "counter",
    [`navhub_snapshot_degraded_reads_total ${snap.degradedReads}`],
  );
  gauge("navhub_snapshot_data_version", "当前缓存条目对应的导航数据版本号（0 也可能表示未取到，看 degraded_reads）", snap.version ?? 0);
  // 健康度三态固定全量导出（含 0）：只有一条为 1，缺序列等于状态未知
  const health = await cachedVersionHealth(ctx);
  metric(
    "navhub_snapshot_version_health",
    "导航版本号健康度（1=当前状态）：triggers_missing/unreadable 都意味着缓存退回 TTL",
    "gauge",
    SNAPSHOT_HEALTH_STATES.map((state) => `navhub_snapshot_version_health{state="${state}"} ${health === state ? 1 : 0}`),
  );

  // ---- 任务队列（P1-4） ----
  // 12 个 kind × 固定几族：序列数只随「任务种类」增长，不随用户数据增长。
  // 全部 kind 都导出（含 0）：「没有序列」与「积压为 0」必须能区分，
  // 否则某个 kind 的调度坏了，看板只会安静地少一行。
  const pendingByKind = await cachedPendingByKind(ctx);
  const runningByKind = new Map<string, number>();
  for (const inflight of inFlightRunsSnapshot()) {
    runningByKind.set(inflight.kind, (runningByKind.get(inflight.kind) ?? 0) + 1);
  }
  const statsByKind = new Map(jobStatsSnapshot().map((s) => [s.kind, s]));
  metric(
    "navhub_jobs_pending",
    "待认领任务数（按 kind；retrying 不计——退避是设计行为，不是积压）",
    "gauge",
    JOB_KINDS.map((kind) => `navhub_jobs_pending{kind="${kind}"} ${pendingByKind.get(kind) ?? 0}`),
  );
  metric(
    "navhub_jobs_running",
    "本进程正在执行的任务数（按 kind；含已要求停手、尚未确认收尾的）",
    "gauge",
    JOB_KINDS.map((kind) => `navhub_jobs_running{kind="${kind}"} ${runningByKind.get(kind) ?? 0}`),
  );
  metric(
    "navhub_job_runs_total",
    "本进程完成的任务执行次数（含成功、失败、超时与取消）",
    "counter",
    JOB_KINDS.map((kind) => `navhub_job_runs_total{kind="${kind}"} ${statsByKind.get(kind)?.runs ?? 0}`),
  );
  metric(
    "navhub_job_duration_seconds_total",
    "任务执行耗时合计（秒，只算 handler，不含排队）；除以 runs_total 即平均耗时",
    "counter",
    JOB_KINDS.map(
      (kind) =>
        `navhub_job_duration_seconds_total{kind="${kind}"} ${((statsByKind.get(kind)?.durationMsTotal ?? 0) / 1000).toFixed(3)}`,
    ),
  );
  metric(
    "navhub_job_failures_total",
    "任务失败次数（按 kind；超预算另行计入 timeouts，避免两类混读）",
    "counter",
    JOB_KINDS.map((kind) => `navhub_job_failures_total{kind="${kind}"} ${statsByKind.get(kind)?.failures ?? 0}`),
  );
  metric(
    "navhub_job_timeouts_total",
    "超出单次执行预算且已确认停手的次数（>0 说明预算偏紧或存在卡住的 handler）",
    "counter",
    JOB_KINDS.map((kind) => `navhub_job_timeouts_total{kind="${kind}"} ${statsByKind.get(kind)?.timeouts ?? 0}`),
  );
  metric(
    "navhub_job_cancels_total",
    "按用户请求停止的任务次数（分片边界停手，已提交部分保留）",
    "counter",
    JOB_KINDS.map((kind) => `navhub_job_cancels_total{kind="${kind}"} ${statsByKind.get(kind)?.cancels ?? 0}`),
  );
  gauge(
    "navhub_job_queue_readable",
    "任务积压读数是否可读（0=这次抓取读不到，积压序列退回上次缓存或 0）",
    pendingByKindCache?.readable === false ? 0 : 1,
  );

  /* 出站请求：升级方案 P2 的「我们主动访问别人」这一整面，之前完全没有读数 */
  const outbound = getOutboundStats();
  metric(
    "navhub_outbound_requests_total",
    "服务端主动发起的出站请求次数（按结果分类；blocked>0 说明有人在拿内网地址试探，network_error 高企是自家出口问题，http_error 高企是目标站问题）",
    "counter",
    OUTBOUND_OUTCOMES.map(
      (outcome) => `navhub_outbound_requests_total{outcome="${outcome}"} ${outbound.byOutcome[outcome]}`,
    ),
  );
  metric(
    "navhub_outbound_blocked_total",
    "SSRF 防护拦截次数（按拦截原因；reason=\"other\" 说明出现了本文件枚举之外的新原因，须补分类而不是放着不管）",
    "counter",
    Object.entries(outbound.blockedByReason).map(
      ([reason, count]) => `navhub_outbound_blocked_total{reason="${escLabel(reason)}"} ${count}`,
    ),
  );
  metric(
    "navhub_outbound_hops_total",
    "出站 HTTP 往返次数合计（含重定向跟随；除以 requests_total 即平均跳数，明显 >1 说明目标站在批量跳转或存在重定向环路风险）",
    "counter",
    [`navhub_outbound_hops_total ${outbound.hops}`],
  );
  metric(
    "navhub_outbound_response_bytes_total",
    "出站响应体字节数合计（按实际读入计：触发体积上限的请求只记到上限，所以这是自家带宽而不是对端页面总大小）",
    "counter",
    [`navhub_outbound_response_bytes_total ${outbound.bytes}`],
  );
  metric(
    "navhub_outbound_request_seconds_total",
    "出站请求耗时合计（秒，含 DNS 解析、逐跳重定向与读体）；除以 requests_total 即平均单次耗时",
    "counter",
    [`navhub_outbound_request_seconds_total ${outbound.secondsTotal.toFixed(3)}`],
  );

  return out.join("\n") + "\n";
}
