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
import { enrichUrl } from "@navhub/ai";
import { enrichLlmOf, resolveLlm } from "./llm-config.ts";
import { createEnrichUsageCallback } from "./llm-usage.ts";
import { ageInDays, trendScore, auditPageHealth, runAutonomousHealing, planPatrol, sanitizeIconUrl } from "@navhub/core";
import {
  bindSqlite,
  toPgSql,
  DEFAULT_RETENTION_TARGETS,
  DEFAULT_ROLLUP_TARGETS,
  runRetention,
  runRollup,
  type RetentionAdapter,
} from "@navhub/store";
import type { AppContext } from "./context.ts";
import { indexSite, indexSitesBatch } from "./index-site.ts";
import { indexPluginsBatch, indexItemFromManifest } from "./index-plugin.ts";

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

export type JobKind = "health_check" | "refetch_metadata" | "recompute_rank" | "reindex" | "site_self_healing" | "token_audit" | "purge_trash" | "taxonomy_audit" | "data_retention" | "plugin_governance";

export const JOB_KINDS: JobKind[] = ["health_check", "refetch_metadata", "recompute_rank", "reindex", "site_self_healing", "token_audit", "purge_trash", "taxonomy_audit", "data_retention", "plugin_governance"];

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
}

export interface JobEventPayload {
  jobId: string;
  kind: JobKind | string;
  status: "pending" | "running" | "completed" | "failed" | "retrying" | "cancelled";
  attempts?: number;
  error?: string | null;
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
  { kind: "data_retention", intervalMs: 86_400_000, payload: { mode: "rollup", apply: false, maxDays: 30 } },
];

const LOCK_KEY = "lock:job-runner";
/**
 * SQLite 持锁有效期（不是「任务预算」）：崩溃后最多等这么久，别的实例就能接管。
 * 有效期内必须由心跳续期，否则跑过 TTL 的长任务会让锁被合法夺走。
 */
const LOCK_TTL_MS = 120_000;
/** 默认心跳周期 = TTL/3：连续两次续期都失败才会过期，留出重试窗口 */
const LOCK_HEARTBEAT_DEFAULT_MS = Math.floor(LOCK_TTL_MS / 3);
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
   * 单次执行的预算（毫秒）。**当前不做任务级硬超时**：
   * 每个 handler 的每次网络/LLM 调用各自带超时（fetch 10s / LLM 20s / embedding 30s），
   * 所以真正的兜底是「所有调用都有上限」，而不是这个数。
   * 为什么不用 Promise.race 强行掐：掐不掉——handler 里没有 AbortSignal，
   * 超时只是让 Runner 提前把任务标成失败并放行下一轮，僵尸 handler 还在跑，
   * 于是同一个 kind 被两边并发执行（比重置为 retrying 更糟）。
   * 要变成硬预算，得先把 signal 贯穿 runXxx 与 @navhub/ai 的抓取/嵌入调用。
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
};

