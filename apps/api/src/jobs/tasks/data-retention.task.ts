/**
 * 数据保留与滚动归档任务（data_retention）。
 *
 * 职责：
 * 1. rollup 模式：将历史明细事件按天聚合入 daily 统计表后清理明细；
 * 2. cleanup 模式：在任务内仅支持 dry-run；
 * 3. 遥测日志清理：修剪超期 health_checks 与 llm_usage；
 * 4. 用户搜索历史保留策略执行（U-373）：每日按各用户保留期删过期
 *    search_history + click 信号（historyCleanup 开关，独立于 apply）。
 */

import {
  DEFAULT_RETENTION_TARGETS,
  DEFAULT_ROLLUP_TARGETS,
  runRetention,
  runRollup,
  type RetentionAdapter,
} from "@navhub/store";
import type { AppContext } from "../../context.ts";
import type { DataRetentionPayload, JobRunHandle } from "../../jobs.ts";

export function createRetentionAdapter(ctx: AppContext): RetentionAdapter {
  const db = ctx.db;
  const isPg = db.dialect === "pg";
  return {
    placeholder: (i: number) => (isPg ? "$" + i : "?"),
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

export async function runRetentionMainPhase(
  ctx: AppContext,
  payload: DataRetentionPayload,
  apply: boolean
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

export async function previewTelemetry(
  ctx: AppContext,
  payload: DataRetentionPayload
): Promise<Record<string, unknown>> {
  const adapter = createRetentionAdapter(ctx);
  const telemetryDays = Math.max(1, payload.telemetryDays ?? 90);
  const since = Date.now() - telemetryDays * 86_400_000;
  const health = await adapter.select(
    `SELECT COUNT(*) AS count FROM health_checks WHERE checked_at < ${adapter.placeholder(1)}`,
    [since]
  );
  const usage = await adapter.select(
    `SELECT COUNT(*) AS count FROM llm_usage WHERE created_at < ${adapter.placeholder(1)}`,
    [since]
  );
  return {
    telemetry: {
      days: telemetryDays,
      healthChecks: Number(health[0]?.count ?? 0),
      llmUsage: Number(usage[0]?.count ?? 0),
    },
  };
}

export interface HistoryRetentionCleanupSummary {
  /** 本轮实际处理的用户数（上限内） */
  usersProcessed: number;
  /** 删掉 ≥1 条的用户数 */
  usersAffected: number;
  /** 删掉的过期搜索历史行数 */
  historyDeleted: number;
  /** 删掉的过期 click 信号行数 */
  clicksDeleted: number;
  /** 是否因达到单轮用户上限或被要求停手而提前收尾（剩余用户留待下一轮） */
  truncated: boolean;
  /** 本轮未处理的用户数（0 = 全部处理完） */
  remaining: number;
  /** 单个用户失败的记录（有且仅有失败时出现；失败用户留待下一轮） */
  errors?: Array<{ identity: string; error: string }>;
}

const HISTORY_CLEANUP_BATCH_SIZE = 100;
const HISTORY_CLEANUP_DEFAULT_MAX_USERS = 500;

/**
 * 每日自动清理（U-373）：按各用户保留期删过期搜索历史 + click 信号。
 *
 * 分批限流：策略表按 identity 排序、每批 100 用户；单轮最多处理
 * historyMaxUsers 个用户（默认 500），超限或被要求停手时 truncated=true、
 * 剩余用户留待下一轮——不阻塞主流程、不一次扫全库。
 * 单个用户失败不中断整轮：记下错误继续处理下一个用户，汇总里如实上报。
 */
export async function applyHistoryRetentionCleanup(
  ctx: AppContext,
  payload: DataRetentionPayload,
  run?: JobRunHandle
): Promise<HistoryRetentionCleanupSummary> {
  const policies = await ctx.repo.listHistoryRetentionPolicies();
  const maxUsers = Math.max(1, Math.trunc(payload.historyMaxUsers ?? HISTORY_CLEANUP_DEFAULT_MAX_USERS));
  const scoped = policies.slice(0, maxUsers);
  const summary: HistoryRetentionCleanupSummary = {
    usersProcessed: 0,
    usersAffected: 0,
    historyDeleted: 0,
    clicksDeleted: 0,
    truncated: policies.length > maxUsers,
    remaining: policies.length,
  };
  const now = Date.now();
  const errors: Array<{ identity: string; error: string }> = [];
  for (let i = 0; i < scoped.length; i += HISTORY_CLEANUP_BATCH_SIZE) {
    if (run?.shouldStop()) {
      summary.truncated = true;
      break;
    }
    for (const policy of scoped.slice(i, i + HISTORY_CLEANUP_BATCH_SIZE)) {
      try {
        const cleaned = await ctx.repo.cleanupExpiredUserHistory(policy.identity, {
          retentionDays: policy.retentionDays,
          now,
          actor: "system:data_retention",
          actorKind: "system",
        });
        summary.usersProcessed += 1;
        if (cleaned.historyDeleted + cleaned.clicksDeleted > 0) {
          summary.usersAffected += 1;
          summary.historyDeleted += cleaned.historyDeleted;
          summary.clicksDeleted += cleaned.clicksDeleted;
        }
      } catch (err) {
        // 单个用户失败（坏设置、瞬时写失败）不中断整轮：汇总里如实上报；
        // 不计入 usersProcessed——它仍算 remaining，留待下一轮重试。
        errors.push({ identity: policy.identity, error: String((err as Error)?.message ?? "unknown") });
      }
    }
  }
  summary.remaining = policies.length - summary.usersProcessed;
  if (errors.length > 0) summary.errors = errors;
  return summary;
}

/** 预演口径与 applyHistoryRetentionCleanup 一致：全量策略 + click 计数，只统计不删 */
export async function previewHistoryRetentionCleanup(
  ctx: AppContext,
): Promise<{ usersAffected: number; rowsDeleted: number; clicksDeleted: number }> {
  const adapter = createRetentionAdapter(ctx);
  const policies = await ctx.repo.listHistoryRetentionPolicies();
  const now = Date.now();
  let usersAffected = 0;
  let rowsDeleted = 0;
  let clicksDeleted = 0;
  for (const { identity, retentionDays } of policies) {
    const cutoff = now - retentionDays * 86_400_000;
    const history = await adapter.select(
      `SELECT COUNT(*) AS count FROM search_history WHERE user_id = ${adapter.placeholder(1)} AND created_at < ${adapter.placeholder(2)}`,
      [identity, cutoff]
    );
    const clicks = await adapter.select(
      `SELECT COUNT(*) AS count FROM events WHERE identity = ${adapter.placeholder(1)} AND kind = 'click' AND created_at < ${adapter.placeholder(2)}`,
      [identity, cutoff]
    );
    const h = Number(history[0]?.count ?? 0);
    const c = Number(clicks[0]?.count ?? 0);
    if (h + c > 0) {
      usersAffected += 1;
      rowsDeleted += h;
      clicksDeleted += c;
    }
  }
  return { usersAffected, rowsDeleted, clicksDeleted };
}

export async function previewRetentionSideEffects(
  ctx: AppContext,
  payload: DataRetentionPayload
): Promise<Record<string, unknown>> {
  const telemetry = await previewTelemetry(ctx, payload);
  const userRetention = await previewHistoryRetentionCleanup(ctx).catch((err) => ({
    error: String((err as Error)?.message ?? "unknown"),
  }));
  return { ...telemetry, userRetention };
}

export async function applyRetentionSideEffects(
  ctx: AppContext,
  payload: DataRetentionPayload
): Promise<Record<string, unknown>> {
  const telemetryDays = Math.max(1, payload.telemetryDays ?? 90);
  const since = Date.now() - telemetryDays * 86_400_000;
  const telemetry = {
    days: telemetryDays,
    healthChecks: await ctx.repo.pruneHealthChecks(since),
    llmUsage: await ctx.repo.pruneLlmUsage(since),
  };
  const userRetention = await applyHistoryRetentionCleanup(ctx, payload);
  return { telemetry, userRetention };
}

export async function handleDataRetention(
  ctx: AppContext,
  payload: DataRetentionPayload = {},
  run: JobRunHandle
): Promise<void> {
  if (run.shouldStop()) {
    console.info("[navhub-job] data_retention 执行前已被要求停手，未做任何聚合/清理", { jobId: run.jobId });
    return;
  }
  const mode = payload.mode === "cleanup" ? "cleanup" : "rollup";
  if (mode === "cleanup" && payload.apply === true) {
    throw new Error(
      "cleanup 模式在任务里只允许 dry-run：原样明细的唯一留底是归档文件，而任务没有可靠的归档落点。" +
        "要真正删除请用 CLI：node scripts/data-retention.mjs --apply（先 gzip 归档再删，删完可 --vacuum）。"
    );
  }
  const apply = payload.apply === true;
  const summary = await runRetentionMainPhase(ctx, payload, apply);
  // U-373：historyCleanup 是独立于 apply 的开关——定时调度每天带它跑，
  // 只删「各用户保留期外」的搜索历史与 click 信号；rollup/cleanup 的
  // 明细删除仍由 apply 把关（apply:false 时只预演）。historyCleanup 与
  // apply 同时为 true 时历史清理只走前一条路，不重复删。
  const sideEffects =
    payload.historyCleanup === true
      ? {
          ...(await previewTelemetry(ctx, payload)),
          userRetention: await applyHistoryRetentionCleanup(ctx, payload, run),
        }
      : apply
        ? await applyRetentionSideEffects(ctx, payload)
        : await previewRetentionSideEffects(ctx, payload);
  Object.assign(summary, sideEffects);
  await ctx.repo.recordEvent("data_retention", { meta: summary }).catch(() => {
    // 审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。
  });
}

export async function previewDataRetention(
  ctx: AppContext,
  payload: DataRetentionPayload = {}
): Promise<Record<string, unknown>> {
  const preview = { ...payload, apply: false };
  const summary = await runRetentionMainPhase(ctx, preview, false);
  Object.assign(summary, await previewRetentionSideEffects(ctx, preview));
  return summary;
}
