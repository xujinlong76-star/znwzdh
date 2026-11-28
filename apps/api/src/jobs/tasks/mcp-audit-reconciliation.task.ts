/**
 * MCP 审计/配额双写对账任务（mcp_audit_reconciliation，ADR-0010 Accepted）。
 *
 * 为什么能"精确相等校验"：egress-gates.ts 在同一次工具调用里无条件双写——
 *   bumpQuota（system_states 的 mcp:quota:*）与 repo.audit（audit_logs 的
 *   mcp.tool.call）都在各自 try 内、都不区分 allowed 结果。除写失败外，
 *   同一窗口 SUM(quota) == COUNT(audit) 严格成立，差异即漏记/故障。
 *
 * 检测边界（ADR §5，如实说）：单边写失败能抓；"双边写都失败 + 读正常"抓不到
 *   （两边停在同一基线）——那靠 egress-gates 的写失败日志告警兜底，不靠本任务。
 *
 * 挂点：JobRunner DAILY5AM（jobs.ts），maxConcurrency 1，单实例锁由 Runner 保证。
 * 告警：复用 sendWebhookAlert；claimSystemState CAS 跨实例去重；
 *   无 webhook 配置时退化写一条 audit（mcp.recon.mismatch）留痕，不静默放过。
 * 清理：对账读数与告警判定之后按 updated_at 删除 8 天前的 mcp:quota:* key。
 */
import type { AppContext } from "../../context.ts";
import { sendWebhookAlert } from "../../alerts.ts";

/** 对账窗口默认取"前一日"UTC 整天；windowMs=86_400_000 的整数倍边界。 */
const WINDOW_MS = 86_400_000;
/** 差异阈值下限（绝对值 ≤5 容偶发进程崩溃窗口，不告警） */
const MIN_DIFF = 5;
/** 差异比例阈值（1%） */
const DIFF_RATIO = 0.01;
/** quota key 保留期：对账回溯窗口 + 1 天 */
const RETAIN_MS = 8 * WINDOW_MS;
/** 连续超阈值多少天才升 P0 */
const ESCALATE_DAYS = 2;
/** 告警去重占位窗口 24h（key 已含日期，这里给 CAS 用） */
const DEDUP_WINDOW_MS = WINDOW_MS;

export interface ReconciliationResult {
  windowStart: number;
  windowEnd: number;
  quotaTotal: number;
  auditCount: number;
  diff: number;
  threshold: number;
  mismatch: boolean;
  escalated: boolean;
  alerted: boolean;
  cleanedKeys: number;
}

function defaultWindow(now: number): { start: number; end: number } {
  const todayStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  return { start: todayStart - WINDOW_MS, end: todayStart };
}

/**
 * 读 quota 侧窗口总量。key 固定格式 mcp:quota:<64hex>:<13位windowStart>，
 * 从尾部 13 位提取 windowStart 过滤。SQLite 用 substr，PG 用 RIGHT（ADR §6）。
 */
async function quotaTotal(repo: AppContext["repo"], start: number, end: number): Promise<number> {
  const sqlite = repo.db.dialect === "sqlite";
  const extract = sqlite ? "CAST(substr(key, -13) AS INTEGER)" : "RIGHT(key, 13)::bigint";
  const cast = sqlite ? "CAST(value AS INTEGER)" : "CAST(value AS BIGINT)";
  const rows = await repo.raw(
    `SELECT SUM(${cast}) AS total FROM system_states ` +
      `WHERE key LIKE 'mcp:quota:%' AND ${extract} >= ? AND ${extract} < ?`,
    [start, end],
  );
  return Number(rows[0]?.total ?? 0);
}

/** 读 audit 侧窗口计数（双方言一致）。 */
async function auditCount(repo: AppContext["repo"], start: number, end: number): Promise<number> {
  const rows = await repo.raw(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'mcp.tool.call' AND created_at >= ? AND created_at < ?",
    [start, end],
  );
  return Number(rows[0]?.n ?? 0);
}

