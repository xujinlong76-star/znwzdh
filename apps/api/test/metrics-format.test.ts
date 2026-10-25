/**
 * /api/metrics 的 Prometheus 文本格式守卫（P4）。
 *
 * 现有 api.test.ts 只断言「包含某些值」；这个文件锁的是格式与基数约束本身：
 *  - 每个样本都必须先有 # HELP / # TYPE，TYPE 合法，家庭不重复；
 *  - 样本名 / 数值 / 标签语法合法，同一序列不重复；
 *  - counter 必须 `_total` 结尾，gauge / summary 不得冒充 counter；
 *  - summary 的 `_sum` / `_count` 必须成对；
 *  - 标签只允许有界维度白名单，`route` 必须是 Fastify 路由模板（不得出现查询串）；
 *  - 指标家庭清单做 inline snapshot：改名、改类型、新增都会显式失败。
 *
 * 为什么不做全量快照：uptime / 内存 / 请求数每次都变，只有「结构」可快照。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordHttpMetric, renderMetrics } from "../src/metrics.ts";
import type { AppContext } from "../src/context.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, "..");

const ALLOWED_TYPES = new Set(["counter", "gauge", "summary"]);
/** 新增标签必须显式更新这里——这是防止「原始 URL / 用户输入进标签」的最后一道闸。 */
const ALLOWED_LABELS = new Set(["method", "route", "status", "name", "channel", "decision", "mode", "node", "component"]);
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

    const base = name.replace(/_(sum|count)$/, "");
    const family = families.get(name) ?? families.get(base);
    if (!family || family.type === null) throw new Error("样本没有对应的 # TYPE 家族: " + line);
    family.samples.push({ name, labelsRaw: raw, labels, value });
    samples.push({ name, labelsRaw: raw, labels, value });
  }

  return { families, samples };
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
      // 样本名与家庭类型的对应关系：summary 用 _sum/_count，其余同名
      for (const s of f.samples) {
        if (f.type === "summary") {
          expect(s.name === name + "_sum" || s.name === name + "_count", "summary 样本名异常: " + s.name).toBe(true);
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
      for (const key of Object.keys(s.labels)) {
        expect(ALLOWED_LABELS.has(key), "出现未登记标签 " + key).toBe(true);
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

  it("指标家庭清单快照（改名/改类型/新增会失败）", () => {
    const schema = [...parsed.families.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, f]) => name + " " + f.type)
      .join("\n");
    expect(schema).toMatchInlineSnapshot(`
      "navhub_build_info gauge
      navhub_capability gauge
      navhub_categories_total gauge
      navhub_embedding_ready gauge
      navhub_http_request_duration_seconds summary
      navhub_http_requests_total counter
      navhub_process_heap_total_bytes gauge
      navhub_process_heap_used_bytes gauge
      navhub_process_resident_memory_bytes gauge
      navhub_process_uptime_seconds gauge
      navhub_search_channel_avg_ms gauge
      navhub_search_planner_total counter
      navhub_search_semantic_skipped_total counter
      navhub_search_write_failures_total counter
      navhub_sites gauge
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
});
