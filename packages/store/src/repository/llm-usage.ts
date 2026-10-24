/**
 * LLM 用量明细的写入与聚合（观测面板的唯一真实数据源）。
 *
 * 背景：`/api/admin/ai/observability` 之前在没有数据时伪造 168 次调用与
 * 正弦曲线，而业务调用（富化/巡检/任务）从不记录 token 与延迟 —— 面板
 * 只能靠编。这里补上真实数据层：
 *
 *   - 写入：每次模型调用一条（成功与失败都记，失败记 error_code）；
 *   - 聚合：总量 / 成功率 / p50 / p95 / 按场景 / 按来源 / 真实小时分桶；
 *   - 合计：`sumLlmUsage` 只回三个标量，是额度闸门每次调用前的读路径；
 *   - 清理：按 retention 删除旧行（与 events 的保留策略一致）。
 *
 * 身份只存调用方传入的标识（匿名 anonId 或登录 userId），与 events 表口径一致；
 * 不存 prompt / 响应内容 —— 观测要的是「用得多不多、快不快、错不错」，
 * 不是内容审计。
 */
import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";

export interface LlmUsageInput {
  /** 业务场景：enrich / ai_chat / canvas / health_audit / config_test / vision */
  scenario: string;
  /** 配置来源：user / system / env / default（来自 resolveLlm().source） */
  source: string;
  model: string;
  identity?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  ok: boolean;
  errorCode?: string | null;
  /** 本次是否启用了深度思考 */
  thinking?: boolean;
}

export interface LlmUsageRecord extends Required<Omit<LlmUsageInput, "identity">> {
  id: string;
  identity: string | null;
  createdAt: number;
}

export interface LlmUsageAggregate {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  /** 百分比（0-100），无调用时为 null 而不是 100 —— 「没有数据」不等于「全成功」 */
  successRate: number | null;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** 无调用时为 null（不要用 0 或假值冒充） */
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  thinkingCalls: number;
  byScenario: Array<{ scenario: string; count: number; tokens: number; avgLatencyMs: number; errorCalls: number }>;
  bySource: Array<{ source: string; count: number; tokens: number }>;
  /** 最近 24 小时（本地时区）真实分桶；没有调用的小时为 0 */
  hourly: Array<{ hour: number; calls: number; tokens: number; avgLatencyMs: number }>;
  /** 统计窗口内最早一条的时间；无数据为 null */
  firstAt: number | null;
}

const SCENARIO_MAX = 40;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 写入一条用量（失败静默：观测绝不能反噬业务调用） */
export async function recordLlmUsage(repo: Repository, input: LlmUsageInput): Promise<void> {
  try {
    await repo.run(
      "INSERT INTO llm_usage (id, scenario, source, model, identity, prompt_tokens, completion_tokens, latency_ms, ok, error_code, thinking, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        String(input.scenario).slice(0, SCENARIO_MAX),
        String(input.source).slice(0, 20),
        String(input.model).slice(0, 120),
        input.identity ? String(input.identity).slice(0, 64) : null,
        Math.max(0, Math.round(num(input.promptTokens))),
        Math.max(0, Math.round(num(input.completionTokens))),
        Math.max(0, Math.round(num(input.latencyMs))),
        // 布尔必须按原生类型传：SQLite 由 bindSqlite 转 0/1，PostgreSQL 的
        // ok/thinking 是真 BOOLEAN 列，传整数会直接报类型错误（写入被 catch 吞掉，
        // 观测面板永远没有数据）。
        Boolean(input.ok),
        input.errorCode ? String(input.errorCode).slice(0, 40) : null,
        Boolean(input.thinking),
        Date.now(),
      ],
    );
  } catch (err) {
    console.warn("[navhub] LLM 用量写入失败（不影响调用结果）:", err);
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? null;
}

/**
 * 聚合窗口内的用量。
 *
 * 为什么小时分桶放在 JS 而不是 SQL：sqlite 的 `strftime('%H', ...)` 与
 * Postgres 的 `to_char(to_timestamp(...))` 时区语义不同，且都按 UTC 分桶，
 * 面板显示的是本地时间。只拉 `created_at + latency_ms + tokens` 三列
 * （上限 2 万行）在内存分桶，语义一致且可单测。
 */
