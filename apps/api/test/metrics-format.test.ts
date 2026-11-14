/**
 * /api/metrics 的 Prometheus 文本格式守卫（P4）。
 *
 * 现有 api.test.ts 只断言「包含某些值」；这个文件锁的是格式与基数约束本身：
 *  - 每个样本都必须先有 # HELP / # TYPE，TYPE 合法，家庭不重复；
 *  - 样本名 / 数值 / 标签语法合法，同一序列不重复；
 *  - counter 必须 `_total` 结尾，gauge / summary 不得冒充 counter；
 *  - summary 的 `_sum` / `_count` 必须成对；
 *  - 标签只允许有界维度白名单，`route` 必须是 Fastify 路由模板（不得出现查询串）；
 *    枚举型标签（scope / metric）连**值**一起锁——名字合规但值是身份串，基数照样无界；
 *  - 指标家庭清单做 inline snapshot：改名、改类型、新增都会显式失败。
 *
 * 为什么不做全量快照：uptime / 内存 / 请求数每次都变，只有「结构」可快照。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HTTP_DURATION_BUCKETS_S,
  getOutboundStats,
  quantileFromBuckets,
  recordHttpMetric,
  recordLlmQuotaRejected,
  recordLlmQuotaSettleFailure,
  recordOutbound,
  renderMetrics,
  resetOutboundMetricsForTest,
} from "../src/metrics.ts";
import type { AppContext } from "../src/context.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, "..");

const ALLOWED_TYPES = new Set(["counter", "gauge", "summary", "histogram"]);
/** 新增标签必须显式更新这里——这是防止「原始 URL / 用户输入进标签」的最后一道闸。 */
const ALLOWED_LABELS = new Set(["method", "route", "status", "name", "channel", "decision", "mode", "node", "component", "scope", "metric", "le", "result", "state", "kind", "outcome", "reason"]);
/**
 * 白名单只锁住标签**名**；名合规但值无界一样会打爆基数（把 identity 塞进 scope，
 * /metrics 的序列数就随用户数增长，抓取本身变成 DoS）。所以枚举型标签连值一起锁。
 */
const ALLOWED_LABEL_VALUES: Record<string, Set<string>> = {
  // 额度闸门的档位与计量维度：与 config.llmQuota 的六个数字一一对应，3×2=6 条固定序列
  scope: new Set(["identity", "anonymous", "system"]),
  metric: new Set(["calls", "tokens"]),
  // 缓存读数（P1-1 快照 / P1-5 高频计数）：hit 命中、miss 回源、shared 等他人刷新的并发请求
  result: new Set(["hit", "miss", "shared"]),
  // 版本号健康度（P1-1）：三态固定，缺序列等于状态未知
  state: new Set(["ok", "triggers_missing", "unreadable"]),
  // 任务队列（P1-4）：kind 必须与 JOB_KINDS 逐字一致（16 个固定值），
  // 任何新增 kind 都会在这里被拦下来——否则新任务的指标会静默缺席。
  kind: new Set([
    "health_check",
    "refetch_metadata",
    "recompute_rank",
    "reindex",
    "site_self_healing",
    "token_audit",
    "purge_trash",
    "taxonomy_audit",
    "data_retention",
    "plugin_governance",
    "user_data_audit",
    "backup_restore",
    "hotlist_refresh",
    "daily_brief",
    "drama_update_check",
    "drama_calendar_refresh",
  ]),
  // 出站请求（P2）：outcome 是 guardedFetch 的四种结局，reason 是 SSRF 拦截原因的
  // 有界枚举。这两组值由 @navhub/ai 传进来（不是本包的常量），正是「外部输入借道
  // 标签把基数撑爆」最现实的入口——所以在这里逐值锁死，新原因必须先登记。
  outcome: new Set(["ok", "http_error", "blocked", "network_error"]),
  reason: new Set([
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
    "other",
  ]),
};
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
/**
 * Prometheus 约定 `_total` 留给 counter，但这两个「规模计数」是历史已发布的 gauge 名。
 * 不在此轮改名（会破坏外部看板）；显式登记，阻止新增 gauge 继续占用 `_total`。
 */
const GAUGE_TOTAL_ALLOWLIST = new Set(["navhub_categories_total", "navhub_tags_total"]);

const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const SAMPLE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})?\s+(\S+)$/;
const LABEL_RE = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
/** 路由模板：/api/sites/:id、/s/:code、/ ……不含查询串/空格/井号 */
const ROUTE_RE = /^\/[A-Za-z0-9_\-.:/]*$/;

interface Sample {
  name: string;
  labelsRaw: string;
  labels: Record<string, string>;
  value: number;
}

interface Family {
  help: string | null;
  type: string | null;
  samples: Sample[];
}

