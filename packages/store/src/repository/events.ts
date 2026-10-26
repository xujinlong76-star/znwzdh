import type { Repository } from "../repository.ts";
import type {
  AuditLogRecord,
} from "./records.ts";
import {
  rowToAuditLog,
} from "./dialect.ts";

export async function recordEvent(repo: Repository, kind: string, payload: { siteId?: string; query?: string; categoryId?: string; identity?: string; meta?: unknown } = {}): Promise<void> {
  const metaIdentity = typeof payload.meta === "object" && payload.meta !== null
    ? (payload.meta as { identity?: unknown }).identity
    : undefined;
  const identity = payload.identity
    ?? (typeof metaIdentity === "string" ? metaIdentity : undefined)
    ?? null;
  await repo.run(
    "INSERT INTO events (kind, site_id, query, category_id, meta, identity, created_at) VALUES (?,?,?,?,?,?,?)",
    [kind, payload.siteId ?? null, payload.query ?? null, payload.categoryId ?? null,
     payload.meta === undefined ? null : JSON.stringify(payload.meta), identity, Date.now()],
  );
}

export async function audit(repo: Repository, entry: { actor: string; actorKind?: string; action: string; target?: string; diff?: unknown; ip?: string }): Promise<void> {
  try {
    await repo.run(
      "INSERT INTO audit_logs (actor, actor_kind, action, target, diff, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      [entry.actor, entry.actorKind ?? "user", entry.action, entry.target ?? null,
       entry.diff === undefined ? null : JSON.stringify(entry.diff), entry.ip ?? null, Date.now()],
    );
  } catch (err) {
    console.error("[navhub] 审计写入失败（主操作结果不受影响）:", err);
  }
}

/**
 * 按身份的访问历史（T23）：events kind=click 就是按身份的站点浏览流水，
 * 此前只有画像摘要（visitedSiteIds 50 个）在消费它——数据已在采集，
 * 这里把它作为用户自己的数据暴露出来（数据主权：看得到才谈得上清理）。
 */
export interface VisitItem {
  id: number;
  siteId: string;
  at: number;
}

export async function listVisitsPage(
  repo: Repository,
  identity: string,
  limit: number,
  offset: number,
): Promise<{ items: VisitItem[]; hasMore: boolean }> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const rows = await repo.raw(
    "SELECT id, site_id, created_at FROM events WHERE identity = ? AND kind = 'click' AND site_id IS NOT NULL ORDER BY id DESC LIMIT ? OFFSET ?",
    [identity, capped + 1, Math.max(0, offset)],
  );
  const hasMore = rows.length > capped;
  const items = (hasMore ? rows.slice(0, capped) : rows).map((r) => ({
    id: Number(r.id ?? 0),
    siteId: String(r.site_id),
    at: Number(r.created_at ?? 0),
  }));
  return { items, hasMore };
}

export async function countVisits(repo: Repository, identity: string): Promise<number> {
  const row = (
    await repo.raw("SELECT COUNT(*) AS c FROM events WHERE identity = ? AND kind = 'click' AND site_id IS NOT NULL", [identity])
  )[0];
  return Number(row?.c ?? 0);
}