export async function aggregateLlmUsage(
  repo: Repository,
  options: { since: number; until?: number; maxRows?: number },
): Promise<LlmUsageAggregate> {
  const since = options.since;
  const until = options.until ?? Date.now();
  const maxRows = Math.min(Math.max(options.maxRows ?? 20_000, 100), 50_000);

  const grouped = await repo.raw(
    // 布尔条件写成 `WHEN ok THEN`（而不是 `ok = 0`）：PostgreSQL 里 ok 是 BOOLEAN，
    // 与整数比较会抛 `operator does not exist: boolean = integer`；SQLite 的 0/1
    // 在 CASE WHEN 里同样可用，因此这一种写法对两个方言都成立。
    // MIN(created_at) 也随之放进聚合：窗口内最早一条不再受下面明细 LIMIT 影响。
    "SELECT scenario, source, COUNT(*) AS cnt, SUM(prompt_tokens) AS pt, SUM(completion_tokens) AS ct, SUM(latency_ms) AS lt, SUM(CASE WHEN ok THEN 0 ELSE 1 END) AS errs, SUM(CASE WHEN thinking THEN 1 ELSE 0 END) AS think, MIN(created_at) AS first_at FROM llm_usage WHERE created_at >= ? AND created_at <= ? GROUP BY scenario, source",
    [since, until],
  );

  const rows = await repo.raw(
    "SELECT created_at, latency_ms, prompt_tokens, completion_tokens, ok FROM llm_usage WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT ?",
    [since, until, maxRows],
  );

  let totalCalls = 0;
  let errorCalls = 0;
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let thinkingCalls = 0;
  const scenarioMap = new Map<string, { count: number; tokens: number; latency: number; errorCalls: number }>();
  const sourceMap = new Map<string, { count: number; tokens: number }>();

  for (const row of grouped) {
    const cnt = num(row.cnt);
    const pt = num(row.pt);
    const ct = num(row.ct);
    const lt = num(row.lt);
    const errs = num(row.errs);
    const think = num(row.think);

    totalCalls += cnt;
    errorCalls += errs;
    promptTokens += pt;
    completionTokens += ct;
    totalTokens += pt + ct;
    thinkingCalls += think;

    const scenario = String(row.scenario ?? "unknown");
    const prev = scenarioMap.get(scenario) ?? { count: 0, tokens: 0, latency: 0, errorCalls: 0 };
    prev.count += cnt;
    prev.tokens += pt + ct;
    prev.latency += lt;
    prev.errorCalls += errs;
    scenarioMap.set(scenario, prev);

    const source = String(row.source ?? "unknown");
    const prevSrc = sourceMap.get(source) ?? { count: 0, tokens: 0 };
    prevSrc.count += cnt;
    prevSrc.tokens += pt + ct;
    sourceMap.set(source, prevSrc);
  }

  // 延迟分位数与小时分桶：来自明细行
  const latencies: number[] = [];
  const buckets = new Map<number, { calls: number; tokens: number; latency: number }>();
  // firstAt 取聚合里的 MIN(created_at)：明细行有 LIMIT，不能用来判断窗口起点
  let firstAt: number | null = null;
  for (const row of grouped) {
    const at = num(row.first_at);
    if (at > 0 && (firstAt === null || at < firstAt)) firstAt = at;
  }

  for (const row of rows) {
    const at = num(row.created_at);
    const lat = num(row.latency_ms);
    const tokens = num(row.prompt_tokens) + num(row.completion_tokens);
    if (lat > 0) latencies.push(lat);
    const hour = new Date(at).getHours();
    const b = buckets.get(hour) ?? { calls: 0, tokens: 0, latency: 0 };
    b.calls += 1;
    b.tokens += tokens;
    b.latency += lat;
    buckets.set(hour, b);
  }
  latencies.sort((a, b) => a - b);

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const b = buckets.get(hour);
    if (!b || b.calls === 0) return { hour, calls: 0, tokens: 0, avgLatencyMs: 0 };
    return {
      hour,
      calls: b.calls,
      tokens: b.tokens,
      avgLatencyMs: Math.round(b.latency / b.calls),
    };
  });

  const successCalls = totalCalls - errorCalls;

  return {
    totalCalls,
    successCalls,
    errorCalls,
    // 无调用时给 null：让 UI 显示「暂无数据」，而不是 100% 成功的假象
    successRate: totalCalls > 0 ? Number(((successCalls / totalCalls) * 100).toFixed(1)) : null,
    totalTokens,
    promptTokens,
    completionTokens,
    avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    thinkingCalls,
    byScenario: Array.from(scenarioMap.entries())
      .map(([scenario, v]) => ({
        scenario,
        count: v.count,
        tokens: v.tokens,
        avgLatencyMs: v.count > 0 ? Math.round(v.latency / v.count) : 0,
        errorCalls: v.errorCalls,
      }))
      .sort((a, b) => b.count - a.count),
    bySource: Array.from(sourceMap.entries())
      .map(([source, v]) => ({ source, count: v.count, tokens: v.tokens }))
      .sort((a, b) => b.count - a.count),
    hourly,
    firstAt,
  };
}