function fakeContext(): AppContext {
  return {
    config: { mode: "lite" },
    capabilities: { semantic: false, fts: true, llm: false },
    embedding: null,
    repo: {
      stats: async () => ({ sites: 5, broken: 1, pending: 2, trashed: 3, categories: 4, tags: 6 }),
      // 刻意用可识别的非零值：gauge 恒为 0 时，「读不到」与「真的没有在途」无法区分，
      // 而 sumAllLlmQuotaReservations 抛错也被渲染层吞掉降级成 0——不接上就发现不了。
      sumAllLlmQuotaReservations: async () => ({ active: 7, tokens: 12345 }),
      // 任务积压（P1-4）：非零值同样是为了让「积压读不到」与「积压为 0」可区分。
      pendingJobsByKind: async () => new Map([["health_check", 3], ["backup_restore", 1]]),
      // 快照版本号探针（P1-1）：给可识别的非零版本、触发器齐全，
      // 这样「健康度恒为 unreadable」这类接线漏接会立刻显形。
      navVersionProbe: async () => ({ version: 42, present: ["nav_version_sites_insert"], missing: [] }),
      // 高频计数缓存（P1-5）的前置读：缺了会退回纯 TTL，测试里给固定版本
      readNavDataVersion: async () => 42,
    },
  } as unknown as AppContext;
}