export async function listAuditLogs(repo: Repository, filter: {
    limit?: number;
    offset?: number;
    action?: string;
    actor?: string;
  } = {}): Promise<{ items: AuditLogRecord[]; hasMore: boolean }> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (filter.action) { wheres.push("action = ?"); params.push(filter.action); }
  if (filter.actor) { wheres.push("actor = ?"); params.push(filter.actor); }
  const where = wheres.length ? " WHERE " + wheres.join(" AND ") : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(0, filter.offset ?? 0);
  params.push(limit + 1, offset);
  const rows = await repo.raw(
    `SELECT * FROM audit_logs${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    params,
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { items: page.map(rowToAuditLog), hasMore };
}

export async function listAuditActions(repo: Repository, limit = 50): Promise<string[]> {
  const rows = await repo.raw(
    "SELECT action, MAX(id) AS newest FROM audit_logs GROUP BY action ORDER BY newest DESC LIMIT ?",
    [limit],
  );
  return rows.map((r) => String(r.action));
}

/** copilot 事件读取窗口最多回溯的行数：管理端要的是比率，不是全表扫描 */
export const COPILOT_EVENT_READ_CAP = 5000;

/**
 * 「放弃前等待时长」分位数取样上限：只从 copilot_cancel 的 waited_ms 里取，
 * 与 COPILOT_EVENT_READ_CAP 分开，避免把整窗口的行数当成样本量。
 */
const WAIT_SAMPLE_CAP = 1000;

export interface CopilotEventSummary {
  windowDays: number;
  scanned: number;
  truncated: boolean;
  asks: number;
  cancels: number;
  /** cancels / (asks + cancels)，保留 3 位小数；无样本时为 null */
  cancelRate: number | null;
  /** 停止键落在调模型之前还是之后——pre_llm 多说明用户等不到首字 */
  cancelStage: { pre_llm: number; llm: number };
  /** 放弃前等待时长（ms），来自 copilot_cancel 的 waited_ms */
  waitMs: { p50: number | null; p95: number | null; max: number | null };
  /** 兜底应答占比（meta.degraded 非空即未经大模型） */
  degraded: number;
  degradedBy: Array<{ reason: string; count: number }>;
  quotaLimited: number;
  thinkingBy: Array<{ thinking: string; count: number }>;
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function tallyTop(counter: Map<string, number>, limit: number): Array<{ key: string; count: number }> {
  return [...counter.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/**
 * copilot 遥测的读取侧：把 events 里 kind=copilot / copilot_cancel 的两行
 * 折成管理端能直接展示的比率。meta 是 JSON 文本，跨方言（SQLite / PostgreSQL）
 * 不做 JSON 抽取，统一取回后在内存里解析——读取窗口本身已按 COPILOT_EVENT_READ_CAP 封顶。
 */
export async function copilotEventSummary(
  repo: Repository,
  days: number,
): Promise<CopilotEventSummary> {
  const windowDays = Math.min(Math.max(Math.round(days) || 1, 1), 90);
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const rows = await repo.raw(
    "SELECT kind, meta FROM events WHERE kind IN ('copilot', 'copilot_cancel') AND created_at >= ? ORDER BY id DESC LIMIT ?",
    [since, COPILOT_EVENT_READ_CAP + 1],
  );
  const truncated = rows.length > COPILOT_EVENT_READ_CAP;
  const scanned = truncated ? rows.slice(0, COPILOT_EVENT_READ_CAP) : rows;

  let asks = 0;
  let cancels = 0;
  const cancelStage = { pre_llm: 0, llm: 0 };
  let degraded = 0;
  let quotaLimited = 0;
  const degradedBy = new Map<string, number>();
  const thinkingBy = new Map<string, number>();
  const waits: number[] = [];

  for (const row of scanned) {
    const kind = String(row.kind ?? "");
    let meta: Record<string, unknown> = {};
    const rawMeta = row.meta;
    if (typeof rawMeta === "string" && rawMeta) {
      try {
        const parsed = JSON.parse(rawMeta);
        if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
      } catch {
        // 历史脏行：解析失败只说明这一行没有维度，不该让整块面板 500
      }
    } else if (rawMeta && typeof rawMeta === "object") {
      meta = rawMeta as Record<string, unknown>;
    }

    const thinking = meta.thinking == null ? "unknown" : String(meta.thinking);
    thinkingBy.set(thinking, (thinkingBy.get(thinking) ?? 0) + 1);
    if (meta.quota_limited === true) quotaLimited += 1;

    if (kind === "copilot_cancel") {
      cancels += 1;
      const stage = String(meta.stage ?? "");
      if (stage === "pre_llm" || stage === "llm") cancelStage[stage] += 1;
      const waited = Number(meta.waited_ms);
      if (Number.isFinite(waited) && waited >= 0) waits.push(waited);
      continue;
    }

    asks += 1;
    const reason = meta.degraded;
    if (reason != null && reason !== "" && reason !== "null") {
      degraded += 1;
      const key = String(reason);
      degradedBy.set(key, (degradedBy.get(key) ?? 0) + 1);
    }
  }

  const total = asks + cancels;
  waits.sort((a, b) => a - b);
  const waitSample = waits.slice(0, WAIT_SAMPLE_CAP);

  return {
    windowDays,
    scanned: scanned.length,
    truncated,
    asks,
    cancels,
    cancelRate: total > 0 ? Math.round((cancels / total) * 1000) / 1000 : null,
    cancelStage,
    waitMs: {
      p50: percentile(waitSample, 0.5),
      p95: percentile(waitSample, 0.95),
      max: waitSample.length ? (waitSample[waitSample.length - 1] ?? null) : null,
    },
    degraded,
    degradedBy: tallyTop(degradedBy, 8).map(({ key, count }) => ({ reason: key, count })),
    quotaLimited,
    thinkingBy: tallyTop(thinkingBy, 5).map(({ key, count }) => ({ thinking: key, count })),
  };
}