/** 标准 5 段 cron 字面量（与 DEFAULT_SCHEDULES 别名一一对应，集中存放避免块注释提前闭合） */
const CRON_EXPRS = {
  X5MIN: "\u002a/5 \u002a \u002a \u002a \u002a",
  X30MIN: "\u002a/30 \u002a \u002a \u002a \u002a",
  HOURLY: "0 \u002a \u002a \u002a \u002a",
  X4H: "0 \u002a/4 \u002a \u002a \u002a",
  DAILY3AM: "0 3 \u002a \u002a \u002a",
  DAILY4AM: "0 4 \u002a \u002a \u002a",
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
  private onAlert: JobRunnerOptions["onAlert"];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private lockHeld = false;
  /** PG advisory lock 持有期间独占的连接（解锁前不归还给池） */
  private pgClient: PgLockClient | null = null;

  constructor(ctx: AppContext, opts: JobRunnerOptions = {}) {
    this.ctx = ctx;
    this.intervalMs = opts.intervalMs ?? envInterval();
    this.maxPerTick = opts.maxPerTick ?? 10;
    this.holder = opts.holder ?? "pid-" + process.pid;
    this.enableCron = opts.enableCron ?? false;
    this.lockHeartbeatMs = opts.lockHeartbeatMs ?? LOCK_HEARTBEAT_DEFAULT_MS;
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
    this.timer = setInterval(() => void this.tick(), jitterMs);
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
        for (let i = 0; i < this.maxPerTick; i++) {
          const job = await this.ctx.repo.claimNextJob();
          if (!job) break;
          await this.process(job.kind as JobKind, job.payload, job.id, job.attempts);
          processed++;
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
      if (stolen > 0) { this.lockHeld = true; return true; }
      await this.run(
        "INSERT INTO idempotency (key, response, created_at) VALUES (?,?,?)",
        [LOCK_KEY, this.holder, now],
      );
      this.lockHeld = true;
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
   * SQLite 锁续期（tick 心跳调用）：只刷新**自己名下**的锁行。
   * 若 TTL 期间锁已被别的实例夺走，这里匹配 0 行、静默无效——不会把新持有者顶掉，
   * 于是本轮剩下的任务只是白跑，不会演变成两边互相抢锁。PG advisory 无需续期。
   */
  private async renewLock(): Promise<void> {
    if (!this.lockHeld || this.ctx.db.dialect !== "sqlite") return;
    try {
      await this.run(
        "UPDATE idempotency SET created_at = ? WHERE key = ? AND response = ?",
        [Date.now(), LOCK_KEY, this.holder],
      );
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
    try {
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
        default:
          throw new Error("未知任务类型: " + kind);
      }
      await this.ctx.repo.completeJob(jobId, null);
      jobEventBus.emitJobUpdate({
        jobId,
        kind,
        status: "completed",
        attempts,
        timestamp: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 指数退避重试：瞬时抖动（网络/磁盘）不再一击毙命。
      // attempts 来自 claimNextJob（已 +1），耗尽后落 failed 终态。
      const exhausted = attempts >= MAX_JOB_ATTEMPTS;
      const retryAt = exhausted ? null : Date.now() + backoffMs(attempts);
      await this.ctx.repo.completeJob(jobId, message, { retryAt, exhausted }).catch(() => undefined);
      jobEventBus.emitJobUpdate({
        jobId,
        kind,
        status: exhausted ? "failed" : "retrying",
        attempts,
        error: message,
        timestamp: Date.now(),
      });
      if (exhausted) {
        const detail = { kind, attempts, error: message };
        this.alert("任务 " + kind + " 连续失败 " + attempts + " 次，已停止重试：" + message, detail);
      }
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
          const audit = auditPageHealth(site!.url, res.body);
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

    const resolved = payload.llm ? await resolveLlm(this.ctx) : null;
    const enriched = await enrichUrl(site.url, {
      llm: resolved ? enrichLlmOf(resolved) : undefined,
      guard: this.ctx.config.fetch,
      heuristicOnly: !payload.llm,
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
    await this.ctx.repo.recordEvent("refetch", { siteId: site.id, meta: { provenance: enriched.provenance } }).catch(() => undefined);
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
  private async runReindex(payload: { siteId?: string; vectors?: boolean; targets?: Array<"sites" | "plugins"> }): Promise<void> {
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
    if (payload.siteId) {
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
    const purged = await this.ctx.repo.purgeExpiredDeletedSites(ms);
    await this.ctx.repo.recordEvent("purge_trash", { meta: { days, purged } }).catch(() => undefined);
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

  private async runDataRetention(payload: DataRetentionPayload = {}): Promise<void> {
    const mode = payload.mode === "cleanup" ? "cleanup" : "rollup";
    if (mode === "cleanup" && payload.apply === true) {
      throw new Error(
        "cleanup 模式在任务里只允许 dry-run：原样明细的唯一留底是归档文件，而任务没有可靠的归档落点。" +
          "要真正删除请用 CLI：node scripts/data-retention.mjs --apply（先 gzip 归档再删，删完可 --vacuum）。",
      );
    }
    const apply = payload.apply === true;
    const adapter = this.dataRetentionAdapter();
    let summary: Record<string, unknown>;

    if (mode === "rollup") {
      const res = await runRollup(adapter, {
        targets: DEFAULT_ROLLUP_TARGETS.map((t) => ({ spec: t.spec, keepDays: t.keepDays })),
        // 建聚合表时按方言分叉（AUTOINCREMENT vs BIGSERIAL）：这里的词汇是 "postgres"，
        // 与存储层的 "pg" 不同名。漏传即默认 SQLite DDL，PG 上建表直接报错、聚合永不生效。
        dialect: this.ctx.db.dialect === "pg" ? "postgres" : "sqlite",
        maxDaysPerRun: payload.maxDays ?? 30,
        maxGroupsPerDay: payload.maxGroups ?? 5000,
        dryRun: !apply,
      });
      summary = {
        mode,
        apply,
        days: res.tables.map((t) => t.days),
        groups: res.tables.reduce((s, t) => s + t.groups, 0),
        rows: res.tables.reduce((s, t) => s + t.rows, 0),
        deleted: res.tables.reduce((s, t) => s + t.deleted, 0),
        skippedDays: res.tables.reduce((s, t) => s + t.skippedDays, 0),
        truncated: res.tables.map((t) => t.truncated),
      };
    } else {
      const res = await runRetention(adapter, {
        targets: DEFAULT_RETENTION_TARGETS,
        // 任务里限量扫描：dry-run 一次扫全表会把连接占住，也看不出趋势
        maxScan: payload.maxScan ?? 200_000,
        dryRun: true,
      });
      summary = {
        mode,
        apply: false,
        reason: "cleanup 在任务里只做 dry-run，真正删除请用 CLI",
        scanned: res.tables.reduce((s, t) => s + t.scanned, 0),
      };
    }

    // 留一条行为事件：运维在事件流里能看到"这轮会动多少行 / 动了多少行"
    await this.ctx.repo.recordEvent("data_retention", { meta: summary }).catch(() => undefined);
  }

  /**
   * 用仓储层现有通道拼一个 {@link RetentionAdapter}：
   * 占位符统一 `?`（PG 侧由 `toPgSql` 转换），写操作走 `runCount` 的同等实现，
   * 两种方言都能拿到受影响行数 —— 不为它在 Repository 上加新方法。
   */
  private dataRetentionAdapter(): RetentionAdapter {
    const { db, repo } = this.ctx;
    return {
      placeholder: () => "?",
      select: (sql, params) => repo.raw(sql, [...params]),
      execute: (sql, params) => {
        if (db.dialect === "sqlite" && db.sqlite) {
          const info = db.sqlite.prepare(sql).run(...bindSqlite([...params])) as { changes?: number };
          return Promise.resolve(Number(info?.changes ?? 0));
        }
        if (db.pg) {
          return db.pg.query(toPgSql(sql), [...params]).then((r) => Number(r.rowCount ?? 0));
        }
        return Promise.reject(new Error(`数据保留任务不支持的存储方言: ${db.dialect}`));
      },
    };
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
    console.log(
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
