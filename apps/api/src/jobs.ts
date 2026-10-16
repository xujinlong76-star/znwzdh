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
import { ageInDays, trendScore, auditPageHealth, runAutonomousHealing, planPatrol } from "@navhub/core";
import type { AppContext } from "./context.ts";
import { indexSite } from "./index-site.ts";

export type JobKind = "health_check" | "refetch_metadata" | "recompute_rank" | "reindex" | "site_self_healing" | "token_audit" | "purge_trash";

export const JOB_KINDS: JobKind[] = ["health_check", "refetch_metadata", "recompute_rank", "reindex", "site_self_healing", "token_audit", "purge_trash"];

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
];

const LOCK_KEY = "lock:job-runner";
const LOCK_TTL_MS = 120_000;
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
  /** 连续失败告警阈值（达到后 log.error 一次；测试可注入回调收集） */
  onAlert?: (message: string, detail: { kind: string; attempts: number; error: string }) => void;
}

export class JobRunner {
  private ctx: AppContext;
  private intervalMs: number;
  private maxPerTick: number;
  private holder: string;
  private enableCron: boolean;
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

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 手动跑一轮（测试 / 管理端点用） */
  async tick(): Promise<{ processed: number; skipped: boolean }> {
    if (this.ticking) return { processed: 0, skipped: true };
    this.ticking = true;
    try {
      const locked = await this.acquireLock();
      if (!locked) return { processed: 0, skipped: true };
      let processed = 0;
      try {
        if (this.enableCron) {
          await this.checkRecurringSchedules().catch(() => undefined);
        }
        for (let i = 0; i < this.maxPerTick; i++) {
          const job = await this.ctx.repo.claimNextJob();
          if (!job) break;
          await this.process(job.kind as JobKind, job.payload, job.id, job.attempts);
          processed++;
          // 长任务续期：SQLite 锁靠 TTL，逐个任务刷新持有时间，
          // 避免一轮跑太久（慢网络 health_check）被其它实例判定过期夺走。
          await this.renewLock();
        }
      } finally {
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

  /** SQLite 锁续期：刷新持有时间，防止长任务被判过期夺走；PG advisory 无需续期 */
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
    const alive = pool.filter((s): s is NonNullable<typeof s> => Boolean(s));
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
    const found = payload.siteId ? [await this.ctx.repo.getSite(payload.siteId)] : await this.patrolTargets(limit);
    const targets = found.filter((s): s is NonNullable<typeof s> => Boolean(s));
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
        await this.ctx.repo.updateSiteHealth(site!.id, {
          httpStatus: res.status,
          ok: healthy,
          latencyMs: Date.now() - t0,
          redirectTo: res.redirects?.at(-1) ?? null,
          error: reason,
          currentStatus: site!.status,
        });
      } catch (err) {

        await this.ctx.repo.updateSiteHealth(site!.id, {
          httpStatus: null,
          ok: false,
          latencyMs: Date.now() - t0,
          redirectTo: null,
          error: err instanceof Error ? err.message : String(err),
          currentStatus: site!.status,
        });
      }
    }
    await this.ctx.repo.recordEvent("health_check", { meta: { checked: targets.length, ok } }).catch(() => undefined);
  }

  /** 元数据刷新：默认只用启发式（不烧 LLM）；payload.llm=true 才走 LLM */
  private async runRefetch(payload: { siteId?: string; llm?: boolean }): Promise<void> {
    if (!payload.siteId) throw new Error("refetch_metadata 需要 siteId");
    const site = await this.ctx.repo.getSite(payload.siteId);
    if (!site) throw new Error("站点不存在: " + payload.siteId);

    const enriched = await enrichUrl(site.url, {
      llm: payload.llm ? this.ctx.config.llm : undefined,
      guard: this.ctx.config.fetch,
      heuristicOnly: !payload.llm,
    });
    // 只覆盖「空值或超期（>30 天）字段」——刷新不该把人工精修的内容冲掉
    const stale = 30 * 86_400_000;
    const isStale = (updatedAt: number | undefined) => !updatedAt || Date.now() - updatedAt > stale;
    const patch: Record<string, unknown> = {};
    if (!site.description && enriched.description) patch.description = enriched.description;
    if (!site.title && enriched.title) patch.title = enriched.title;
    if (!site.iconKey && enriched.iconUrl) patch.iconKey = enriched.iconUrl;
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
    const [clicks, favorites, sites] = await Promise.all([
      this.ctx.repo.clickCountsSince(since7d),
      this.ctx.repo.favoriteCountsSince(since7d),
      this.ctx.repo.listSites(),
    ]);
    const scores = sites.map((s) => ({
      id: s.id,
      trendScore: trendScore({
        visits7d: clicks.get(s.id) ?? 0,
        favorites7d: favorites.get(s.id) ?? 0,
        ageDays: ageInDays(s.createdAt, now),
      }, now),
    }));
    await this.ctx.repo.setTrendScores(scores);
    await this.ctx.repo.recordEvent("recompute_rank", { meta: { sites: scores.length } }).catch(() => undefined);
  }

  /** 重建索引：siteId 指定单个；否则全站。vectors=false 只重建拼音/FTS（快） */
  private async runReindex(payload: { siteId?: string; vectors?: boolean }): Promise<void> {
    const found = payload.siteId ? [await this.ctx.repo.getSite(payload.siteId)] : await this.ctx.repo.listSites();
    const sites = found.filter((s): s is NonNullable<typeof s> => Boolean(s));
    let count = 0;
    for (const site of sites) {
      // updateSite 会用当前标题/描述/标签重算 fts_tokens 与拼音（写入期预计算）
      await this.ctx.repo.updateSite(site.id, {
        title: site.title,
        description: site.description ?? null,
      });
      if (payload.vectors !== false) {
        await indexSite(this.ctx, site.id, site.title, site.description ?? null, site.url);
      }
      count++;
    }
    await this.ctx.repo.recordEvent("reindex", { meta: { sites: count, vectors: payload.vectors !== false } }).catch(() => undefined);
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

  /* --------------------------- 底层执行 --------------------------- */

  private async run(sqlText: string, params: unknown[]): Promise<void> {
    const db = this.ctx.db;
    if (db.dialect === "sqlite") {
      db.sqlite!.prepare(sqlText).run(...params);
      return;
    }
    await db.pg!.query(sqlText, params);
  }

  private async runCount(sqlText: string, params: unknown[]): Promise<number> {
    const db = this.ctx.db;
    if (db.dialect === "sqlite") {
      const info = db.sqlite!.prepare(sqlText).run(...params) as { changes?: number };
      return Number(info?.changes ?? 0);
    }
    const res = await db.pg!.query(sqlText, params);
    return Number(res.rowCount ?? 0);
  }
}