/** 读最近 N 个对账日的超限标记，判断是否连续 escalationDays 天超阈值。 */
async function consecutiveExceeded(repo: AppContext["repo"], key: string): Promise<number> {
  const rows = await repo.raw(
    "SELECT value FROM system_states WHERE key LIKE ? ORDER BY updated_at DESC LIMIT ?",
    [key + ":%", ESCALATE_DAYS],
  );
  let streak = 0;
  for (const row of rows) {
    if (Number(row.value) === 1) streak += 1;
    else break;
  }
  return streak;
}

/** 清理过期 quota key（保留 RETAIN_MS），放在读数与告警判定之后。 */
async function cleanExpiredKeys(repo: AppContext["repo"], now: number): Promise<number> {
  const cutoff = now - RETAIN_MS;
  // runCount 对 DELETE 返回 changes（SQLite info.changes / PG rowCount），只删一次
  return repo.runCount("DELETE FROM system_states WHERE key LIKE 'mcp:quota:%' AND updated_at < ?", [cutoff]);
}

/**
 * 执行一轮对账。payload 可注入 windowStart/windowEnd（毫秒，测试造数用），
 * 不注入则取前一日 UTC 整天。
 */
export async function runMcpAuditReconciliation(
  ctx: AppContext,
  payload: { windowStart?: number; windowEnd?: number } = {},
): Promise<ReconciliationResult> {
  const now = Date.now();
  const fallback = defaultWindow(now);
  const start = payload.windowStart ?? fallback.start;
  const end = payload.windowEnd ?? fallback.end;
  const repo = ctx.repo;

  const qTotal = await quotaTotal(repo, start, end);
  const aCount = await auditCount(repo, start, end);
  const diff = Math.abs(qTotal - aCount);
  const threshold = Math.max(MIN_DIFF, Math.ceil(Math.max(qTotal, aCount) * DIFF_RATIO));
  const mismatch = diff > threshold;

  // 连续超阈值天数：把今日标记写进 system_states（key 含日期，天然多日序列）。
  const dayKey = "mcp:recon:threshold:" + new Date(start).toISOString().slice(0, 10);
  if (mismatch) {
    await repo.setSystemState(dayKey, 1);
  } else {
    await repo.setSystemState(dayKey, 0);
  }
  const streak = await consecutiveExceeded(repo, "mcp:recon:threshold");
  const escalated = mismatch && streak >= ESCALATE_DAYS;

  let alerted = false;
  if (mismatch) {
    const dedupKey = "mcp:recon:" + new Date(start).toISOString().slice(0, 10);
    const claimed = await repo.claimSystemState(dedupKey, 1, DEDUP_WINDOW_MS, now);
    if (claimed) {
      const text =
        `[MCP 对账${escalated ? " P0" : " 预警"}] 窗口 ${new Date(start).toISOString()} ~ ${new Date(end).toISOString()} ` +
        `quota=${qTotal} audit=${aCount} diff=${diff} threshold=${threshold}`;
      const detail = {
        kind: "mcp_audit_reconciliation",
        attempts: 1,
        error: escalated ? "P0: 连续超阈值" : "配额/审计计数不一致",
      };
      const url = ctx.config.alertWebhook;
      if (url) {
        alerted = await sendWebhookAlert(url, text, detail, ctx.config.alertTimeoutMs);
        if (!alerted) console.error("[navhub-mcp] 对账告警 webhook 投递失败:", { kind: detail.kind });
      } else {
        // 无 webhook：退化写 audit 留痕（fail-open 场景不静默放过）
        await repo.audit({
          actor: "system:mcp_audit_reconciliation",
          actorKind: "system",
          action: "mcp.recon.mismatch",
          target: dayKey,
          diff: { quotaTotal: qTotal, auditCount: aCount, diff, threshold, escalated },
        });
        alerted = true;
        console.error("[navhub-mcp] 对账差异（无 webhook，已写 audit 留痕）:", text);
      }
    }
  }

  // 清理放在读数与告警判定之后（ADR §7）
  const cleanedKeys = await cleanExpiredKeys(repo, now);

  return {
    windowStart: start,
    windowEnd: end,
    quotaTotal: qTotal,
    auditCount: aCount,
    diff,
    threshold,
    mismatch,
    escalated,
    alerted,
    cleanedKeys,
  };
}