/**
 * 窗口内的用量合计（次数 / token / 失败数），供额度闸门使用。
 *
 * 与 `aggregateLlmUsage` 的分工：那个要分场景、分来源、小时分桶，给面板看；
 * 这里只要三个标量，且必须在**每次模型调用前**跑，所以走单条聚合 SQL、
 * 不拉明细行（明细拉回来再在 JS 里加，等于给额度检查加一次全窗口扫描）。
 *
 * `identity` 三态：
 *   - 传字符串 -> 只算这个身份（登录 userId / 匿名 anonId 都是字符串）；
 *   - 显式传 null -> 只算 `identity IS NULL` 的行（任务队列、巡检等无归属流量，
 *     它们共用同一个池，所以这一档天然是「合池」而非「每人」）；
 *   - 不传（undefined）-> 全窗口合计，用于保护运维者那把系统 key 的总预算。
 *
 * `excludeUserSource` 只算 `source <> 'user'` 的行：即**花运维者 key** 的那部分。
 * 用户自带密钥（source='user'）不计入全局预算，否则一个人配了 key 就把全站额度吃掉。
 *
 * `firstAt` 是窗口内最早一条的时间：滚动额度下它决定什么时候腾出空间，
 * 服务端据此给 `Retry-After`（给「now+24h」会让用户白等半天）。
 */
export interface LlmUsageTotals {
  calls: number;
  tokens: number;
  errorCalls: number;
  firstAt: number | null;
}

export async function sumLlmUsage(
  repo: Repository,
  options: { since: number; until?: number; identity?: string | null; excludeUserSource?: boolean },
): Promise<LlmUsageTotals> {
  const since = options.since;
  const until = options.until ?? Date.now();
  const args: unknown[] = [since, until];
  // ok 在 PostgreSQL 是 BOOLEAN、在 SQLite 是 0/1：`CASE WHEN ok` 对两个方言都成立，
  // `ok = 0` 只在 SQLite 成立（详见 recordLlmUsage 里的同类注释）。
  let sql =
    "SELECT COUNT(*) AS calls, COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens, " +
    "SUM(CASE WHEN ok THEN 0 ELSE 1 END) AS errs, MIN(created_at) AS first_at FROM llm_usage " +
    "WHERE created_at >= ? AND created_at <= ?";
  if (options.identity !== undefined) {
    if (options.identity === null) sql += " AND identity IS NULL";
    else {
      sql += " AND identity = ?";
      args.push(String(options.identity).slice(0, 64));
    }
  }
  if (options.excludeUserSource) {
    sql += " AND source <> 'user'";
  }
  const rows = await repo.raw(sql, args);
  const row = rows[0] ?? {};
  const firstAt = num(row.first_at);
  return {
    calls: num(row.calls),
    tokens: num(row.tokens),
    errorCalls: num(row.errs),
    firstAt: firstAt > 0 ? firstAt : null,
  };
}

/** 最近 N 条调用明细（新→旧），用于「最近请求」列表 */
export async function listRecentLlmUsage(repo: Repository, limit = 20): Promise<LlmUsageRecord[]> {
  const cap = Math.min(Math.max(limit, 1), 100);
  const rows = await repo.raw(
    "SELECT id, scenario, source, model, identity, prompt_tokens, completion_tokens, latency_ms, ok, error_code, thinking, created_at FROM llm_usage ORDER BY created_at DESC LIMIT ?",
    [cap],
  );
  return rows.map((r) => ({
    id: String(r.id),
    scenario: String(r.scenario ?? ""),
    source: String(r.source ?? ""),
    model: String(r.model ?? ""),
    identity: r.identity ? String(r.identity) : null,
    promptTokens: num(r.prompt_tokens),
    completionTokens: num(r.completion_tokens),
    latencyMs: num(r.latency_ms),
    ok: r.ok === true || num(r.ok) === 1,
    errorCode: r.error_code ? String(r.error_code) : null,
    thinking: r.thinking === true || num(r.thinking) === 1,
    createdAt: num(r.created_at),
  }));
}

/** 删除 before 之前的用量行（retention 任务调用），返回删除条数 */
export async function pruneLlmUsage(repo: Repository, before: number): Promise<number> {
  const rows = await repo.raw("SELECT COUNT(*) AS cnt FROM llm_usage WHERE created_at < ?", [before]);
  const count = num(rows[0]?.cnt);
  if (count > 0) {
    await repo.run("DELETE FROM llm_usage WHERE created_at < ?", [before]);
  }
  return count;
}
