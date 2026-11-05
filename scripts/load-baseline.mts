/**
 * 后端压测基线（规划 P2「压测基线」）。
 *
 * 仓库没有 k6/autocannon，也不打算为一次性基线引入依赖：Node 内置 fetch +
 * 受控并发就够回答「这台机器 / 这版代码下，五条热路径各是什么水平」。
 *
 * 用法（先按 scripts/seed-loadtest.mts 起一个隔离库，再对隔离端口打）：
 *
 *   NAVHUB_SQLITE_PATH=./data/loadtest.db NAVHUB_PORT=8799 node apps/api/src/main.ts &
 *   node scripts/load-baseline.mts --url http://127.0.0.1:8799 --duration 15
 *
 *   # 夜间/发版前跑法：给阈值，超了退出码 1（CI 只需要看退出码）
 *   node scripts/load-baseline.mts --url http://127.0.0.1:8799 \
 *     --duration 30 --concurrency 16 --max-p95-ms 800 --max-error-rate 0.01
 *
 * 只打**隔离栈**：本机共享的 :8787 / :3200 是并行会话在用的开发栈，
 * 压测会把它们的日志、限流桶和响应时间全部污染。
 *
 * 并发模型刻意用「固定 worker 数 + 到点停」而不是「固定请求数」：
 * 固定请求数在快机器上几秒就跑完，测到的是冷缓存；固定时长才有稳态可看。
 */
import { pathToFileURL } from "node:url";

export const TARGETS = ["health", "ready", "sites", "search", "storage", "jobs"] as const;
export type TargetName = (typeof TARGETS)[number];

export interface LoadOptions {
  url: string;
  durationSec: number;
  warmupSec: number;
  concurrency: number;
  targets: TargetName[];
  token: string | null;
  internalToken: string | null;
  searchQuery: string;
  storagePath: string;
  maxP95Ms: number | null;
  maxErrorRate: number | null;
}

export interface Sample {
  target: TargetName;
  ms: number;
  status: number; // 0 = 网络错误/超时
  error?: string;
}

export interface TargetSummary {
  target: TargetName;
  count: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** 5xx + 网络错误：这两类才是「服务坏了」 */
  errorRate: number;
  statuses: Record<string, number>;
}

/* ------------------------------------------------------------------ *
 * 纯函数（可测）：参数解析、分位数、汇总、阈值判定
 * ------------------------------------------------------------------ */

