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
/** key: method\u0000route -> 累计耗时 */
const httpDurations = new Map<string, { count: number; sumMs: number }>();

/** onResponse hook 调用：记录一次请求（server.ts 负责挂 hook，这里只存数据） */
export function recordHttpMetric(route: string, method: string, status: number, elapsedMs: number): void {
  const ckey = method + "\u0000" + route + "\u0000" + String(status);
  httpCounts.set(ckey, (httpCounts.get(ckey) ?? 0) + 1);
  const dkey = method + "\u0000" + route;
  const d = httpDurations.get(dkey) ?? { count: 0, sumMs: 0 };
  d.count += 1;
  d.sumMs += elapsedMs;
  httpDurations.set(dkey, d);
}

/** 转义 Prometheus 文本格式的标签值（反斜杠 / 引号 / 换行） */
const escLabel = (v: string): string => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
/** 还原采集时的复合 key；缺失位以空串兜底（noUncheckedIndexedAccess 友好） */
const splitKey = (k: string): [string, string, string] => {
  const p = k.split("\u0000");
  return [p[0] ?? "", p[1] ?? "", p[2] ?? ""];
};

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
  const metric = (name: string, help: string, type: "gauge" | "counter" | "summary", lines: string[]) => {
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

  // HTTP：耗时（summary：_sum 秒 + _count）
  const durLines: string[] = [];
  for (const [k, d] of [...httpDurations.entries()].sort()) {
    const [method, route] = splitKey(k);
    const labels = `{method="${escLabel(method)}",route="${escLabel(route)}"}`;
    durLines.push(`navhub_http_request_duration_seconds_sum${labels} ${(d.sumMs / 1000).toFixed(6)}`);
    durLines.push(`navhub_http_request_duration_seconds_count${labels} ${d.count}`);
  }
  metric("navhub_http_request_duration_seconds", "HTTP 请求耗时（秒）", "summary", durLines);

  return out.join("\n") + "\n";
}
