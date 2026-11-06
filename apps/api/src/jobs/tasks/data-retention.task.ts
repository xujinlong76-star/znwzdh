/**
 * 数据保留与滚动归档任务（data_retention）。
 *
 * 职责：
 * 1. rollup 模式：将历史明细事件按天聚合入 daily 统计表后清理明细；
 * 2. cleanup 模式：在任务内仅支持 dry-run；
 * 3. 遥测日志清理：修剪超期 health_checks 与 llm_usage；
 * 4. 用户搜索历史自定义保留策略执行。
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

export async function previewRetentionSideEffects(
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

  let usersAffected = 0;
  let rowsDeleted = 0;
  try {
    const custom = await ctx.repo.listCustomHistoryRetention();
    const now = Date.now();
    for (const { identity, retentionDays } of custom) {
      const cutoff = now - retentionDays * 86_400_000;
      const rows = await adapter.select(
        `SELECT COUNT(*) AS count FROM search_history WHERE user_id = ${adapter.placeholder(1)} AND created_at < ${adapter.placeholder(2)}`,
        [identity, cutoff]
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
  const sideEffects = apply
    ? await applyRetentionSideEffects(ctx, payload)
    : await previewRetentionSideEffects(ctx, payload);
  Object.assign(summary, sideEffects);
  await ctx.repo.recordEvent("data_retention", { meta: summary }).catch(() => undefined);
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
