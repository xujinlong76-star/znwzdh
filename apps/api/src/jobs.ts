/**
 * 任务队列 Runner（定时自动化）。
 *
 * 四种任务：
 *   health_check     可用性巡检（SSRF 安全抓取，写 health_checks + sites 健康列）
 *   refetch_metadata 刷新站点元数据（标题/描述/图标），可选手动 LLM 富化
 *   recompute_rank   重算全站热度分（trend_score）
 *   reindex          重建检索线索（拼音/FTS 由 updateSite 负责；向量按需重建）
 *
 * 单实例锁：lite 用 idempotency 表里的持久锁行（TTL 120s，崩溃自动释放），
 * standard 用 PG advisory lock。两者都不持有长事务，不会阻塞正常读写。
 * 没有锁就跳过本次循环——多副本部署时只有一个实例在跑任务。
 *
 * 防重入：tick 串行执行，上一次没跑完这次直接跳过（任务错过就等下一轮）。
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { canonicalizeUrl } from "@navhub/core";
import { enrichUrl } from "@navhub/ai";
import { enrichLlmOf, resolveLlm } from "./llm-config.ts";
import { createEnrichUsageCallback } from "./llm-usage.ts";
import { checkLlmQuota } from "./llm-quota.ts";
import { ageInDays, trendScore, auditPageHealth, runAutonomousHealing, planPatrol, sanitizeIconUrl } from "@navhub/core";
import {
  bindSqlite,
  toPgSql,
  chunkList,
  DEFAULT_RETENTION_TARGETS,
  DEFAULT_ROLLUP_TARGETS,
  runRetention,
  runRollup,
  type RetentionAdapter,
} from "@navhub/store";
import type { AppContext } from "./context.ts";
import { indexSite, indexSitesBatch } from "./index-site.ts";
import { indexPluginsBatch, indexItemFromManifest } from "./index-plugin.ts";
import { ADMIN_NOTIFICATION_IDENTITY } from "./notifications.ts";

/** 仓储返回的站点行类型：显式取一次，避免重构期返回类型退化时回调参数变成隐式 any */
type SiteRow = Awaited<ReturnType<AppContext["repo"]["listSites"]>>[number];

/**
 * 连续失败达到该次数才把站点标为 broken。
 *
 * 为什么不是「一次失败即 broken」：单次探测会被 403/429/超时/CDN 抖动命中。
 * 实测（2026-10-18，50 站点）有 15 个被标 broken，其中 kubernetes.io、
 * figma.com、npmjs.com 等知名站点实际可正常访问 —— 误判率 30%。
 * 连续 N 次（默认 3）能把绝大多数瞬时抖动过滤掉。
 */
export const HEALTH_FAIL_THRESHOLD = Math.max(1, Number(process.env.NAVHUB_HEALTH_FAIL_THRESHOLD ?? 3));

/**
 * 健康判定的纯函数部分（可单测，不碰网络）。
 *
 * @param ok 本次探测是否健康
 * @param priorConsecutiveFailures 本次之前已连续失败次数（不含本次）
 */
export function shouldMarkBroken(
  ok: boolean,
  priorConsecutiveFailures: number,
  threshold: number = HEALTH_FAIL_THRESHOLD,
): boolean {
  if (ok) return false;
  return priorConsecutiveFailures + 1 >= threshold;
}

export type JobKind = "health_check" | "refetch_metadata" | "recompute_rank" | "reindex" | "site_self_healing" | "token_audit" | "purge_trash" | "taxonomy_audit" | "data_retention" | "plugin_governance" | "user_data_audit" | "backup_restore";

export const JOB_KINDS: JobKind[] = ["health_check", "refetch_metadata", "recompute_rank", "reindex", "site_self_healing", "token_audit", "purge_trash", "taxonomy_audit", "data_retention", "plugin_governance", "user_data_audit", "backup_restore"];

/** data_retention 任务的参数：mode 决定走哪条路，apply 决定是否真的动手 */
export interface DataRetentionPayload {
  /** rollup = 过期明细压成日统计再删（默认）；cleanup = 原样归档后删（任务里只允许 dry-run） */
  mode?: "cleanup" | "rollup";
  /** 默认 false。定时调度刻意不自动删除 —— 先看见，再决定。 */
  apply?: boolean;
  /** rollup：单表单轮最多处理多少天，默认 30 */
  maxDays?: number;
  /** rollup：单天分组数上限，默认 5000（超限的整天跳过） */
  maxGroups?: number;
  /** cleanup：单表最多扫描多少行后收尾，默认 200000（别一次扫全表） */
  maxScan?: number;
  /** 内部遥测（health_checks / llm_usage）保留天数，默认 90；dry-run 只统计命中量。 */
  telemetryDays?: number;
}

export interface JobEventPayload {
  jobId: string;
  kind: JobKind | string;
  status: "pending" | "running" | "completed" | "failed" | "retrying" | "cancelled";
  attempts?: number;
  error?: string | null;
  /** 本次执行耗时（不含排队等待）；只有任务真正跑过才有 */
  durationMs?: number;
  timestamp: number;
}

export class JobEventBus extends EventEmitter {
  emitJobUpdate(payload: JobEventPayload): void {
    this.emit("job", payload);
    this.emit(`job:${payload.jobId}`, payload);
  }
}

export const jobEventBus = new JobEventBus();
jobEventBus.setMaxListeners(200);

export interface CronScheduleConfig {
  kind: JobKind;
  intervalMs: number;
  payload?: Record<string, unknown>;
}

export const DEFAULT_CRON_SCHEDULES: CronScheduleConfig[] = [
  { kind: "recompute_rank", intervalMs: 3600_000 },
  { kind: "health_check", intervalMs: 86_400_000, payload: { limit: 100 } },
  { kind: "purge_trash", intervalMs: 86_400_000, payload: { olderThanDays: 30 } },
  { kind: "token_audit", intervalMs: 7 * 86_400_000 },
  { kind: "taxonomy_audit", intervalMs: 86_400_000 },
  // 插件治理巡检：只产告警与审计，不自动下架任何插件/评价
  { kind: "plugin_governance", intervalMs: 4 * 3600_000 },
  // 数据治理默认只做 rollup 的 dry-run：自动化可以先"看见"，不该先"动手"。
  // 确认过输出后再把 payload 改成 { mode: "rollup", apply: true }（或手动触发一次）。
  { kind: "data_retention", intervalMs: 86_400_000, payload: { mode: "rollup", apply: false, maxDays: 30, telemetryDays: 90 } },
  // 用户数据质量巡检（T24）：只统计与上报，不修复不删除——
  // 修复动作属于用户自检（POST /api/me/diagnostics 自动修）或运维决策。
  { kind: "user_data_audit", intervalMs: 86_400_000 },
];

const LOCK_KEY = "lock:job-runner";
/**
 * SQLite 持锁有效期（不是「任务预算」）：崩溃后最多等这么久，别的实例就能接管。
 * 有效期内必须由心跳续期，否则跑过 TTL 的长任务会让锁被合法夺走。
 */
const LOCK_TTL_MS = 120_000;
/** 默认心跳周期 = TTL/3：连续两次续期都失败才会过期，留出重试窗口 */
const LOCK_HEARTBEAT_DEFAULT_MS = Math.floor(LOCK_TTL_MS / 3);
/** 执行中任务的心跳（reapStaleJobs 的判定窗口是 15 分钟） */
const JOB_HEARTBEAT_DEFAULT_MS = 60_000;
const PG_LOCK_KEY = 728_501_001;

/** PG 独占连接（advisory lock 是会话级的：加锁与解锁必须在同一连接上） */
interface PgLockClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(): void;
}

/** 失败重试的次数上限（含首次执行共 attempts 次机会后耗尽 → failed） */
export const MAX_JOB_ATTEMPTS = 3;
/** 指数退避基数：第 n 次失败后延迟 base * 2^(n-1)（1min, 2min, 4min…） */
const BACKOFF_BASE_MS = 60_000;
/** 退避上限：防止极端场景下任务被推迟到"永远等不到" */
const BACKOFF_CAP_MS = 60 * 60_000;

/**
 * 单次执行超出预算。
 *
 * 为什么单独一个类型：超时与普通异常的处理策略不同——超时的 handler 可能
 * 还在后台跑，**不能立刻重试**（否则同一任务会被两个执行流并发处理）。
 * 因此超时一律落 `failed` 终态，由人工确认后再 retry。
 */
export class JobBudgetExceededError extends Error {
  readonly kind: string;
  readonly budgetMs: number;
  constructor(kind: string, budgetMs: number) {
    super("任务 " + kind + " 超出单次执行预算（" + budgetMs + "ms）");
    this.name = "JobBudgetExceededError";
    this.kind = kind;
    this.budgetMs = budgetMs;
  }
}

/**
 * 在预算内等待一个 Promise；超时抛 JobBudgetExceededError。
 *
 * 抽成独立函数（而不是内联在 process 里）有两个原因：
 *  1. 可单测：不必造一个会卡住的 handler 才能验证超时；
 *  2. 定时器一定被清理：work 先完成时不能留下一个指向已结束任务的 timer。
 *
 * budgetMs <= 0 表示不设预算（保留给手动任务/测试）。
 */