/** 严格解析标签块：拒绝空块、重复键、尾逗号、未解析残渣与非法转义。 */
function parseLabels(raw: string | undefined): { raw: string; labels: Record<string, string> } {
  if (!raw) return { raw: "", labels: {} };
  if (!raw.startsWith("{") || !raw.endsWith("}")) throw new Error("标签块未闭合: " + raw);
  const inner = raw.slice(1, -1);
  if (inner.length === 0) throw new Error("空标签块: " + raw);

  const labels: Record<string, string> = {};
  let cursor = 0;
  for (const m of inner.matchAll(LABEL_RE)) {
    if (m.index !== cursor) throw new Error("标签之间有未解析内容: " + raw);
    const key = m[1]!;
    const value = m[2]!;
    if (key in labels) throw new Error("重复标签 " + key + ": " + raw);
    if (/\\(?![\\"n])/.test(value)) throw new Error("非法转义: " + raw);
    labels[key] = value;
    cursor = m.index + m[0].length;
    if (inner[cursor] === ",") {
      cursor += 1;
      if (cursor >= inner.length) throw new Error("标签尾逗号: " + raw);
    } else if (cursor !== inner.length) {
      throw new Error("标签块结构异常: " + raw);
    }
  }
  if (cursor !== inner.length) throw new Error("标签块未完全解析: " + raw);
  return { raw, labels };
}

function parseExposition(text: string): { families: Map<string, Family>; samples: Sample[] } {
  const families = new Map<string, Family>();
  const samples: Sample[] = [];

  const touch = (name: string): Family => {
    const existing = families.get(name);
    if (existing) return existing;
    const created: Family = { help: null, type: null, samples: [] };
    families.set(name, created);
    return created;
  };

  for (const line of text.split("\n")) {
    if (line === "") continue;

    if (line.startsWith("# HELP ")) {
      const rest = line.slice("# HELP ".length);
      const sp = rest.indexOf(" ");
      if (sp <= 0) throw new Error("HELP 行格式非法: " + line);
      const name = rest.slice(0, sp);
      if (!NAME_RE.test(name)) throw new Error("HELP 指标名非法: " + line);
      const f = touch(name);
      if (f.help !== null) throw new Error("重复 HELP: " + name);
      f.help = rest.slice(sp + 1);
      continue;
    }

    if (line.startsWith("# TYPE ")) {
      const rest = line.slice("# TYPE ".length);
      const sp = rest.indexOf(" ");
      if (sp <= 0) throw new Error("TYPE 行格式非法: " + line);
      const name = rest.slice(0, sp);
      const type = rest.slice(sp + 1);
      if (!NAME_RE.test(name)) throw new Error("TYPE 指标名非法: " + line);
      if (!ALLOWED_TYPES.has(type)) throw new Error("未知 TYPE: " + line);
      const f = touch(name);
      if (f.type !== null) throw new Error("重复 TYPE: " + name);
      f.type = type;
      continue;
    }

    // 普通注释（当前渲染器不产生，允许但不校验）
    if (line.startsWith("#")) continue;

    const m = SAMPLE_RE.exec(line);
    if (!m) throw new Error("无法解析样本行: " + line);
    const name = m[1]!;
    if (!NAME_RE.test(name)) throw new Error("样本名非法: " + line);
    const { raw, labels } = parseLabels(m[2]);
    const value = Number(m[3]);
    if (!Number.isFinite(value)) throw new Error("样本值非有限数: " + line);

    const base = name.replace(/_(bucket|sum|count)$/, "");
    const family = families.get(name) ?? families.get(base);
    if (!family || family.type === null) throw new Error("样本没有对应的 # TYPE 家族: " + line);
    family.samples.push({ name, labelsRaw: raw, labels, value });
    samples.push({ name, labelsRaw: raw, labels, value });
  }

  return { families, samples };
}

/**
 * 取某个序列的值；序列不存在直接失败。
 * 「没有序列」和「值为 0」是两件事：前者意味着这条观测根本没接上。
 */
function sampleValue(body: string, line: string): number {
  const match = body.split("\n").find((l) => l.startsWith(line + " "));
  expect(match, "缺少序列 " + line).toBeTruthy();
  return Number(match!.split(" ")[1]);
}

describe("Prometheus 指标格式", () => {
  let text: string;
  let parsed: ReturnType<typeof parseExposition>;

  beforeAll(async () => {
    // 造三条有界序列：路由模板 + 不同状态码；足够覆盖 counter / summary 两种形态。
    recordHttpMetric("/api/sites/:id", "GET", 200, 12.5);
    recordHttpMetric("/api/search", "GET", 200, 3);
    recordHttpMetric("/api/sites/:id", "GET", 500, 40);
    text = await renderMetrics(fakeContext());
    parsed = parseExposition(text);
  });

  it("以单个 LF 结尾，行尾没有 CR，也没有空行", () => {
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).not.toContain("\r");
    expect(text.split("\n").slice(0, -1).every((l) => l.length > 0)).toBe(true);
  });

  it("每个家庭都有非空 HELP 与合法 TYPE，且至少有一条样本", () => {
    expect(parsed.families.size).toBeGreaterThan(0);
    for (const [name, f] of parsed.families) {
      expect(f.help, name + " 缺少 HELP").toBeTruthy();
      expect(ALLOWED_TYPES.has(f.type ?? ""), name + " 缺少/非法 TYPE").toBe(true);
      expect(f.samples.length, name + " 没有任何样本").toBeGreaterThan(0);
    }
  });

  it("样本名、数值与标签语法合法，同一序列不重复", () => {
    const seen = new Set<string>();
    for (const s of parsed.samples) {
      expect(NAME_RE.test(s.name)).toBe(true);
      expect(Number.isFinite(s.value)).toBe(true);
      const key = s.name + s.labelsRaw;
      expect(seen.has(key), "重复序列: " + key).toBe(false);
      seen.add(key);
    }
  });

  it("类型约定：counter 以 _total 结尾，gauge / summary 不新增 _total", () => {
    for (const [name, f] of parsed.families) {
      if (f.type === "counter") {
        expect(name.endsWith("_total"), "counter 必须以 _total 结尾: " + name).toBe(true);
      } else if (name.endsWith("_total")) {
        expect(GAUGE_TOTAL_ALLOWLIST.has(name), "非 counter 不得以 _total 结尾: " + name).toBe(true);
      }
      // 样本名与家庭类型的对应关系：summary / histogram 用 _sum/_count（+ _bucket），其余同名
      for (const s of f.samples) {
        if (f.type === "summary") {
          expect(s.name === name + "_sum" || s.name === name + "_count", "summary 样本名异常: " + s.name).toBe(true);
        } else if (f.type === "histogram") {
          expect(
            s.name === name + "_bucket" || s.name === name + "_sum" || s.name === name + "_count",
            "histogram 样本名异常: " + s.name,
          ).toBe(true);
        } else {
          expect(s.name, "非 summary 样本名必须等于家庭名: " + s.name).toBe(name);
        }
      }
    }
  });

  it("summary 的 _sum / _count 成对出现，且标签完全一致", () => {
    for (const [name, f] of parsed.families) {
      if (f.type !== "summary") continue;
      const groups = new Map<string, string[]>();
      for (const s of f.samples) {
        const list = groups.get(s.labelsRaw) ?? [];
        list.push(s.name);
        groups.set(s.labelsRaw, list);
      }
      for (const [labels, names] of groups) {
        expect(names.sort(), "summary 序列 " + name + labels + " 未成对").toEqual([
          name + "_count",
          name + "_sum",
        ]);
      }
    }
  });

  it("标签只允许有界维度白名单，route 必须是路由模板", () => {
    for (const s of parsed.samples) {
      for (const [key, value] of Object.entries(s.labels)) {
        expect(ALLOWED_LABELS.has(key), "出现未登记标签 " + key).toBe(true);
        const enumValues = ALLOWED_LABEL_VALUES[key];
        if (enumValues) {
          expect(enumValues.has(value), `标签 ${key} 的值不在枚举内（基数无界）: ${value}`).toBe(true);
        }
      }
      // method / route / status 是 HTTP 指标专用；navhub_sites 的 status 是站点状态，不能按状态码校验。
      if (!s.name.startsWith("navhub_http_")) continue;
      const route = s.labels.route;
      if (route !== undefined) {
        expect(ROUTE_RE.test(route), "route 不是路由模板: " + route).toBe(true);
        expect(route).not.toContain("?");
        expect(route).not.toContain("#");
        expect(route.length).toBeLessThanOrEqual(120);
      }
      const method = s.labels.method;
      if (method !== undefined) {
        expect(ALLOWED_METHODS.has(method), "未知 HTTP 方法: " + method).toBe(true);
      }
      const status = s.labels.status;
      if (status !== undefined) {
        expect(/^[1-5][0-9]{2}$/.test(status), "非法状态码标签: " + status).toBe(true);
      }
    }
  });

  it("histogram：桶累计单调、+Inf 覆盖全量、_count 与 +Inf 一致", () => {
    const groupKey = (s: Sample) =>
      Object.entries(s.labels)
        .filter(([k]) => k !== "le")
        .map(([k, v]) => k + "=" + v)
        .sort()
        .join(",");
    for (const [name, f] of parsed.families) {
      if (f.type !== "histogram") continue;
      const buckets = f.samples.filter((s) => s.name === name + "_bucket");
      expect(buckets.length, name + " 没有任何桶序列").toBeGreaterThan(0);
      const groups = new Map<string, Sample[]>();
      for (const s of buckets) {
        const key = groupKey(s);
        groups.set(key, [...(groups.get(key) ?? []), s]);
      }
      for (const [key, list] of groups) {
        const inf = list.find((s) => s.labels.le === "+Inf");
        expect(inf, name + "{" + key + "} 缺少 +Inf 桶").toBeTruthy();
        const finite = list
          .filter((s) => s !== inf)
          .sort((a, b) => Number(a.labels.le) - Number(b.labels.le));
        for (const s of finite) {
          expect(Number.isFinite(Number(s.labels.le)), "非法 le 值: " + s.labels.le).toBe(true);
        }
        let prev = -1;
        for (const s of [...finite, inf!]) {
          expect(s.value, "桶计数必须单调不减: " + key).toBeGreaterThanOrEqual(prev);
          prev = s.value;
        }
        const count = f.samples.find((s) => s.name === name + "_count" && groupKey(s) === key);
        expect(count, name + "{" + key + "} 缺少 _count").toBeTruthy();
        expect(count!.value, "histogram _count 必须等于 +Inf 桶").toBe(inf!.value);
        const sum = f.samples.find((s) => s.name === name + "_sum" && groupKey(s) === key);
        expect(sum, name + "{" + key + "} 缺少 _sum").toBeTruthy();
        expect(sum!.value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("指标家庭清单快照（改名/改类型/新增会失败）", () => {
    const schema = [...parsed.families.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, f]) => name + " " + f.type)
      .join("\n");
    expect(schema).toMatchInlineSnapshot(`
      "navhub_build_info gauge
      navhub_capability gauge
      navhub_categories_total gauge
      navhub_dashboard_cache_total counter
      navhub_dashboard_refresh_seconds gauge
      navhub_embedding_ready gauge
      navhub_http_request_duration_seconds histogram
      navhub_http_requests_total counter
      navhub_job_cancels_total counter
      navhub_job_duration_seconds_total counter
      navhub_job_failures_total counter
      navhub_job_queue_readable gauge
      navhub_job_runs_total counter
      navhub_job_timeouts_total counter
      navhub_jobs_pending gauge
      navhub_jobs_running gauge
      navhub_llm_quota_rejected_by_reservation_total counter
      navhub_llm_quota_rejected_total counter
      navhub_llm_quota_reservations_active gauge
      navhub_llm_quota_reserved_tokens gauge
      navhub_llm_quota_settle_failures_total counter
      navhub_outbound_blocked_total counter
      navhub_outbound_hops_total counter
      navhub_outbound_request_seconds_total counter
      navhub_outbound_requests_total counter
      navhub_outbound_response_bytes_total counter
      navhub_process_heap_total_bytes gauge
      navhub_process_heap_used_bytes gauge
      navhub_process_resident_memory_bytes gauge
      navhub_process_uptime_seconds gauge
      navhub_search_channel_avg_ms gauge
      navhub_search_planner_total counter
      navhub_search_semantic_skipped_total counter
      navhub_search_suggestions_degraded_total counter
      navhub_search_write_failures_total counter
      navhub_sites gauge
      navhub_snapshot_build_seconds_total counter
      navhub_snapshot_builds_total counter
      navhub_snapshot_cache_total counter
      navhub_snapshot_data_version gauge
      navhub_snapshot_degraded_reads_total counter
      navhub_snapshot_last_build_seconds gauge
      navhub_snapshot_last_bytes gauge
      navhub_snapshot_version_health gauge
      navhub_stats_cache_total counter
      navhub_stats_refresh_seconds gauge
      navhub_tags_total gauge
      navhub_up gauge"
    `);
  });

  it("标签值按 Prometheus 规则转义（反斜杠 / 引号 / 换行）", async () => {
    // 路由模板在真实服务里不会包含这些字符；这里直接调用记录函数验证渲染层转义。
    recordHttpMetric('/api/weird"x\\y\nz', "GET", 200, 1);
    const withWeird = await renderMetrics(fakeContext());
    const line = withWeird
      .split("\n")
      .find((l) => l.startsWith("navhub_http_requests_total{") && l.includes("weird"));
    expect(line).toBeTruthy();
    expect(line).toContain('\\"');
    expect(line).toContain("\\\\");
    expect(line).toContain("\\n");
  });
});

describe("直方图分位数估算", () => {
  const buckets = () => new Array(HTTP_DURATION_BUCKETS_S.length + 1).fill(0);

  it("没有样本时返回 0", () => {
    expect(quantileFromBuckets(buckets(), 0, 0.95)).toBe(0);
  });

  it("桶内线性插值：10 个样本全在 (10ms, 25ms]，P50 = 17.5ms", () => {
    const b = buckets();
    b[2] = 10; // 0.01 < x <= 0.025
    expect(quantileFromBuckets(b, 10, 0.5)).toBeCloseTo(17.5, 5);
  });

  it("超出最高有限边界的样本按最高边界给下界估计", () => {
    const b = buckets();
    b[b.length - 1] = 4; // +Inf
    expect(quantileFromBuckets(b, 4, 0.95)).toBe(10_000);
  });

  it("跨桶累计：P95 落在含 95% 样本的那个桶里", () => {
    const b = buckets();
    b[0] = 90; // <= 5ms
    b[4] = 10; // (50ms, 100ms]
    // rank=95，落在第 4 桶；prevCum=90，该桶 10 个，fraction=0.5 → 50 + 50*0.5 = 75ms
    expect(quantileFromBuckets(b, 100, 0.95)).toBeCloseTo(75, 5);
  });
});

describe("采集接线（防止指标退化）", () => {
  it("server.ts 使用路由模板做 route 标签，并且不把 /api/metrics 自身计入", () => {
    const src = readFileSync(resolve(API_ROOT, "src/server.ts"), "utf8");
    expect(src).toContain("recordHttpMetric(");
    expect(src).toContain("routeOptions?.url");
    expect(src).toContain('route !== "/api/metrics"');
  });

  it("health.ts 返回 Prometheus 0.0.4 文本格式", () => {
    const src = readFileSync(resolve(API_ROOT, "src/routes/health.ts"), "utf8");
    expect(src).toContain("text/plain; version=0.0.4");
  });

  it("额度闸门在调用点记录拒绝与结算失败，不是只在 metrics.ts 里自说自话", () => {
    const src = readFileSync(resolve(API_ROOT, "src/llm-quota.ts"), "utf8");
    expect(src).toContain("recordLlmQuotaRejected(");
    expect(src).toContain("recordLlmQuotaSettleFailure(");
  });
});

describe("额度闸门指标（P0-3）", () => {
  it("越界的档位/维度被夹回枚举，不会长出第 7 条序列", async () => {
    // 传进来的是「本该被拒的形态」：身份串当档位、不存在的维度名当 metric。
    recordLlmQuotaRejected("anon:someone", "requests", false);
    recordLlmQuotaRejected("system", "tokens", true);
    recordLlmQuotaSettleFailure();
    const body = await renderMetrics(fakeContext());

    const series = [...body.matchAll(/^navhub_llm_quota_rejected_total\{scope="([^"]+)",metric="([^"]+)"\} \d+$/gm)];
    expect(series, "拒绝计数必须固定导出 3×2=6 条序列（含 0）").toHaveLength(6);
    const scopes = [...new Set(series.map((m) => m[1]))].sort();
    const dims = [...new Set(series.map((m) => m[2]))].sort();
    expect(scopes).toEqual(["anonymous", "identity", "system"]);
    expect(dims).toEqual(["calls", "tokens"]);

    // 夹回枚举后仍要计入，否则「越界输入」被静默丢弃 = 拒绝次数低估
    expect(sampleValue(body, 'navhub_llm_quota_rejected_total{scope="identity",metric="calls"}')).toBeGreaterThanOrEqual(1);
    expect(sampleValue(body, 'navhub_llm_quota_rejected_total{scope="system",metric="tokens"}')).toBeGreaterThanOrEqual(1);
    expect(sampleValue(body, "navhub_llm_quota_rejected_by_reservation_total")).toBeGreaterThanOrEqual(1);
    expect(sampleValue(body, "navhub_llm_quota_settle_failures_total")).toBeGreaterThanOrEqual(1);
  });

  it("在途预留 gauge 反映仓储读数，而不是恒 0 的占位", async () => {
    const body = await renderMetrics(fakeContext());
    expect(sampleValue(body, "navhub_llm_quota_reservations_active")).toBe(7);
    expect(sampleValue(body, "navhub_llm_quota_reserved_tokens")).toBe(12345);
  });

  it("预留读数取不到时降级为 0，但序列照样存在（不能让整条 /metrics 500）", async () => {
    const broken = {
      ...fakeContext(),
      repo: {
        stats: async () => ({ sites: 0, broken: 0, pending: 0, trashed: 0, categories: 0, tags: 0 }),
        sumAllLlmQuotaReservations: async () => {
          throw new Error("表不存在");
        },
      },
    } as unknown as AppContext;
    // 前面用例的 7/12345 已经在 5s 缓存里；换一个全新的模块实例才能测到「取不到」而不是「缓存」。
    // 不用墙钟等待，也避免这条用例把整轮跑慢 5 秒。
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const body = await fresh.renderMetrics(broken);
    expect(sampleValue(body, "navhub_llm_quota_reservations_active")).toBe(0);
    expect(sampleValue(body, "navhub_llm_quota_reserved_tokens")).toBe(0);
    // 降级不能顺带把「进程还活着」的探针一起带走
    expect(sampleValue(body, "navhub_up")).toBe(1);
  });
});

describe("快照读缓存指标（P1-1）", () => {
  it("版本号健康度固定三条序列，且恰有一条为 1", async () => {
    const body = await renderMetrics(fakeContext());
    const series = [...body.matchAll(/^navhub_snapshot_version_health\{state="([^"]+)"\} ([01])$/gm)];
    expect(series, "健康度必须固定导出三态（含 0），缺序列等于状态未知").toHaveLength(3);
    expect(series.filter((m) => m[2] === "1").map((m) => m[1])).toEqual(["ok"]);
  });

  it("探针抛错时报 unreadable，而不是当成 ok（/metrics 不能被带走）", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const broken = {
      ...fakeContext(),
      repo: {
        ...fakeContext().repo,
        navVersionProbe: async () => {
          throw new Error("没有权限读目录");
        },
      },
    } as unknown as AppContext;
    const body = await fresh.renderMetrics(broken);
    expect(sampleValue(body, 'navhub_snapshot_version_health{state="unreadable"}')).toBe(1);
    expect(sampleValue(body, 'navhub_snapshot_version_health{state="ok"}')).toBe(0);
    expect(sampleValue(body, "navhub_up")).toBe(1);
  });

  it("版本号可读但触发器缺失时报 triggers_missing（冻结的版本号比没有更危险）", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const frozen = {
      ...fakeContext(),
      repo: {
        ...fakeContext().repo,
        navVersionProbe: async () => ({ version: 7, present: ["nav_version_sites_insert"], missing: ["nav_version_sites_update"] }),
      },
    } as unknown as AppContext;
    const body = await fresh.renderMetrics(frozen);
    expect(sampleValue(body, 'navhub_snapshot_version_health{state="triggers_missing"}')).toBe(1);
    expect(sampleValue(body, 'navhub_snapshot_version_health{state="ok"}')).toBe(0);
  });

  it("版本号读不到时报 unreadable（即使触发器都在——没有 bump 目标）", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const noRow = {
      ...fakeContext(),
      repo: {
        ...fakeContext().repo,
        navVersionProbe: async () => ({ version: null, present: ["nav_version_sites_insert"], missing: [] }),
      },
    } as unknown as AppContext;
    const body = await fresh.renderMetrics(noRow);
    expect(sampleValue(body, 'navhub_snapshot_version_health{state="unreadable"}')).toBe(1);
    expect(sampleValue(body, 'navhub_snapshot_version_health{state="ok"}')).toBe(0);
  });

  it("命中/回源两态固定导出，值非负", async () => {
    const body = await renderMetrics(fakeContext());
    expect(sampleValue(body, 'navhub_snapshot_cache_total{result="hit"}')).toBeGreaterThanOrEqual(0);
    expect(sampleValue(body, 'navhub_snapshot_cache_total{result="miss"}')).toBeGreaterThanOrEqual(0);
    expect(sampleValue(body, "navhub_snapshot_builds_total")).toBeGreaterThanOrEqual(0);
    expect(sampleValue(body, "navhub_snapshot_build_seconds_total")).toBeGreaterThanOrEqual(0);
    expect(sampleValue(body, "navhub_snapshot_degraded_reads_total")).toBeGreaterThanOrEqual(0);
  });

  it("接线守卫：storage.ts 真的读版本号，且 COUNT 指纹没有被写回来", () => {
    const src = readFileSync(resolve(API_ROOT, "src/storage.ts"), "utf8");
    expect(src).toContain("ctx.repo.readNavDataVersion()");
    // 指纹是「命中也要付一次聚合」的那条路；它回来 = P1-1 白做，而且缓存会重新变成 TTL 一致性。
    expect(src).not.toContain("snapshotFingerprint");
    expect(src).not.toMatch(/SELECT\s*\n?\s*\(SELECT COUNT\(\*\) FROM sites\)/);
  });
});

/**
 * 高频计数缓存指标（P1-5）。
 *
 * hit/shared/miss 三类**固定导出**：hit 归零本身不说明问题（全站还没人读就都是 0），
 * 但某一类整行消失会让人分不清「没有共享」和「共享计数器忘了接线」。
 */
describe("计数缓存指标（P1-5）", () => {
  it("三类结果固定导出，刷新耗时非负", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const body = await fresh.renderMetrics(fakeContext());
    for (const result of ["hit", "shared", "miss"]) {
      expect(sampleValue(body, `navhub_stats_cache_total{result="${result}"}`)).toBeGreaterThanOrEqual(0);
      expect(sampleValue(body, `navhub_dashboard_cache_total{result="${result}"}`)).toBeGreaterThanOrEqual(0);
    }
    expect(sampleValue(body, "navhub_stats_refresh_seconds")).toBeGreaterThanOrEqual(0);
    expect(sampleValue(body, "navhub_dashboard_refresh_seconds")).toBeGreaterThanOrEqual(0);
  });
});

/**
 * 任务队列指标（P1-4）。
 *
 * 判据同其它族：12 个 kind 必须**全部**有序列（含 0）——「少一行」在抓取侧
 * 与「积压为 0」看起来一样，某个 kind 的调度坏了会安静地查不出来。
 */
describe("任务队列指标（P1-4）", () => {
  it("pending/running 按 kind 全量导出，非零值不被抹平", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const body = await fresh.renderMetrics(fakeContext());
    expect(sampleValue(body, 'navhub_jobs_pending{kind="health_check"}')).toBe(3);
    expect(sampleValue(body, 'navhub_jobs_pending{kind="backup_restore"}')).toBe(1);
    // 没有积压的 kind 也要有序列（0），否则「缺序列」无法与「真的为 0」区分
    expect(sampleValue(body, 'navhub_jobs_pending{kind="reindex"}')).toBe(0);
    expect(sampleValue(body, 'navhub_jobs_running{kind="reindex"}')).toBe(0);
    expect(sampleValue(body, "navhub_job_queue_readable")).toBe(1);
  });

  it("积压读不到时退回缓存值并把 queue_readable 置 0（不伪装成清空队列）", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const broken = {
      ...fakeContext(),
      repo: {
        ...fakeContext().repo,
        pendingJobsByKind: async () => {
          throw new Error("db down");
        },
      },
    } as unknown as AppContext;
    const body = await fresh.renderMetrics(broken);
    expect(sampleValue(body, "navhub_job_queue_readable")).toBe(0);
    expect(sampleValue(body, 'navhub_jobs_pending{kind="health_check"}')).toBe(0);
  });

  it("执行计数与耗时按 kind 导出；没有跑过时也要有条目（0）", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const body = await fresh.renderMetrics(fakeContext());
    for (const name of [
      "navhub_job_runs_total",
      "navhub_job_duration_seconds_total",
      "navhub_job_failures_total",
      "navhub_job_timeouts_total",
      "navhub_job_cancels_total",
    ]) {
      expect(sampleValue(body, name + '{kind="backup_restore"}')).toBeGreaterThanOrEqual(0);
      expect(sampleValue(body, name + '{kind="health_check"}')).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * 出站请求指标（P2）。
 *
 * 「我们主动访问别人」这一整面以前没有任何读数：富化挂了、订阅源抓不到、
 * 有人在拿 169.254.169.254 试探，全都要靠翻日志才知道。这里的判据与其它族一致——
 * 四类结局与全部拦截原因**固定导出（含 0）**，因为「少一行」在抓取侧和「真的是 0」
 * 长得一样，而 blocked 恰好为 0 时你最需要确认它不是忘了接线。
 */
describe("出站请求指标（P2）", () => {
  const OUTCOME_SERIES = ["ok", "http_error", "blocked", "network_error"] as const;

  it("四类结局与拦截原因固定导出；一条请求都没发过时也全是 0", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const body = await fresh.renderMetrics(fakeContext());
    for (const outcome of OUTCOME_SERIES) {
      expect(sampleValue(body, `navhub_outbound_requests_total{outcome="${outcome}"}`)).toBe(0);
    }
    for (const reason of ["blocked-ip", "protocol", "dns-timeout", "other"]) {
      expect(sampleValue(body, `navhub_outbound_blocked_total{reason="${reason}"}`)).toBe(0);
    }
    for (const name of [
      "navhub_outbound_hops_total",
      "navhub_outbound_response_bytes_total",
      "navhub_outbound_request_seconds_total",
    ]) {
      expect(sampleValue(body, name)).toBe(0);
    }
  });

  it("recordOutbound 的每一次累加都如实渲染（次数/跳数/字节/秒）", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    fresh.recordOutbound({ outcome: "ok", reason: null, hops: 3, bytes: 2048, durationMs: 1500 });
    fresh.recordOutbound({ outcome: "blocked", reason: "blocked-ip", hops: 0, bytes: 0, durationMs: 5 });
    const stats = fresh.getOutboundStats();
    expect(stats.requests).toBe(2);
    expect(stats.byOutcome.ok).toBe(1);
    expect(stats.byOutcome.blocked).toBe(1);
    expect(stats.hops).toBe(3);
    expect(stats.bytes).toBe(2048);
    expect(stats.secondsTotal).toBeCloseTo(1.505, 3);

    const body = await fresh.renderMetrics(fakeContext());
    expect(sampleValue(body, 'navhub_outbound_requests_total{outcome="ok"}')).toBe(1);
    expect(sampleValue(body, 'navhub_outbound_requests_total{outcome="blocked"}')).toBe(1);
    expect(sampleValue(body, 'navhub_outbound_blocked_total{reason="blocked-ip"}')).toBe(1);
    expect(sampleValue(body, "navhub_outbound_hops_total")).toBe(3);
    expect(sampleValue(body, "navhub_outbound_response_bytes_total")).toBe(2048);
    expect(sampleValue(body, "navhub_outbound_request_seconds_total")).toBe(1.505);
  });

  it("外部传进来的结局/原因夹回枚举：标签基数不会随用户输入增长", () => {
    // 观察者的数据来自 @navhub/ai（URL 由用户提交），本白名单是最后一道闸。
    recordOutbound({ outcome: "https://x/y", reason: "169.254.169.254", hops: 2, bytes: 5, durationMs: 10 });
    const unknownOutcome = getOutboundStats();
    expect(unknownOutcome.byOutcome.network_error).toBe(1);
    expect(unknownOutcome.byOutcome.ok).toBe(0);
    // 非 blocked 不带拦截原因，不该凭空多出 reason 序列
    expect(Object.values(unknownOutcome.blockedByReason).every((v) => v === 0)).toBe(true);

    recordOutbound({ outcome: "blocked", reason: "将来新增的原因", hops: 1, bytes: 1, durationMs: 1 });
    const after = getOutboundStats();
    expect(after.blockedByReason.other).toBe(1);
    for (const key of Object.keys(after.blockedByReason)) {
      expect(ALLOWED_LABEL_VALUES.reason?.has(key), "拦截原因逃出枚举白名单: " + key).toBe(true);
    }
    resetOutboundMetricsForTest();
    const cleared = getOutboundStats();
    expect(cleared.requests).toBe(0);
    expect(Object.values(cleared.byOutcome).every((v) => v === 0)).toBe(true);
    expect(Object.values(cleared.blockedByReason).every((v) => v === 0)).toBe(true);
  });

  it("接线守卫：server.ts 装配时真的装上观察者，而不是只在 metrics.ts 里自说自话", () => {
    const src = readFileSync(resolve(API_ROOT, "src/server.ts"), "utf8");
    expect(src).toContain("installOutboundObserver()");
  });

  it("装上之后，真实 guardedFetch 的成功与拦截都进 navhub_outbound_*", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const ai = await import("@navhub/ai");
    fresh.resetOutboundMetricsForTest();
    fresh.installOutboundObserver();
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello-outbound");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      await ai.guardedFetch("http://127.0.0.1:" + port + "/x", { allowPrivateNetworks: true, timeoutMs: 2000 });
      await expect(ai.guardedFetch("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
        ai.SsrfBlockedError,
      );
      const body = await fresh.renderMetrics(fakeContext());
      expect(sampleValue(body, 'navhub_outbound_requests_total{outcome="ok"}')).toBe(1);
      expect(sampleValue(body, 'navhub_outbound_requests_total{outcome="blocked"}')).toBe(1);
      expect(sampleValue(body, 'navhub_outbound_blocked_total{reason="blocked-ip"}')).toBe(1);
      expect(sampleValue(body, "navhub_outbound_hops_total")).toBe(1);
      expect(sampleValue(body, "navhub_outbound_response_bytes_total")).toBe("hello-outbound".length);
    } finally {
      ai.setOutboundObserver(null);
      fresh.resetOutboundMetricsForTest();
      await new Promise((r) => server.close(r));
    }
  });

  it("重复装配观察者不会把一次请求计两遍（buildServer 会被调用多次）", async () => {
    vi.resetModules();
    const fresh = await import("../src/metrics.ts");
    const ai = await import("@navhub/ai");
    fresh.resetOutboundMetricsForTest();
    fresh.installOutboundObserver();
    fresh.installOutboundObserver();
    try {
      await expect(ai.guardedFetch("file:///etc/passwd")).rejects.toBeInstanceOf(ai.SsrfBlockedError);
      expect(fresh.getOutboundStats().requests).toBe(1);
      expect(fresh.getOutboundStats().byOutcome.blocked).toBe(1);
    } finally {
      ai.setOutboundObserver(null);
      fresh.resetOutboundMetricsForTest();
    }
  });
});
