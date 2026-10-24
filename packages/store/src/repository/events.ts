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