export async function runWithBudget<T>(work: Promise<T>, budgetMs: number, kind: string): Promise<T> {
  if (budgetMs <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new JobBudgetExceededError(kind, budgetMs)), budgetMs);
      if (timer && typeof timer.unref === "function") timer.unref();
    });
    return await Promise.race([work, budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 轮询间隔可配置：`NAVHUB_JOBS_INTERVAL_MS`（毫秒，默认 30000）。
 * 环境变量而不是 config 字段——它是 Runner 的运行参数，不进能力面。
 */
function envInterval(): number {
  const raw = Number(process.env.NAVHUB_JOBS_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 30_000;
}

/**
 * 计算第 attempt 次失败后的退避延迟（毫秒）。
 * 纯函数便于测试：1min → 2min → 4min，封顶 1h。
 */
export interface JobSchedulePolicy {
  /**
   * cron 别名（对应 CRON_EXPRS 的 5 段标准式）。
   * 注意：cron 表达式目前是**声明值**，Runner 实际按 DEFAULT_CRON_SCHEDULES 的
   * intervalMs 到期入队；cronDue/scheduleCronOf 只用于管理端展示与测试。
   */
  cron?: string;
  /**
   * 单次执行的预算（毫秒）。**自 2026-10-27 起由 Runner 强制执行**：
   * `process()` 用 Promise.race 在预算到点时脱身，并把任务落 failed 终态
   * （不自动重试——handler 没有 AbortSignal，可能仍在后台跑，立刻重试会并发执行）。
   * 各 handler 内部的网络/LLM 调用仍各自带超时；这一层是兜底，不是替代。
   */
  timeoutMs?: number;
  /** 期望的按 kind 最大并发数。**当前 Runner 全程串行**，该值同样只是声明 */
  maxConcurrency?: number;
}

/** 各任务默认调度策略（cron/预算为声明值，见 JobSchedulePolicy；实际到期判定走 intervalMs） */
export const DEFAULT_SCHEDULES: Record<JobKind, Required<JobSchedulePolicy>> = {
  health_check: { cron: "X5MIN", timeoutMs: 240_000, maxConcurrency: 2 },
  refetch_metadata: { cron: "X30MIN", timeoutMs: 300_000, maxConcurrency: 1 },
  recompute_rank: { cron: "HOURLY", timeoutMs: 180_000, maxConcurrency: 1 },
  reindex: { cron: "X4H", timeoutMs: 600_000, maxConcurrency: 1 },
  site_self_healing: { cron: "X30MIN", timeoutMs: 300_000, maxConcurrency: 1 },
  token_audit: { cron: "HOURLY", timeoutMs: 60_000, maxConcurrency: 1 },
  purge_trash: { cron: "DAILY3AM", timeoutMs: 120_000, maxConcurrency: 1 },
  taxonomy_audit: { cron: "DAILY3AM", timeoutMs: 300_000, maxConcurrency: 1 },
  data_retention: { cron: "DAILY4AM", timeoutMs: 600_000, maxConcurrency: 1 },
  plugin_governance: { cron: "X4H", timeoutMs: 120_000, maxConcurrency: 1 },
  user_data_audit: { cron: "DAILY5AM", timeoutMs: 300_000, maxConcurrency: 1 },
  /**
   * 备份恢复：**手动触发，绝不自动调度**。
   *
   * cron 只是声明值（真正入队看 DEFAULT_CRON_SCHEDULES），而本 kind 刻意不在那个
   * 列表里——否则每天会自动跑一次恢复，把库改回备份状态。`cronDue("MANUAL")`
   * 因为不是 5 段表达式而恒返回 false，即使有人误把它加进 cron 列表也会静默不触发。
   * 预算按 5 万条 + 分片写锁给到 30 分钟。
   */
  backup_restore: { cron: "MANUAL", timeoutMs: 1_800_000, maxConcurrency: 1 },
};

/** 标准 5 段 cron 字面量（与 DEFAULT_SCHEDULES 别名一一对应，集中存放避免块注释提前闭合） */
const CRON_EXPRS = {
  X5MIN: "\u002a/5 \u002a \u002a \u002a \u002a",
  X30MIN: "\u002a/30 \u002a \u002a \u002a \u002a",
  HOURLY: "0 \u002a \u002a \u002a \u002a",
  X4H: "0 \u002a/4 \u002a \u002a \u002a",
  DAILY3AM: "0 3 \u002a \u002a \u002a",
  DAILY4AM: "0 4 \u002a \u002a \u002a",
  DAILY5AM: "0 5 * * *",
} as const;

/**
 * 取某任务的真实 cron 表达式。
 * 别名不在 CRON_EXPRS 里时原样返回——若原值不是 5 段，cronDue 会恒判 false
 * （任务看着已排期、实际永远不触发）。全量断言在 upgrade-batch1 的「cron 调度语义」。
 */
export function scheduleCronOf(kind: JobKind): string {
  const alias = DEFAULT_SCHEDULES[kind].cron as keyof typeof CRON_EXPRS;
  return CRON_EXPRS[alias] ?? alias;
}

/**
 * 最小 cron 匹配器（5 段：分 时 日 月 周；支持 *、步长、枚举与范围）。
 * 不引入 cron 依赖——调度精度到分钟级已满足全部任务类型。
 */
export function cronDue(cron: string, now: Date = new Date()): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const vals = [now.getMinutes(), now.getHours(), now.getDate(), now.getMonth() + 1, now.getDay()];
  const match = (expr: string | undefined, v: number, min: number, max: number): boolean => {
    if (expr === undefined || expr === "" || expr === "*") return true;
    for (const seg of expr.split(",")) {
      const step = seg.match(/^\*\/(\d+)$/);
      if (step) {
        const n = Number(step[1]);
        if (n > 0 && v % n === 0) return true;
        continue;
      }
      const range = seg.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
      if (range) {
        const lo = Math.max(min, Number(range[1]));
        const hi = Math.min(max, Number(range[2]));
        const st = Number(range[3] ?? 1);
        for (let x = lo; x <= hi; x += st) if (x === v) return true;
        continue;
      }
      if (/^\d+$/.test(seg) && Number(seg) === v) return true;
    }
    return false;
  };
  const bounds: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  return parts.every((p, i) => match(p, vals[i] ?? 0, bounds[i]![0], bounds[i]![1]));
}

export function backoffMs(attempt: number): number {
  const exp = Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(BACKOFF_BASE_MS * exp, BACKOFF_CAP_MS);
}

/**
 * 恢复任务的分片大小。
 *
 * 默认 **1000**（原 2000）。依据 `scripts/bench-restore-chunk.ts` 实测
 * （`sites(url)` 索引已修、`getSite` 已改走主键之后）：
 *
 * | 片大小 | 10k（3 次中位） | 30k（3 次中位） |
 * |---:|---:|---:|
 * | 1000 | 2.16s | **8.86s** |
 * | 2000 | **1.78s** | 10.44s |
 * | 5000 | 2.07s | — |
 *
 * 两个量级差异都在 ±20% 内，没有压倒性的赢家。选 1000 的理由是**单次阻塞更短**
 * （30k：1.9s vs 3.0s，直接影响进度条与取消的响应）与更大库上的表现更好，
 * 不是吞吐。别用单次跑分去推翻它——这台机器单次测量能差 2 倍。
 *
 * 可用 `NAVHUB_RESTORE_CHUNK` 覆盖——这个开关主要为基准测试保留，生产不要设它。
 * 小于 100 视为误配并回落默认值：片太小会让「每片一个事务」的收益消失。
 */
/**
 * 恢复后「增量重建索引」的条数上限。超过就退回全量重建。
 *
 * 默认 5000。这个数字是「payload 大小」与「省下的工作量」的折中：
 *    · 5000 个 UUID ≈ 185KB 塞进 `jobs.payload`，尚可接受；
 *    · 而 5000 / 50001 时增量只比全量省不到 10%，多一层分支不值当。
 * 可用 `NAVHUB_REINDEX_INCREMENTAL_MAX` 覆盖（基准测试与极端场景用）。
 */
export function reindexIncrementalMax(): number {
  const raw = Number(process.env.NAVHUB_REINDEX_INCREMENTAL_MAX ?? 5000);
  if (!Number.isFinite(raw) || raw < 0) return 5000;
  return Math.floor(raw);
}

export function restoreChunkSize(): number {
  const raw = Number(process.env.NAVHUB_RESTORE_CHUNK ?? 1000);
  if (!Number.isFinite(raw) || raw < 100) return 1000;
  return Math.floor(raw);
}

/**
 * 判断候选 URL 是否已在库里（配合 `repo.findExistingSiteUrls` 用）。
 *
 * 口径必须与那支函数的探针集合一致：它除了原文和 canonical 形态，还会探
 * `canonical ± "/"`，并且返回的集合里同时装着库中原始写法与 canonical 写法。
 * 所以三种键都要试——少试一种就会把重复站点当新站插进去，而这正是要防的。
 */
export function stagedUrlExists(found: ReadonlySet<string>, url: string): boolean {
  if (!url) return true; // 空 URL 属于「不该写入」，按已存在处理最安全
  const canonical = canonicalizeUrl(url);
  if (found.has(url) || found.has(canonical)) return true;
  const alternate = canonical.endsWith("/") ? canonical.slice(0, -1) : canonical + "/";
  return found.has(alternate);
}

export interface JobRunnerOptions {
  /** 轮询间隔（默认取 NAVHUB_JOBS_INTERVAL_MS 或 30s） */
  intervalMs?: number;
  /** 单轮最多处理任务数（默认 10，防止一轮跑太久） */
  maxPerTick?: number;
  /** 持有者标识（多实例部署时可区分） */
  holder?: string;
  /** 是否在 tick 时检查并自动调度 Cron 周期任务（start() 启动后台时自动置为 true） */
  enableCron?: boolean;
  /**
   * SQLite 持锁心跳周期（毫秒，默认 LOCK_TTL/3 = 40s）。
   * 生产沿用默认即可；测试用小值，才能在单个任务里观察到续期。
   */
  lockHeartbeatMs?: number;
  /**
   * 执行中任务的心跳周期（毫秒，默认 60s）。reapStaleJobs 的僵尸判定是
   * updated_at < now-15min，取 1/15 周期给慢 SQLite 写/事件循环抖动留足余量。
   */
  jobHeartbeatMs?: number;
  /** 连续失败告警阈值（达到后 log.error 一次；测试可注入回调收集） */
  onAlert?: (message: string, detail: { kind: string; attempts: number; error: string }) => void;
}

export class JobRunner {
  private ctx: AppContext;
  private intervalMs: number;
  private maxPerTick: number;
  private holder: string;
  private enableCron: boolean;
  private lockHeartbeatMs: number;
  private jobHeartbeatMs: number;
  private onAlert: JobRunnerOptions["onAlert"];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private lockHeld = false;
  /** 心跳发现锁已丢失（SQLite 被夺 / PG 连接断开）：本轮不再认领新任务 */
  private lockLost = false;
  /** PG advisory lock 持有期间独占的连接（解锁前不归还给池） */
  private pgClient: PgLockClient | null = null;

  constructor(ctx: AppContext, opts: JobRunnerOptions = {}) {
    this.ctx = ctx;
    this.intervalMs = opts.intervalMs ?? envInterval();
    this.maxPerTick = opts.maxPerTick ?? 10;
    this.holder = opts.holder ?? "pid-" + process.pid;
    this.enableCron = opts.enableCron ?? false;
    this.lockHeartbeatMs = opts.lockHeartbeatMs ?? LOCK_HEARTBEAT_DEFAULT_MS;
    this.jobHeartbeatMs = opts.jobHeartbeatMs ?? JOB_HEARTBEAT_DEFAULT_MS;
    this.onAlert = opts.onAlert;
  }

  /** 当前轮询间隔（启动横幅与 /admin/jobs 展示用） */
  get interval(): number {
    return this.intervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.enableCron = true;
    // 引入 ±20% 抖动（jitter）：多实例部署时错开唤醒峰值，避免同时抢锁打满 DB
    const jitterMs = Math.max(200, Math.round(this.intervalMs * (0.8 + Math.random() * 0.4)));
    this.timer = setInterval(() => {
      void this.tick().catch(() => console.error("[navhub-job] 调度或通知持久化失败，将在后续周期恢复"));
    }, jitterMs);
    // 不阻塞启动：首个周期也交给定时器
    if (typeof this.timer.unref === "function") this.timer.unref();
  }
  /** 优雅停机：stop() 后等待 in-flight tick 完成（最多等 stopTimeoutMs） */
  private stopping = false;
  private stopTimeoutMs = 30_000;


  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // 标记停机中：tick 入口会拒绝新一轮，in-flight 的一轮正常跑完
    this.stopping = true;
  }

  /** 等待 in-flight tick 完成（main.ts 优雅停机用）；超时直接返回不抛错 */
  async drain(timeoutMs?: number): Promise<void> {
    const deadline = Date.now() + (timeoutMs ?? this.stopTimeoutMs);
    while (this.ticking && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** 手动跑一轮（测试 / 管理端点用） */
  async tick(): Promise<{ processed: number; skipped: boolean }> {
    // 停机中拒绝新一轮（drain 语义）；串行防重入保留
    if (this.ticking || this.stopping) return { processed: 0, skipped: true };
    this.ticking = true;
    try {
      const locked = await this.acquireLock();
      if (!locked) return { processed: 0, skipped: true };
      let processed = 0;
      // 锁心跳：只在「任务之间」续期是不够的。单个任务就可能跑过 LOCK_TTL——
      // health_check 默认巡检 100 个站点、串行抓取每次最长 10s，慢网络下轻松超过 120s。
      // TTL 一过，别的实例按 SQL 语义就是**合法**夺锁，于是两个实例同时跑同一批任务：
      // 重复抓取、重复写 health/rank、对目标站点翻倍施压。
      // 续期语句带 `response = holder` 条件，锁真被夺走时只会 0 行命中，不会反向顶掉新持有者。
      const heartbeat = setInterval(() => void this.renewLock(), this.lockHeartbeatMs);
      if (typeof heartbeat.unref === "function") heartbeat.unref();
      try {
        if (this.enableCron) {
          await this.checkRecurringSchedules().catch(() => undefined);
        }
        if (typeof this.ctx.repo.reapStaleJobs === "function") {
          await this.ctx.repo.reapStaleJobs().catch(() => undefined);
        }
        await this.relayNotificationsSafely();
        for (let i = 0; i < this.maxPerTick; i++) {
          // 心跳已发现锁丢失：停止认领，避免与合法新持有者双跑
          if (this.lockLost || !this.lockHeld) break;
          const job = await this.ctx.repo.claimNextJob();
          if (!job) break;
          await this.process(job.kind as JobKind, job.payload, job.id, job.attempts);
          processed++;
          await this.relayNotificationsSafely();
          if (this.lockLost) break;
        }
      } finally {
        clearInterval(heartbeat);
        await this.releaseLock();
      }
      return { processed, skipped: false };
    } finally {
      this.ticking = false;
    }
  }

  /** 通知投递失败不应中断本轮任务消费：outbox 会在下一轮 tick 自动重试。 */
  private async relayNotificationsSafely(): Promise<void> {
    try {
      await this.ctx.repo.relayNotifications();
    } catch (err) {
      console.error("[navhub-job] 通知投递失败，将在后续周期重试:", err);
    }
  }

  /** 检查内置 Cron 定时计划并在到期时入队任务 */
  private async checkRecurringSchedules(): Promise<void> {
    const now = Date.now();
    for (const schedule of DEFAULT_CRON_SCHEDULES) {
      const stateKey = `cron:last_run:${schedule.kind}`;
      const lastRun = await this.ctx.repo.getSystemState<number>(stateKey);
      if (!lastRun || now - lastRun >= schedule.intervalMs) {
        try {
          await this.ctx.repo.enqueueJob(schedule.kind, schedule.payload ?? {});
          await this.ctx.repo.setSystemState(stateKey, now);
        } catch {
          // 忽略入队冲突或瞬时错误
        }
      }
    }
  }

  /* --------------------------- 单实例锁 --------------------------- */

  private async acquireLock(): Promise<boolean> {
    const db = this.ctx.db;
    const now = Date.now();
    if (db.dialect === "pg") {
      // 关键：advisory lock 是会话级的。必须在独占连接上加锁并一直持有到解锁，
      // 否则 unlock 落到池里另一个连接上会静默失败（返回 false），锁残留到连接关闭，
      // 造成其它实例永久抢不到锁。拿不到独占连接时直接放弃本轮。
      try {
        const connect = db.pg?.connect;
        if (typeof connect !== "function") return false;
        const client: PgLockClient = await connect.call(db.pg);
        let ok = false;
        try {
          const res = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [PG_LOCK_KEY]);
          ok = Boolean((res.rows[0] as { ok: boolean } | undefined)?.ok);
        } catch {
          ok = false;
        }
        if (!ok) {
          client.release();
          return false;
        }
        this.pgClient = client;
        this.lockHeld = true;
        this.lockLost = false;
        return true;
      } catch {
        return false;
      }
    }
    // SQLite：持久锁行 + TTL（崩溃后 TTL 到期自动可抢，不会死锁）
    try {
      const stolen = await this.runCount(
        "UPDATE idempotency SET response = ?, created_at = ? WHERE key = ? AND created_at < ?",
        [this.holder, now, LOCK_KEY, now - LOCK_TTL_MS],
      );
      if (stolen > 0) { this.lockHeld = true; this.lockLost = false; return true; }
      await this.run(
        "INSERT INTO idempotency (key, response, created_at) VALUES (?,?,?)",
        [LOCK_KEY, this.holder, now],
      );
      this.lockHeld = true;
      this.lockLost = false;
      return true;
    } catch {
      // 唯一键冲突 = 别的实例持有
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    if (!this.lockHeld) return;
    const db = this.ctx.db;
    try {
      if (db.dialect === "pg") {
        // 在加锁的同一连接上解锁，再归还给池
        const client = this.pgClient;
        this.pgClient = null;
        if (client) {
          try {
            await client.query("SELECT pg_advisory_unlock($1)", [PG_LOCK_KEY]);
          } catch {
            // 解锁失败由会话结束兜底（连接归还后最终关闭时锁自动释放）
          }
          client.release();
        }
      } else {
        await this.run("DELETE FROM idempotency WHERE key = ? AND response = ?", [LOCK_KEY, this.holder]);
      }
    } catch {
      // 释放失败等 TTL 自然过期
    }
    this.lockHeld = false;
  }

  /**
   * 锁心跳（tick 心跳调用）。
   *
   * SQLite：只刷新**自己名下**的锁行。若 TTL 期间锁已被别的实例夺走，这里匹配 0 行，
   * 立即标记 lockLost，本轮不再认领新任务——旧实现静默忽略，剩下的任务只是白跑。
   *
   * PG：advisory lock 是会话级的，无需续期；但长任务期间连接可能被网络/服务端掐断，
   * 此时锁已随会话消失，另一实例可合法接管。心跳对独占连接做一次轻量查询，
   * 失败即认定锁丢失，避免“以为还持锁”继续认领。
   */
  private async renewLock(): Promise<void> {
    if (!this.lockHeld) return;
    if (this.ctx.db.dialect === "pg") {
      const client = this.pgClient;
      if (!client) {
        this.lockLost = true;
        this.lockHeld = false;
        return;
      }
      try {
        await client.query("SELECT 1");
      } catch {
        this.lockLost = true;
        this.lockHeld = false;
        this.pgClient = null;
        try { client.release(); } catch { /* 坏连接由池丢弃 */ }
      }
      return;
    }
    try {
      const renewed = await this.runCount(
        "UPDATE idempotency SET created_at = ? WHERE key = ? AND response = ?",
        [Date.now(), LOCK_KEY, this.holder],
      );
      if (renewed === 0) {
        this.lockLost = true;
        this.lockHeld = false;
      }
    } catch {
      // 续期失败不影响本轮（下一轮重新抢锁）
    }
  }

  /* --------------------------- 任务执行 --------------------------- */

  private async process(kind: JobKind, payload: unknown, jobId: string, attempts: number): Promise<void> {
    jobEventBus.emitJobUpdate({
      jobId,
      kind,
      status: "running",
      attempts,
      timestamp: Date.now(),
    });
    // 执行中心跳：reapStaleJobs 以 updated_at 判定僵尸，没有心跳时任何超过
    // 15 分钟的合法长任务都会被另一实例回收，造成同一任务并发执行。
    const jobHeartbeat =
      typeof this.ctx.repo.heartbeatJob === "function"
        ? setInterval(() => {
            void this.ctx.repo.heartbeatJob(jobId).catch(() => undefined);
          }, this.jobHeartbeatMs)
        : null;
    if (jobHeartbeat && typeof jobHeartbeat.unref === "function") jobHeartbeat.unref();
    /**
     * 计时起点：**从认领之后算**，不含排队等待。
     * 一次 tick 会连续消费多个任务，用 tick 的总时长去看「谁慢」永远看不出结论——
     * 上一轮就因为把 reindex 的时间算进恢复，得出了错误 30 倍的结论。
     */
    const attemptStartedAt = Date.now();
    /**
     * 单次执行预算（硬超时）。
     *
     * 旧实现只有声明值、从不执行：一个卡住的巡检会把整轮 tick 拖死，
     * 后续任务全部排队（tick 是串行的）。这里用 Promise.race 在预算到点时
     * 让 Runner 脱身；handler 本身没有 AbortSignal，可能仍在后台跑，
     * 所以超时**不重试**（见 catch 里的 JobBudgetExceededError 分支），
     * 避免同一任务被两个执行流并发处理。
     */
    const budgetMs = DEFAULT_SCHEDULES[kind]?.timeoutMs ?? 0;
    const execution = (async (): Promise<void> => {
      switch (kind) {
        case "health_check":
          await this.runHealthCheck((payload ?? {}) as { siteId?: string; limit?: number });
          break;
        case "refetch_metadata":
          await this.runRefetch((payload ?? {}) as { siteId?: string; llm?: boolean });
          break;
        case "recompute_rank":
          await this.runRecomputeRank();
          break;
        case "reindex":
          await this.runReindex((payload ?? {}) as { siteId?: string; vectors?: boolean });
          break;
        case "site_self_healing":
          await this.runSiteSelfHealing((payload ?? {}) as { siteId?: string });
          break;
        case "token_audit":
          await this.runTokenAudit((payload ?? {}) as { expiringDays?: number; dormantDays?: number });
          break;
        case "purge_trash":
          await this.runPurgeTrash((payload ?? {}) as { olderThanDays?: number });
          break;
        case "taxonomy_audit":
          await this.runTaxonomyAudit((payload ?? {}) as { dryRun?: boolean; siteLimit?: number });
          break;
        case "data_retention":
          await this.runDataRetention((payload ?? {}) as DataRetentionPayload);
          break;
        case "plugin_governance":
          await this.runPluginGovernance();
          break;
        case "user_data_audit":
          await this.runUserDataAudit();
          break;
        case "backup_restore":
          // jobId 由 Runner 注入而不是放在 payload 里：入队时还拿不到 id（enqueueJob
          // 才生成），把 id 写进 payload 必然要「入队后再改 payload」这一趟额外写。
          await this.runBackupRestore((payload ?? {}) as { stagingPath?: string }, jobId);
          break;
        default:
          throw new Error("未知任务类型: " + kind);
      }
    })();
    let executionCompleted = false;
    try {
      await runWithBudget(execution, budgetMs, kind);
      executionCompleted = true;
      const durationMs = Date.now() - attemptStartedAt;
      const applied = await this.ctx.repo.withTransaction(async () => {
        const changed = await this.ctx.repo.completeJob(jobId, null, { durationMs });
        if (changed && kind === "data_retention") {
          const apply = (payload as DataRetentionPayload | null)?.apply === true;
          await this.ctx.repo.emitNotification({
            identity: ADMIN_NOTIFICATION_IDENTITY,
            idempotencyKey: `job:${jobId}:retention_completed`,
            kind: "retention_completed",
            title: apply ? "数据保留执行完成" : "数据保留预演完成（未删除数据）",
            body: `任务 ${jobId} 已完成。详细统计请查看任务与数据保留记录。`,
          });
        }
        return changed;
      });
      if (applied) {
        /**
         * 超过 10 秒就留一行日志。
         * 排查「这次 tick 为什么慢」时，这行日志比任何事后推测都直接：
         * 它同时给出 kind、耗时与 jobId，不必再去二分。
         */
        if (durationMs >= 10_000) {
          console.warn("[navhub-job] 长任务完成", { jobId, kind, durationMs });
        }
        jobEventBus.emitJobUpdate({
          jobId,
          kind,
          status: "completed",
          attempts,
          durationMs,
          timestamp: Date.now(),
        });
      } else {
        // 执行期间任务被取消 / 被 reaper 回收 / 已被接管：结果只记日志，不改写终态
        console.warn("[navhub-job] 完成回写被忽略（任务已不在 running）", { jobId, kind });
      }
    } catch (err) {
      // 终态/通知持久化故障不能伪装成任务执行失败。
      if (executionCompleted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      /**
       * 超时与普通失败分开处理：
       *  - 普通失败：按指数退避重试，attempts 耗尽后落 failed；
       *  - 预算超时：handler 可能仍在后台跑，立刻重试会让同一任务并发执行，
       *    因此直接落 failed 终态（人工确认后可从管理端 retry）。
       */
      const timedOut = err instanceof JobBudgetExceededError;
      const exhausted = timedOut || attempts >= MAX_JOB_ATTEMPTS;
      const retryAt = exhausted ? null : Date.now() + backoffMs(attempts);
      const durationMs = Date.now() - attemptStartedAt;
      if (durationMs >= 10_000 || timedOut) {
        console.warn("[navhub-job] 长任务失败", { jobId, kind, durationMs, error: message, timedOut });
      }
      const applied = await this.ctx.repo.withTransaction(async () => {
        const changed = await this.ctx.repo.completeJob(jobId, message, { retryAt, exhausted, durationMs });
        if (changed && exhausted) {
          await this.ctx.repo.emitNotification({
            identity: ADMIN_NOTIFICATION_IDENTITY,
            idempotencyKey: `job:${jobId}:failed`,
            kind: kind === "backup_restore" ? "backup_failed" : "job_failed",
            title: kind === "backup_restore" ? "备份恢复任务失败" : `自动化任务失败：${kind}`,
            body: `任务 ${jobId} 已停止自动重试。请到任务管理查看详情并决定是否重试。`,
          });
        }
        return changed;
      });
      if (!applied) {
        console.warn("[navhub-job] 失败回写被忽略（任务已不在 running）", { jobId, kind, error: message });
        return;
      }
      jobEventBus.emitJobUpdate({
        jobId,
        kind,
        status: exhausted ? "failed" : "retrying",
        attempts,
        error: message,
        durationMs,
        timestamp: Date.now(),
      });
      if (exhausted) {
        const detail = { kind, attempts, error: message };
        this.alert(
          (timedOut ? "任务 " + kind + " 超出单次执行预算，已终止（不会自动重试）：" : "任务 " + kind + " 连续失败 " + attempts + " 次，已停止重试：") + message,
          detail,
        );
      }
    } finally {
      if (jobHeartbeat) clearInterval(jobHeartbeat);
    }
  }

  /**
   * 失败告警：默认 console.error（生产可见于进程输出/容器日志），可注入 onAlert 收集
   * （测试用）。**只在重试耗尽时触发一次**——不搞每次失败都喊的告警风暴。
   */
  private alert(message: string, detail: { kind: string; attempts: number; error: string }): void {
    try {
      console.error("[navhub-job-alert] " + message, detail);
    } catch { /* 日志失败不影响任务流 */ }
    try {
      this.onAlert?.(message, detail);
    } catch { /* 回调失败不影响任务流 */ }
  }

  /**
   * 按 Weibull 寿命模型挑出本次该巡检的站点。
   *
   * 原先是 `listSites({ limit })` —— 等价于按 id 顺序取前 N 个，
   * 也就是假设「失效风险与站点年龄无关」。外链的实际形态是越老越容易挂
   * （域名到期、站点关停、改版换路由），所以这里改为：
   *   1. 取一个更大的候选池（PATROL_POOL_FACTOR × limit）
   *   2. 用 planPatrol 按存活概率升序排（最可能已失效的排最前）
   *   3. 取前 limit 个
   * 同样的抓取预算，覆盖到的才是真正可能已经挂掉的站点。
   */
  private async patrolTargets(limit: number) {
    const poolLimit = Math.min(2000, Math.max(limit, limit * 4));
    const pool = await this.ctx.repo.listSites({ limit: poolLimit });
    const alive: SiteRow[] = pool.filter((s): s is SiteRow => Boolean(s));
    if (alive.length === 0) return [];

    const plan = planPatrol(
      alive.map((s) => ({
        siteId: s.id,
        // 上次巡检时间戳在 health 子对象里（没查过就退回创建时间算年龄）
        lastCheckedAt: s.health?.lastCheckedAt ?? null,
        createdAt: s.createdAt ?? null,
      })),
    );
    const idToSite = new Map(alive.map((s) => [s.id, s]));
    const picked: typeof alive = [];
    for (const entry of plan) {
      const site = idToSite.get(entry.siteId);
      if (site) picked.push(site);
      if (picked.length >= limit) break;
    }
    return picked;
  }

  /** 健康巡检：与 MCP health_check 同一套抓取逻辑，但走仓储（双方言） */
  private async runHealthCheck(payload: { siteId?: string; limit?: number }): Promise<void> {
    const { guardedFetch } = await import("@navhub/ai");
    const limit = payload.limit ?? 50;
    const found: Array<SiteRow | null> = payload.siteId
      ? [await this.ctx.repo.getSite(payload.siteId)]
      : await this.patrolTargets(limit);
    const targets = found.filter((s): s is SiteRow => Boolean(s));
    let ok = 0;
    for (const site of targets) {
      const t0 = Date.now();
      try {
        const res = await guardedFetch(site!.url, { ...this.ctx.config.fetch });
        let healthy = res.status >= 200 && res.status < 400;
        let reason: string | null = null;

        if (healthy && res.body) {
          const audit = auditPageHealth(site!.url, res.body, undefined, undefined, { truncated: res.truncated });
          if (audit.status === "SUSPICIOUS_PARKED" || audit.status === "SOFT_404") {
            healthy = false;
            reason = `伪健康识别: ${audit.reason}`;
          }
        }

        if (healthy) ok++;
        // 恢复：曾被判 broken 的站点，只要这次探测健康就回到 active。
        // 人工标记的 archived/pending 不会被这次恢复覆盖。
        const nextStatus = healthy && site!.status === "broken" ? "active" : site!.status;
        await this.ctx.repo.updateSiteHealth(site!.id, {
          httpStatus: res.status,
          ok: healthy,
          latencyMs: Date.now() - t0,
          redirectTo: res.redirects?.at(-1) ?? null,
          error: reason,
          currentStatus: nextStatus,
          markBroken: healthy ? undefined : await this.shouldBreak(site!.id),
        });
      } catch (err) {

        await this.ctx.repo.updateSiteHealth(site!.id, {
          httpStatus: null,
          ok: false,
          latencyMs: Date.now() - t0,
          redirectTo: null,
          error: err instanceof Error ? err.message : String(err),
          currentStatus: site!.status,
          markBroken: await this.shouldBreak(site!.id),
        });
      }
    }
    await this.ctx.repo.recordEvent("health_check", { meta: { checked: targets.length, ok } }).catch(() => undefined);
  }

  /**
   * 本次失败是否足以把站点标为 broken。
   * 查该站点最近 threshold-1 次巡检，统计「从最近往前连续失败」的次数。
   */
  private async shouldBreak(siteId: string): Promise<boolean> {
    const threshold = HEALTH_FAIL_THRESHOLD;
    if (threshold <= 1) return true;
    try {
      const recent = await this.ctx.repo.recentHealthChecks(siteId, threshold - 1);
      let consecutive = 0;
      for (const r of recent) {
        if (r.ok) break;
        consecutive++;
      }
      return shouldMarkBroken(false, consecutive, threshold);
    } catch {
      // 查不到历史（新库/表缺失）时保守处理：不标 broken，等下一轮
      return false;
    }
  }

  /** 元数据刷新：默认只用启发式（不烧 LLM）；payload.llm=true 才走 LLM */
  private async runRefetch(payload: { siteId?: string; llm?: boolean }): Promise<void> {
    if (!payload.siteId) throw new Error("refetch_metadata 需要 siteId");
    const site = await this.ctx.repo.getSite(payload.siteId);
    if (!site) throw new Error("站点不存在: " + payload.siteId);

    /**
     * 后台任务同样要过额度闸门：它烧的是运维者那把系统 key，而且一次批量重刷
     * 能连发几十次模型调用，`payload.llm` 一旦被人循环投递就是无上限消耗。
     * 额度以 null 身份计（与 `job_enrich` 用量的 identity 列同为 NULL 对齐），
     * 被拒时降级成启发式抓取 —— 标题/描述/icon 照样拿得到，只是没有 AI 润色。
     */
    const quota = await checkLlmQuota(this.ctx, null);
    const useLlm = payload.llm === true && quota.ok;
    const resolved = useLlm ? await resolveLlm(this.ctx) : null;
    const enriched = await enrichUrl(site.url, {
      llm: resolved ? enrichLlmOf(resolved) : undefined,
      guard: this.ctx.config.fetch,
      heuristicOnly: !useLlm,
      onLlmCall: resolved ? createEnrichUsageCallback(this.ctx, resolved.source, null, "job_enrich") : undefined,
    });
    // 只覆盖「空值或超期（>30 天）字段」——刷新不该把人工精修的内容冲掉
    const stale = 30 * 86_400_000;
    const isStale = (updatedAt: number | undefined) => !updatedAt || Date.now() - updatedAt > stale;
    const patch: Record<string, unknown> = {};
    if (!site.description && enriched.description) patch.description = enriched.description;
    if (!site.title && enriched.title) patch.title = enriched.title;
    // 抓取到的 icon 指向第三方图标服务时不落库（视同没有；由前端本地解析链兜底）
    const enrichedIcon = sanitizeIconUrl(enriched.iconUrl);
    if (!site.iconKey && enrichedIcon) patch.iconKey = enrichedIcon;
    if (isStale(site.updatedAt) && enriched.description && !patch.description) {
      patch.description = enriched.description;
    }
    if (Object.keys(patch).length > 0) {
      await this.ctx.repo.updateSite(site.id, patch as never);
      await indexSite(this.ctx, site.id, (patch.title as string) ?? site.title, (patch.description as string) ?? site.description ?? null, site.url);
    }
    await this.ctx.repo
      .recordEvent("refetch", {
        siteId: site.id,
        meta: { provenance: enriched.provenance, aiSkipped: payload.llm === true && !quota.ok ? "quota" : null },
      })
      .catch(() => undefined);
  }

  /** 重算热度分：近 7 天点击 + 近 7 天收藏 − 年龄惩罚 */
  private async runRecomputeRank(): Promise<void> {
    const now = Date.now();
    const since7d = now - 7 * 86_400_000;
    // 全库覆盖 + 只取需要的两列。原来用 listSites()（默认 limit=100），
    // 第 101 条以后的站点永远拿不到新分数 —— 排序质量随库变大静默退化。
    // 走 selectSitesSql 还会为每行做标签/分面两个关联子查询，这里用不上。
    const [clicks, favorites, rankRows] = await Promise.all([
      this.ctx.repo.clickCountsSince(since7d),
      this.ctx.repo.favoriteCountsSince(since7d),
      this.ctx.repo.raw("SELECT id, created_at FROM sites WHERE deleted_at IS NULL"),
    ]);
    const scores = rankRows.map((r) => {
      const id = String(r.id);
      return {
        id,
        trendScore: trendScore({
          visits7d: clicks.get(id) ?? 0,
          favorites7d: favorites.get(id) ?? 0,
          ageDays: ageInDays(Number(r.created_at), now),
        }, now),
      };
    });
    await this.ctx.repo.setTrendScores(scores);
    await this.ctx.repo.recordEvent("recompute_rank", { meta: { sites: scores.length } }).catch(() => undefined);
  }

  /**
   * 重建索引：siteId 指定单个；否则全站。vectors=false 只重建拼音/FTS（快）。
   * targets 缺省 = ["sites"]（向后兼容）；包含 "plugins" 时同时重建插件语义向量。
   */
  private async runReindex(payload: {
    siteId?: string;
    /**
     * 只重建这些站点的索引（恢复任务用）。
     *
     * 为什么需要：全量 reindex 是 O(全库)，而恢复只动了库里的一个子集
     * （全新库）或几条（增量补录）。50k 库上全量要 148 秒，占「恢复 5 万条」
     * 完整体验的 87%——而其中绝大多数工作与本次恢复无关。
     */
    siteIds?: string[];
    vectors?: boolean;
    targets?: Array<"sites" | "plugins">;
  }): Promise<void> {
    const targets: Array<"sites" | "plugins"> =
      Array.isArray(payload.targets) && payload.targets.length > 0 ? payload.targets : ["sites"];
    if (targets.includes("plugins")) {
      await this.runReindexPlugins();
    }
    if (!targets.includes("sites")) return;
    // 重建索引需要 id/标题/描述/网址四列。全量分支不能走 listSites()：它默认
    // limit=100（给匿名搜索通道设的成本上限），会让"全站重建"静默只覆盖前 100
    // 条，事件里还照报 sites:100；也不能走 listAllSites()：那会为每行再做标签与
    // 分面两个关联子查询，重建索引根本用不到。
    type ReindexRow = { id: string; title: string; description: string | null; url: string };
    const sites: ReindexRow[] = [];
    if (Array.isArray(payload.siteIds) && payload.siteIds.length > 0) {
      /**
       * 按 id 批量取数。分块是因为 SQLite 的绑定变量上限（999），
       * `chunkList` 的 500 是仓库里既有的安全口径。
       *
       * `deleted_at IS NULL` 不能省：传进来的 id 可能在入队之后被删了，
       * 给已删除的站点重建索引只会把死数据塞回检索结果里。
       */
      for (const part of chunkList(payload.siteIds)) {
        const rows = await this.ctx.repo.raw(
          `SELECT id, title, description, url FROM sites WHERE deleted_at IS NULL AND id IN (${part
            .map(() => "?")
            .join(",")}) ORDER BY id`,
          part,
        );
        for (const r of rows) {
          sites.push({
            id: String(r.id),
            title: String(r.title ?? ""),
            description: r.description == null ? null : String(r.description),
            url: String(r.url ?? ""),
          });
        }
      }
    } else if (payload.siteId) {
      const one = await this.ctx.repo.getSite(payload.siteId);
      if (one) sites.push({ id: one.id, title: one.title, description: one.description ?? null, url: one.url });
    } else {
      const rows = await this.ctx.repo.raw(
        "SELECT id, title, description, url FROM sites WHERE deleted_at IS NULL ORDER BY id",
      );
      for (const r of rows) {
        sites.push({
          id: String(r.id),
          title: String(r.title ?? ""),
          description: r.description == null ? null : String(r.description),
          url: String(r.url ?? ""),
        });
      }
    }

    const BATCH_SIZE = 32;
    for (let i = 0; i < sites.length; i += BATCH_SIZE) {
      const chunk = sites.slice(i, i + BATCH_SIZE);
      await this.ctx.repo.withTransaction(async () => {
        for (const site of chunk) {
          // updateSite 会用当前标题/描述/标签重算 fts_tokens 与拼音（写入期预计算）
          await this.ctx.repo.updateSite(site.id, {
            title: site.title,
            description: site.description ?? null,
          });
        }
      });
      if (payload.vectors !== false) {
        await indexSitesBatch(
          this.ctx,
          chunk.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description ?? null,
            url: s.url,
          }))
        );
      }
    }
    await this.ctx.repo.recordEvent("reindex", { meta: { sites: sites.length, vectors: payload.vectors !== false } }).catch(() => undefined);
  }

  /** 重建插件语义索引：分页拉全量已上架插件，批量向量化（失败只记 notes，不中断） */
  private async runReindexPlugins(): Promise<void> {
    const PAGE = 100;
    let offset = 0;
    let total = 0;
    for (;;) {
      const res = await this.ctx.repo.listPlugins({ status: "published", limit: PAGE, offset });
      if (res.items.length === 0) break;
      await indexPluginsBatch(
        this.ctx,
        res.items.map((p) => indexItemFromManifest(p.slug, p.manifest)),
      );
      total += res.items.length;
      offset += res.items.length;
      if (res.items.length < PAGE) break;
    }
    await this.ctx.repo
      .recordEvent("reindex", { meta: { plugins: total } })
      .catch(() => undefined);
  }

  /** AI 自动自愈：对 broken/失效站点执行 Wayback 归档解析与同图谱健康替代推荐 */
  private async runSiteSelfHealing(payload: { siteId?: string }): Promise<void> {
    if (!payload.siteId) throw new Error("site_self_healing 需要 siteId");
    const site = await this.ctx.repo.getSite(payload.siteId);
    if (!site) throw new Error("站点不存在: " + payload.siteId);

    const peers = await this.ctx.repo.listSites({ categoryId: site.categoryId, status: "active", limit: 20 });
    const report = runAutonomousHealing({
      siteId: site.id,
      url: site.url,
      title: site.title,
      categoryId: site.categoryId,
      tags: site.tags,
      availablePeers: peers,
    });

    await this.ctx.repo.audit({
      actor: "system:job-runner",
      actorKind: "job",
      action: "site.heal",
      target: site.id,
      diff: {
        diagnosis: report.diagnosis,
        recommendedAction: report.recommendedAction,
        waybackFallbackUrl: report.waybackFallbackUrl,
        topReplacement: report.suggestedReplacements[0]?.url,
      },
    });

    await this.ctx.repo.recordEvent("site_healing", {
      siteId: site.id,
      meta: { action: report.recommendedAction, autoResolvable: report.autoResolvable },
    }).catch(() => undefined);
  }

  /**
   * 凭据治理巡检：扫描临期、过期、长期闲置的凭据并落审计。
   *
   * 解决痛点：凭据过期与泄露往往是静默发生的，运维不可能天天盯列表。
   * 定期运行 token_audit 可以在凭据失效前预警、在僵尸凭据存在时提醒吊销。
   */
  private async runTokenAudit(options: { expiringDays?: number; dormantDays?: number } = {}): Promise<void> {
    const tokens = await this.ctx.repo.listApiTokens();
    const now = Date.now();
    const DAY = 86_400_000;
    const expiringThresholdMs = (options.expiringDays ?? 14) * DAY;
    const dormantThresholdMs = (options.dormantDays ?? 90) * DAY;

    const expired: string[] = [];
    const expiring: string[] = [];
    const dormant: string[] = [];

    for (const t of tokens) {
      if (t.revokedAt != null) continue; // 已吊销的不重复告警
      if (t.expiresAt != null) {
        if (t.expiresAt <= now) {
          expired.push(t.id);
        } else if (t.expiresAt - now <= expiringThresholdMs) {
          expiring.push(t.id);
        }
      }
      const lastActive = t.lastUsedAt ?? t.createdAt;
      if (now - lastActive >= dormantThresholdMs) {
        dormant.push(t.id);
      }
    }

    if (expired.length > 0 || expiring.length > 0 || dormant.length > 0) {
      await this.ctx.repo.audit({
        actor: "system:job-runner",
        actorKind: "job",
        action: "token.audit",
        diff: {
          totalChecked: tokens.length,
          expiredCount: expired.length,
          expiringCount: expiring.length,
          dormantCount: dormant.length,
          expiredIds: expired,
          expiringIds: expiring,
          dormantIds: dormant,
        },
      });
      if (expiring.length > 0) {
        console.warn(`[navhub-token-audit] 发现 ${expiring.length} 条凭据即将过期`);
      }
      if (expired.length > 0) {
        console.warn(`[navhub-token-audit] 发现 ${expired.length} 条凭据已过期且尚未吊销`);
      }
    }
  }

  /** 回收站定时清除：彻底物理清理超过指定天数（默认 30 天）的软删除站点及关联索引 */
  private async runPurgeTrash(payload: { olderThanDays?: number } = {}): Promise<void> {
    const days = Math.max(1, payload.olderThanDays ?? 30);
    const ms = days * 86_400_000;
    /**
     * 兼容两种返回形态：HEAD 的仓储返回「清理条数」，而任务侧还需要 id 列表来
     * 同步删除向量——仓储改成 `{ purged, ids }` 的改动尚未落地（工作区在途）。
     * 这里做形状适配而不是硬等：仓储升级后本段无需再改，且当前编译不再 TS2339
     * （2026-10-27 main 的 SQLite / PG 两个作业就是被这处类型错误拖红的）。
     */
    type PurgeResult = { purged: number; ids: string[] };
    const purgeResult = (await this.ctx.repo.purgeExpiredDeletedSites(ms)) as number | PurgeResult;
    const purged = typeof purgeResult === "number" ? purgeResult : purgeResult.purged;
    const ids = typeof purgeResult === "number" ? [] : purgeResult.ids;
    // 向量表不在 purgeSite 的事务里（它由 API 层的 vector store 持有）：
    // 不在这里同步删除，被清站点的向量会继续占 KNN 的 top-N 名额。
    if (ids.length > 0 && this.ctx.vectors) {
      await this.ctx.vectors.remove(ids).catch((err) => {
        console.warn("[navhub-job] 回收站清理后同步删除向量失败", {
          count: ids.length,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    await this.ctx.repo.recordEvent("purge_trash", { meta: { days, purged } }).catch(() => undefined);
  }

  /**
   * 备份恢复（异步）：从 staging 文件读规范化后的计划，分片写入。
   *
   * 为什么分片而不是单事务：单事务 5 万条会持写锁 30 秒以上，期间所有读请求
   * 排队。分片的代价是「失败时可能已提交前几片」——由**恢复本身的幂等性**兜住
   * （`insertSitesBulk` 的 URL 去重只认 `deleted_at IS NULL`，重跑会跳过已导入的）。
   *
   * staging 的读取放在任务里而不是请求里：请求内只做校验与写文件，
   * 这样请求时长与数据量解耦（这正是异步化的目的）。
   *
   * 失败时**不删** staging：运维要能拿它复盘或直接重跑（JobRunner 会按退避重试）。
   */
  private async runBackupRestore(payload: { stagingPath?: string }, jobId: string): Promise<void> {
    const { stagingPath } = payload;
    if (!stagingPath) {
      throw new Error("backup_restore 缺少 stagingPath（端点应在入队前把规范化计划落到 staging 文件）");
    }

    interface StagedSite {
      url: string;
      title?: string;
      description?: string | null;
      categoryId?: string | null;
      tags?: string[];
      iconKey?: string | null;
      enabled?: boolean;
      createdAt?: number;
    }
    interface StagedPlan {
      categories?: Array<{ id: string; title: string; description?: string | null; sort?: number }>;
      sites?: StagedSite[];
    }

    let plan: StagedPlan;
    try {
      plan = JSON.parse(await readFile(stagingPath, "utf8")) as StagedPlan;
    } catch (err) {
      // 文件不在 = 已被处理过或过期清理；明确失败，不要当成功（否则 status 会谎报完成）
      throw new Error("读取恢复 staging 失败（可能已被处理或过期）：" + String((err as Error)?.message ?? "unknown"));
    }

    const categories = plan.categories ?? [];
    const sites = plan.sites ?? [];

    /**
     * 取消检查：只在分片边界做。
     *
     * 取消（`POST /api/jobs/:id/cancel`）把 `jobs.status` 改成 `cancelled`，但执行中的
     * 函数不会自己停下来——不检查就会「界面显示已取消，实际还在往库里写」，
     * 而用户看到已取消会立刻重新提交，正好制造两组分片并发写。
     *
     * 为什么只在分片边界查：分片是不可中断的最小单位（一个事务），
     * 中途喊停没有意义；每片查一次的成本是一条按主键的 SELECT，可以忽略。
     *
     * 取消后**不删 staging**：`retryJob` 允许把 cancelled 的任务重新排队，
     * 删了文件那次重试就必然失败。残留由 `sweepStaleStaging` 按 24 小时清。
     */
    const isCancelled = async (): Promise<boolean> => {
      const rows = await this.ctx.repo.raw("SELECT status FROM jobs WHERE id = ? LIMIT 1", [jobId]);
      return String(rows[0]?.status ?? "") === "cancelled";
    };
    if (await isCancelled()) {
      console.info("[navhub-job] 恢复任务在执行前已被取消，未写入任何数据", { jobId });
      return;
    }

    /**
     * 分类必须先建，且 categoryId 必须已由端点解析成真实 id。
     * 任务侧不做「兜底塞进未分类」——那会让一条脏数据静默改变用户的分类结构，
     * 而恢复这种操作应该「要么正确，要么明确失败」。
     */
    const missingCategory = sites.find((site) => !site.categoryId);
    if (missingCategory) {
      throw new Error(`staging 里有站点缺少 categoryId（例如 ${missingCategory.url}）：端点应在入队前完成分类解析`);
    }

    /**
     * 分类按 id 幂等：重试时这些分类已经存在，直接跳过。
     *
     * 不这样做的后果比「多建一次」严重得多：`createCategory` 会先做同级同名检查，
     * 第二次必然抛「同级下已存在名为 X 的类目」——于是**任何带分类的备份在第一次
     * 失败之后，剩下两次自动重试都会卡在第一步**，根本没机会走到站点写入。
     * 这也是为什么「重试幂等」必须先于「站点去重」修，否则改了后者也验证不到。
     */
    const existingCategoryIds = new Set((await this.ctx.repo.listCategories()).map((c) => c.id));
    for (const category of categories) {
      if (existingCategoryIds.has(category.id)) continue;
      await this.ctx.repo.createCategory({
        id: category.id,
        title: category.title,
        description: category.description ?? null,
        sort: category.sort ?? 0,
      });
    }

    const CHUNK = restoreChunkSize();

    /**
     * 本次真正插入的站点 id（分片提交成功后才记录）。
     *
     * 收尾时把它交给 `reindex`，让索引只重建这一批——全量重建是 O(全库)，
     * 而恢复动的往往只是子集。50k 库上全量要 148 秒，占「恢复 5 万条」
     * 完整体验的 87%，其中绝大多数工作与本次恢复无关。
     *
     * 为什么不在 `insertSitesBulk` 的返回值里取：它在 `hydrate: false` 时
     * 直接返回 `{ count, sites: [] }`（不为恢复场景多查一遍库），
     * 而 id 本来就是这里生成的，顺手记下来比让仓储层回查便宜。
     */
    const insertedIds: string[] = [];

    /**
     * 断点续跑：`progress_done` 记的是「已处理的计划条数」，按分片对齐后从这里继续。
     *
     * 从 0 重来在正确性上已经安全（下一段的分片级去重会跳掉已存在的），
     * 但白跑几十秒没有意义，而且会让重试期间的用户看到进度从 100% 退回 0%。
     */
    const progressRows = await this.ctx.repo.raw(
      "SELECT progress_done FROM jobs WHERE id = ? LIMIT 1",
      [jobId],
    );
    const doneBefore = Math.max(0, Number(progressRows[0]?.progress_done ?? 0));
    const startIndex = Math.min(sites.length, doneBefore - (doneBefore % CHUNK));

    let processed = startIndex;
    // 先把 total 报上去：否则前端在第一批写完之前只能显示「正在准备恢复计划」
    await this.ctx.repo.updateJobProgress(jobId, { done: processed, total: sites.length });

    for (let i = startIndex; i < sites.length; i += CHUNK) {
      /**
       * 让出一次事件循环。
       *
       * `better-sqlite3` 是**同步**驱动：一片 2000 条会把事件循环独占几秒。
       * 在这几秒里，跑在同一个进程里的 HTTP 处理完全停摆——
       *   · 前端的进度查询会卡住（用户看到的是「进度条不动」而不是慢）；
       *   · 取消请求根本进不来（即使下面的检查写了也永远读不到 cancelled）。
       * `setImmediate` 落在 check 阶段，正好在「上一个分片写完」与「下一个分片开始」之间，
       * 让待处理的定时器（轮询）与 IO（取消请求）先跑一轮。
       */
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (await isCancelled()) {
        console.info("[navhub-job] 恢复任务已取消，停在分片边界", {
          jobId,
          processed,
          total: sites.length,
        });
        return;
      }
      const slice = sites.slice(i, i + CHUNK);

      /**
       * 分片级去重：写入前按 URL 过滤掉库里已有的。
       *
       * 这是「重试不会写出重复站点」的唯一保证。staging 是**请求时算出的冻结快照**，
       * 而任务可能因为失败被重放（`MAX_JOB_ATTEMPTS = 3`），也可能在「预演 → 执行」
       * 之间被别人插入了同一个 URL。`insertSitesBulk` 是裸 `INSERT`，`sites.url`
       * 又没有唯一约束——不去重就会静默写出重复行：不报错、不拦截，
       * 用户只会在导航页看到两张一样的卡片，而且此后任何恢复都会把它们判成「已存在」
       * 而永久保留。
       */
      const existingUrls = await this.ctx.repo.findExistingSiteUrls(slice.map((site) => site.url));
      const fresh =
        existingUrls.size === 0 ? slice : slice.filter((site) => !stagedUrlExists(existingUrls, site.url));

      if (fresh.length > 0) {
        const rows = fresh.map((site) => ({
          // 新 UUID：恢复不保留原 id（原 id 可能已被软删行占用，撞主键会让整片失败）
          id: randomUUID(),
          url: site.url,
          title: site.title,
          description: site.description ?? null,
          categoryId: site.categoryId as string,
          tags: site.tags ?? [],
          iconKey: site.iconKey ?? null,
          // 停用态必须原样恢复，否则恢复会把隐藏内容批量上线
          enabled: site.enabled !== false,
          status: (site.enabled === false ? "archived" : "active") as "active" | "archived",
          createdAt: site.createdAt,
        }));
        await this.ctx.repo.withTransaction(async () => {
          await this.ctx.repo.insertSitesBulk(rows, { hydrate: false });
        });
        // 事务提交成功才记：回滚的话这些 id 在库里根本不存在
        for (const row of rows) insertedIds.push(row.id);
      }

      // 进度记「已处理」而不是「已写入」：续跑要对齐分片边界，而实际写入数
      // 可能因去重略少于本片条数（并发插入或重放已提交分片时）。
      processed = i + slice.length;
      await this.ctx.repo.updateJobProgress(jobId, { done: processed, total: sites.length });
    }

    /**
     * 收尾：为**本次写入的站点**补索引（恢复只写 sites/site_tags，不建向量）。
     *
     * 三种情况分开处理，因为它们的正确性与代价完全不同：
     *
     *   1. `insertedIds` 为空 —— 本次一条都没写（重跑、或全是已存在的）。
     *      不入队。以前无条件入队一次全库 reindex，5 万条的库上要白跑 148 秒。
     *   2. 条数 ≤ 阈值 —— 增量：只重建这批 id。
     *   3. 条数 > 阈值 —— 退回全量。增量此时已经覆盖库里大半，省不下多少，
     *      而 payload 里塞几万个 id 反而是负担（阈值可配，见 reindexIncrementalMax）。
     *
     * ⚠️ **断点续跑时强制全量**：`startIndex > 0` 说明上一次尝试已经写过
     * `startIndex` 条却失败了。那批站点从未被索引（reindex 只在任务成功后才入队），
     * 而它们的 id 已经随失败进程丢失（staging 里存的是计划，不是生成的 UUID）。
     * 只重建本次写入的 id 会**留下一批没有索引的站点**——而且不会有任何报错。
     *
     * ⚠️ 行为变化：全量 reindex 过去还顺带修复了历史脏行（早期写入时
     * fts_tokens/拼音过期的那批）。增量不做这件事，因为它不是恢复的职责。
     * 需要全库修复时显式入队：`POST /api/jobs {kind:"reindex", payload:{vectors:true}}`。
     */
    if (sites.length > 0) {
      const resuming = startIndex > 0;
      if (insertedIds.length === 0) {
        console.info("[navhub-job] 本次恢复没有新增站点，跳过 reindex", { jobId });
      } else if (resuming) {
        console.info("[navhub-job] 断点续跑，改为全量 reindex（前置尝试写入的站点 id 已丢失）", {
          jobId,
          resumedFrom: startIndex,
          insertedNow: insertedIds.length,
        });
        await this.ctx.repo.enqueueJob("reindex", { vectors: true });
      } else if (insertedIds.length <= reindexIncrementalMax()) {
        await this.ctx.repo.enqueueJob("reindex", { siteIds: insertedIds, vectors: true });
      } else {
        await this.ctx.repo.enqueueJob("reindex", { vectors: true });
      }
    }

    // 成功才删 staging（失败保留供重跑/复盘）
    await unlink(stagingPath).catch(() => undefined);
    await this.ctx.repo
      .recordEvent("backup_restore", { meta: { categories: categories.length, sites: sites.length } })
      .catch(() => undefined);
  }

  /**
   * 数据保留 / 明细聚合（`events` 与 `audit_logs` 两张只增不删的表）。
   *
   * 与 `scripts/data-retention.mjs` 的分工：脚本是给人跑的（能写 gzip 冷归档、能
   * `--vacuum` 整理空间、有人盯着确认）；任务是给调度器跑的（拿不到可靠的归档落点，
   * 也没人当场确认）。因此任务里两条路的权限不同：
   *   - `rollup`：聚合先写进 `events_daily` / `audit_daily` 再删明细 —— 统计在库内兜底，
   *     不依赖任何外部文件，允许 `apply`（但定时调度默认 dry-run，见 DEFAULT_CRON_SCHEDULES）；
   *   - `cleanup`：删的是"唯一留底在归档文件里"的原样明细，任务里没有可靠的归档目标，
   *     **一律拒绝 apply** —— 要真删请用 CLI，别让调度器替人做这个决定。
   */
  /**
   * 插件治理巡检：待审超 SLA、插件被举报、评价被举报。
   * 只写审计与日志，不自动下架/隐藏——治理动作必须由人做，避免误伤。
   */
  private async runPluginGovernance(): Promise<void> {
    const alerts = await this.ctx.repo.getPluginGovernanceAlerts();
    if (alerts.length === 0) return;
    await this.ctx.repo.audit({
      actor: "system",
      actorKind: "system",
      action: "plugin.governance.alert",
      target: "plugin_governance",
      diff: {
        count: alerts.length,
        alerts: alerts.slice(0, 20).map((a) => ({ kind: a.kind, slug: a.slug, value: a.value, detail: a.detail })),
      },
    });
    console.warn(`[jobs] plugin_governance: ${alerts.length} 条告警待处理`);
  }

  /**
   * 用户数据质量巡检（T24）：全库统计「孤儿收藏夹引用 / 站点已不存在的收藏」，
   * 只写审计与行为事件，不修复不删除。检测逻辑与 /api/me/diagnostics 的自动修复
   * 同源；批量同步通道按设计允许站点缺失行（本地 href 兜底渲染），这里是把它们
   * 从「静默存在」变成「可被看见」。
   */
  private async runUserDataAudit(): Promise<void> {
    const danglingFolderRefs = Number(
      (
        await this.ctx.repo.raw(
          "SELECT COUNT(*) AS c FROM favorites WHERE deleted_at IS NULL AND folder_id IS NOT NULL AND folder_id NOT IN (SELECT id FROM favorite_folders)",
        )
      )[0]?.c ?? 0,
    );
    const favoritesMissingSite = Number(
      (
        await this.ctx.repo.raw(
          "SELECT COUNT(*) AS c FROM favorites WHERE deleted_at IS NULL AND site_id NOT IN (SELECT id FROM sites)",
        )
      )[0]?.c ?? 0,
    );
    const summary: Record<string, number | string> = { danglingFolderRefs, favoritesMissingSite };

    /**
     * 站点侧的完整性核对（2026-10-24 增补）。
     *
     * 这三项是备份恢复与批量导入的「静默后果」：恢复只写 sites / site_tags，
     * 不建向量；批量写入如果标签解析失败就会留下悬空关联。它们都不影响页面
     * 渲染，所以只会在「搜不到」「点开是空类目」这种间接抱怨里暴露。
     *
     * 只报不动：与现有巡检口径一致，清理交给运营决定。
     */
    // 悬空关联：关联行指向已不存在的站点或标签
    summary.orphanSiteTags = Number(
      (
        await this.ctx.repo.raw(
          `SELECT COUNT(*) AS c FROM site_tags st
           WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = st.site_id)
              OR NOT EXISTS (SELECT 1 FROM tags t WHERE t.id = st.tag_id)`,
        )
      )[0]?.c ?? 0,
    );
    // 向量缺口只在启用本地 embedding 时有意义：lite 模式默认关闭，
    // 关闭时「每条都缺」是预期状态，报出来只会变成每日噪音。
    // 判据用 config.enabled 而不是 `ctx.embedding` 是否存在：service 对象在关闭时
    // 仍会被构造（供 /api/health 如实上报能力），非 null 不代表真的会写向量。
    if (this.ctx.embedding && this.ctx.config.embedding.enabled) {
      summary.sitesMissingEmbedding = Number(
        (
          await this.ctx.repo.raw(
            `SELECT COUNT(*) AS c FROM sites s
             WHERE s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.site_id = s.id)`,
          )
        )[0]?.c ?? 0,
      );
      summary.orphanEmbeddings = Number(
        (
          await this.ctx.repo.raw(
            "SELECT COUNT(*) AS c FROM embeddings e WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = e.site_id)",
          )
        )[0]?.c ?? 0,
      );
    }
    // 备份超期提醒（T13）：有收藏但 30 天内没有导出过的身份 → 一条通知（7 天去重）。
    // 「先看见再动」同样适用：这里只提醒，不代替用户导出。
    try {
      const BATCH = 500;
      const owners = await this.ctx.repo.raw(
        "SELECT DISTINCT user_id FROM favorites WHERE deleted_at IS NULL LIMIT ?",
        [BATCH],
      );
      const now3 = Date.now();
      const THIRTY_DAYS = 30 * 86_400_000;
      const SEVEN_DAYS = 7 * 86_400_000;
      let reminded = 0;
      for (const row of owners) {
        const identity = String(row.user_id);
        const lastExport = (
          await this.ctx.repo.raw(
            "SELECT MAX(created_at) AS m FROM audit_logs WHERE action = 'user.export' AND target = ?",
            [identity],
          )
        )[0];
        const lastAt = Number(lastExport?.m ?? 0);
        if (lastAt > now3 - THIRTY_DAYS) continue;
        if (await this.ctx.repo.hasRecentNotification(identity, "backup_due", SEVEN_DAYS)) continue;
        await this.ctx.repo.emitNotification({
          identity,
          idempotencyKey: `backup_due:${Math.floor(now3 / SEVEN_DAYS)}`,
          kind: "backup_due",
          title: "该备份数据了",
          body: "你的收藏已经超过 30 天没有导出备份。到「用户中心 → 数据与隐私」一键导出 JSON 或加密金库，防患于未然。",
        });
        reminded += 1;
      }
      if (reminded > 0) {
        summary.backupReminders = reminded;
      }
    } catch (err) {
      // 提醒失败不影响巡检主结论
      summary.backupRemindersError = String((err as Error)?.message ?? "unknown");
    }

    await this.ctx.repo.audit({
      actor: "system:user_data_audit",
      actorKind: "system",
      action: "user_data.audit",
      target: "global",
      diff: summary,
    }).catch(() => undefined);
    await this.ctx.repo.recordEvent("user_data_audit", { meta: summary }).catch(() => undefined);
    if (danglingFolderRefs > 0 || favoritesMissingSite > 0) {
      console.warn(`[jobs] user_data_audit: 孤儿夹引用 ${danglingFolderRefs}，站点缺失收藏 ${favoritesMissingSite}（只报不动）`);
    }
  }

  private async runDataRetention(payload: DataRetentionPayload = {}): Promise<void> {
    const mode = payload.mode === "cleanup" ? "cleanup" : "rollup";
    if (mode === "cleanup" && payload.apply === true) {
      throw new Error(
        "cleanup 模式在任务里只允许 dry-run：原样明细的唯一留底是归档文件，而任务没有可靠的归档落点。" +
          "要真正删除请用 CLI：node scripts/data-retention.mjs --apply（先 gzip 归档再删，删完可 --vacuum）。",
      );
    }
    const apply = payload.apply === true;
    const summary = await runRetentionMainPhase(this.ctx, payload, apply);
    const sideEffects = apply
      ? await applyRetentionSideEffects(this.ctx, payload)
      : await previewRetentionSideEffects(this.ctx, payload);
    Object.assign(summary, sideEffects);
    await this.ctx.repo.recordEvent("data_retention", { meta: summary }).catch(() => undefined);
  }

  /** 分类与标签体系智能治理审计 */
  private async runTaxonomyAudit(payload: { dryRun?: boolean; siteLimit?: number } = {}): Promise<void> {
    const res = await this.ctx.repo.runTaxonomyAudit({
      dryRun: payload.dryRun ?? false,
      siteLimit: payload.siteLimit ?? 500,
    });
    const byKind = Object.entries(res.byKind)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([kind, count]) => `${kind}:${count}`)
      .join(" / ");
    // 日报口径：一行里同时出现总数与分类型分布，运营不必再点进队列才知道「今天多了什么」
    console.info(
      `[navhub-taxonomy-audit] 审计完成：${res.proposalsCount} 条提案（${byKind || "无"}）`,
    );
    // dryRun 是演练，不落审计日志，避免污染运营时间线
    if (!payload.dryRun) {
      await this.ctx.repo.audit({
        actor: "system:job-runner",
        actorKind: "job",
        action: "taxonomy.audit.daily",
        target: "taxonomy",
        diff: { proposalsCount: res.proposalsCount, byKind: res.byKind },
      });
    }
  }

  /* --------------------------- 底层执行 --------------------------- */

  private async run(sqlText: string, params: unknown[]): Promise<void> {
    const db = this.ctx.db;
    if (db.dialect === "sqlite") {
      db.sqlite!.prepare(sqlText).run(...bindSqlite([...params]));
      return;
    }
    await db.pg!.query(toPgSql(sqlText), params);
  }

  private async runCount(sqlText: string, params: unknown[]): Promise<number> {
    const db = this.ctx.db;
    if (db.dialect === "sqlite") {
      const info = db.sqlite!.prepare(sqlText).run(...bindSqlite([...params])) as { changes?: number };
      return Number(info?.changes ?? 0);
    }
    const res = await db.pg!.query(toPgSql(sqlText), params);
    return Number(res.rowCount ?? 0);
  }
}

function createRetentionAdapter(ctx: AppContext): RetentionAdapter {
  const db = ctx.db;
  const isPg = db.dialect === 'pg';
  return {
    placeholder: (i: number) => (isPg ? '$' + i : '?'),
    select: async (sql: string, params: readonly unknown[]) => {
      if (isPg) {
        const res = await db.pg!.query(sql, params as unknown[]);
        return res.rows as never;
      }
      return db.sqlite!.prepare(sql).all(...(params as unknown[])) as never;
    },
    execute: async (sql: string, params: readonly unknown[]) => {
      if (isPg) {
        const res = await db.pg!.query(sql, params as unknown[]);
        return Number(res.rowCount ?? 0);
      }
      const info = db.sqlite!.prepare(sql).run(...(params as unknown[])) as { changes?: number };
      return Number(info?.changes ?? 0);
    },
  };
}

async function runRetentionMainPhase(
  ctx: AppContext,
  payload: DataRetentionPayload,
  apply: boolean,
): Promise<Record<string, unknown>> {
  const adapter = createRetentionAdapter(ctx);
  const mode = payload.mode === "cleanup" ? "cleanup" : "rollup";
  if (mode === "rollup") {
    const res = await runRollup(adapter, {
      targets: DEFAULT_ROLLUP_TARGETS.map((target) => ({ spec: target.spec, keepDays: target.keepDays })),
      dialect: ctx.db.dialect === "pg" ? "postgres" : "sqlite",
      maxDaysPerRun: payload.maxDays ?? 30,
      maxGroupsPerDay: payload.maxGroups ?? 5000,
      dryRun: !apply,
    });
    return {
      mode,
      apply,
      days: res.tables.map((table) => table.days),
      groups: res.tables.reduce((sum, table) => sum + table.groups, 0),
      rows: res.tables.reduce((sum, table) => sum + table.rows, 0),
      deleted: res.tables.reduce((sum, table) => sum + table.deleted, 0),
      skippedDays: res.tables.reduce((sum, table) => sum + table.skippedDays, 0),
      truncated: res.tables.map((table) => table.truncated),
    };
  }

  const res = await runRetention(adapter, {
    targets: DEFAULT_RETENTION_TARGETS,
    maxScan: payload.maxScan ?? 200_000,
    dryRun: true,
  });
  return {
    mode,
    apply: false,
    reason: "cleanup 在任务里只做 dry-run，真正删除请用 CLI",
    scanned: res.tables.reduce((sum, table) => sum + table.scanned, 0),
    truncated: res.tables.map((table) => table.truncated),
  };
}

async function previewRetentionSideEffects(
  ctx: AppContext,
  payload: DataRetentionPayload,
): Promise<Record<string, unknown>> {
  const adapter = createRetentionAdapter(ctx);
  const telemetryDays = Math.max(1, payload.telemetryDays ?? 90);
  const since = Date.now() - telemetryDays * 86_400_000;
  const health = await adapter.select(
    `SELECT COUNT(*) AS count FROM health_checks WHERE checked_at < ${adapter.placeholder(1)}`,
    [since],
  );
  const usage = await adapter.select(
    `SELECT COUNT(*) AS count FROM llm_usage WHERE created_at < ${adapter.placeholder(1)}`,
    [since],
  );

  let usersAffected = 0;
  let rowsDeleted = 0;
  try {
    const custom = await ctx.repo.listCustomHistoryRetention();
    const now = Date.now();
    for (const { identity, retentionDays } of custom) {
      const cutoff = now - retentionDays * 86_400_000;
      const rows = await adapter.select(
        `SELECT COUNT(*) AS count FROM search_history WHERE user_id = ${adapter.placeholder(1)} AND created_at < ${adapter.placeholder(2)}`,
        [identity, cutoff],
      );
      const count = Number(rows[0]?.count ?? 0);
      if (count > 0) {
        usersAffected += 1;
        rowsDeleted += count;
      }
    }
    return {
      telemetry: {
        days: telemetryDays,
        healthChecks: Number(health[0]?.count ?? 0),
        llmUsage: Number(usage[0]?.count ?? 0),
      },
      userRetention: { usersAffected, rowsDeleted },
    };
  } catch (err) {
    return {
      telemetry: {
        days: telemetryDays,
        healthChecks: Number(health[0]?.count ?? 0),
        llmUsage: Number(usage[0]?.count ?? 0),
      },
      userRetention: { error: String((err as Error)?.message ?? "unknown") },
    };
  }
}

async function applyRetentionSideEffects(
  ctx: AppContext,
  payload: DataRetentionPayload,
): Promise<Record<string, unknown>> {
  const telemetryDays = Math.max(1, payload.telemetryDays ?? 90);
  const since = Date.now() - telemetryDays * 86_400_000;
  const telemetry = {
    days: telemetryDays,
    healthChecks: await ctx.repo.pruneHealthChecks(since),
    llmUsage: await ctx.repo.pruneLlmUsage(since),
  };

  try {
    const custom = await ctx.repo.listCustomHistoryRetention();
    let usersAffected = 0;
    let rowsDeleted = 0;
    const now = Date.now();
    for (const { identity, retentionDays } of custom) {
      const cutoff = now - retentionDays * 86_400_000;
      const deleted = await ctx.repo.deleteSearchHistoryBefore(identity, cutoff);
      if (deleted > 0) {
        usersAffected += 1;
        rowsDeleted += deleted;
        await ctx.repo.audit({
          actor: "system:data_retention",
          actorKind: "system",
          action: "user.search_history_expired",
          target: identity,
          diff: { retentionDays, deleted },
        }).catch(() => undefined);
      }
    }
    return { telemetry, userRetention: { usersAffected, rowsDeleted } };
  } catch (err) {
    return { telemetry, userRetention: { error: String((err as Error)?.message ?? "unknown") } };
  }
}

export async function previewDataRetention(
  ctx: AppContext,
  payload: DataRetentionPayload = {},
): Promise<Record<string, unknown>> {
  const preview = { ...payload, apply: false };
  const summary = await runRetentionMainPhase(ctx, preview, false);
  Object.assign(summary, await previewRetentionSideEffects(ctx, preview));
  return summary;
}