export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): LoadOptions {
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} 缺少取值`);
    return value;
  };
  const num = (name: string, fallback: number, min: number): number => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min) throw new Error(`--${name} 必须是 >=${min} 的数字，收到 ${raw}`);
    return value;
  };

  const targetsRaw = read("targets");
  const targets = targetsRaw
    ? (targetsRaw.split(",").map((s) => s.trim()).filter(Boolean) as TargetName[])
    : [...TARGETS];
  for (const target of targets) {
    if (!TARGETS.includes(target)) {
      throw new Error(`未知目标 ${target}，可选：${TARGETS.join(", ")}`);
    }
  }

  const errorRate = read("max-error-rate");
  if (errorRate !== undefined) {
    const value = Number(errorRate);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`--max-error-rate 必须在 0..1 之间，收到 ${errorRate}`);
    }
  }

  const base = read("url") ?? env.NAVHUB_LOAD_URL ?? "http://127.0.0.1:8787";
  return {
    url: base.replace(/\/+$/, ""),
    durationSec: num("duration", 10, 1),
    warmupSec: num("warmup", 2, 0),
    concurrency: Math.floor(num("concurrency", 8, 1)),
    targets,
    token: read("token") ?? env.NAVHUB_LOAD_TOKEN ?? null,
    internalToken: read("internal-token") ?? env.NAVHUB_INTERNAL_TOKEN ?? null,
    searchQuery: read("query") ?? "导航",
    storagePath: read("storage-path") ?? "src/navsphere/content/navigation.json",
    maxP95Ms: read("max-p95-ms") === undefined ? null : num("max-p95-ms", 0, 1),
    maxErrorRate: errorRate === undefined ? null : Number(errorRate),
  };
}

/** 最近秩法（nearest-rank）：小样本上也稳定，不插值、不造出没测到过的数。 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

export function summarize(samples: Sample[], elapsedSec: number): TargetSummary[] {
  const byTarget = new Map<TargetName, Sample[]>();
  for (const sample of samples) {
    const list = byTarget.get(sample.target) ?? [];
    list.push(sample);
    byTarget.set(sample.target, list);
  }
  const out: TargetSummary[] = [];
  for (const [target, list] of byTarget) {
    const latencies = list.map((s) => s.ms).sort((a, b) => a - b);
    const statuses: Record<string, number> = {};
    let failures = 0;
    for (const sample of list) {
      const key = sample.status === 0 ? "network" : String(sample.status);
      statuses[key] = (statuses[key] ?? 0) + 1;
      // 429 不算「服务坏了」：那是限流在按设计工作，单独显示；
      // 4xx 同理（压测脚本自己的参数错不该冒充服务端故障）。
      if (sample.status === 0 || sample.status >= 500) failures++;
    }
    out.push({
      target,
      count: list.length,
      rps: elapsedSec > 0 ? Number((list.length / elapsedSec).toFixed(1)) : 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies[latencies.length - 1] ?? 0,
      errorRate: list.length === 0 ? 0 : Number((failures / list.length).toFixed(4)),
      statuses,
    });
  }
  return out.sort((a, b) => TARGETS.indexOf(a.target) - TARGETS.indexOf(b.target));
}

export interface ThresholdFailure {
  target: string;
  reason: string;
}

export function evaluateThresholds(summaries: TargetSummary[], opts: Pick<LoadOptions, "maxP95Ms" | "maxErrorRate">): ThresholdFailure[] {
  const failures: ThresholdFailure[] = [];
  for (const summary of summaries) {
    if (opts.maxP95Ms !== null && summary.p95 > opts.maxP95Ms) {
      failures.push({ target: summary.target, reason: `p95 ${summary.p95}ms > ${opts.maxP95Ms}ms` });
    }
    if (opts.maxErrorRate !== null && summary.errorRate > opts.maxErrorRate) {
      failures.push({ target: summary.target, reason: `错误率 ${(summary.errorRate * 100).toFixed(2)}% > ${(opts.maxErrorRate * 100).toFixed(2)}%` });
    }
  }
  return failures;
}

/* ------------------------------------------------------------------ *
 * 压测执行
 * ------------------------------------------------------------------ */

function targetUrl(opts: LoadOptions, target: TargetName): string {
  switch (target) {
    case "health":
      return `${opts.url}/api/health`;
    case "ready":
      return `${opts.url}/api/ready`;
    case "sites":
      return `${opts.url}/api/sites?limit=50`;
    case "search":
      return `${opts.url}/api/search?q=${encodeURIComponent(opts.searchQuery)}&limit=20`;
    case "storage":
      return `${opts.url}/api/storage?path=${encodeURIComponent(opts.storagePath)}`;
    case "jobs":
      return `${opts.url}/api/jobs?limit=50`;
  }
}

async function runWorker(opts: LoadOptions, deadline: number, samples: Sample[]): Promise<void> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  // 限流豁免头（服务端只在配了 NAVHUB_INTERNAL_TOKEN 时认它）：搜索路由自带
  // 120/min 的按 IP 限流，不给豁免时压测测到的是 429，不是搜索耗时。
  if (opts.internalToken) headers["x-navhub-internal-token"] = opts.internalToken;

  let cursor = 0;
  while (Date.now() < deadline) {
    const target = opts.targets[cursor % opts.targets.length];
    cursor++;
    const started = performance.now();
    let status = 0;
    let error: string | undefined;
    try {
      const res = await fetch(targetUrl(opts, target), {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      // 必须把 body 读完再计时：只读到头不读内容，测到的是 TTFB，
      // 而 videos.json/navigation.json 这类大文档的耗时大头恰恰在传输。
      await res.arrayBuffer();
      status = res.status;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    samples.push({ target, ms: Math.round(performance.now() - started), status, error });
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`用法：node scripts/load-baseline.mts [选项]

  --url <base>           默认 $NAVHUB_LOAD_URL 或 http://127.0.0.1:8787
  --duration <秒>        默认 10
  --warmup <秒>          默认 2（预热样本不进统计）
  --concurrency <n>      默认 8
  --targets <列表>       默认 ${TARGETS.join(",")}
  --token <bearer>       默认 $NAVHUB_LOAD_TOKEN（read 及以上 scope）
  --internal-token <t>   默认 $NAVHUB_INTERNAL_TOKEN（豁免按 IP 限流）
  --query <关键词>       搜索压测用词，默认「导航」
  --storage-path <path>  默认 navigation.json
  --max-p95-ms <n>       超过则退出码 1
  --max-error-rate <0..1> 超过则退出码 1
  --json                 输出单行 JSON（便于落盘比对）`);
    return;
  }

  const opts = parseArgs(argv, process.env);

  // 先探一次就绪：打一个还没起来的栈只会得到满屏 network 错误
  const probe = await fetch(`${opts.url}/api/ready`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (!probe) {
    console.error(`[load] ${opts.url} 连不上。压测只打隔离栈，例如：`);
    console.error("  NAVHUB_SQLITE_PATH=./data/loadtest.db NAVHUB_PORT=8799 node apps/api/src/main.ts");
    process.exit(2);
  }
  if (!probe.ok) {
    console.error(`[load] /api/ready 返回 ${probe.status}：目标栈未就绪，先排查再压测`);
    process.exit(2);
  }

  console.log(
    `[load] ${opts.url} 目标=${opts.targets.join(",")} 并发=${opts.concurrency} ` +
      `预热=${opts.warmupSec}s 计时=${opts.durationSec}s`,
  );

  const warmupDeadline = Date.now() + opts.warmupSec * 1000;
  await Promise.all(Array.from({ length: opts.concurrency }, () => runWorker(opts, warmupDeadline, [])));

  const samples: Sample[] = [];
  const startedAt = Date.now();
  const deadline = startedAt + opts.durationSec * 1000;
  await Promise.all(Array.from({ length: opts.concurrency }, () => runWorker(opts, deadline, samples)));
  const elapsedSec = (Date.now() - startedAt) / 1000;

  const summaries = summarize(samples, elapsedSec);
  const failures = evaluateThresholds(summaries, opts);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ url: opts.url, elapsedSec, summaries, failures }));
  } else {
    console.table(
      summaries.map((s) => ({
        target: s.target,
        rps: s.rps,
        p50: `${s.p50}ms`,
        p95: `${s.p95}ms`,
        p99: `${s.p99}ms`,
        max: `${s.max}ms`,
        错误率: `${(s.errorRate * 100).toFixed(2)}%`,
        状态码: Object.entries(s.statuses).map(([k, v]) => `${k}:${v}`).join(" "),
      })),
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`[load] 超阈值 ${failure.target}：${failure.reason}`);
    process.exit(1);
  }
}

// 被测试 import 时不执行 CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[load] " + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
}
