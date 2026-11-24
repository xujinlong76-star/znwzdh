import { randomUUID } from "node:crypto";
import type { Repository } from "../repository.ts";

export type CrawlSourceKind = "sitemap" | "rss" | "page";
export interface CrawlSource {
  id: string; url: string; canonicalUrl: string; kind: CrawlSourceKind;
  enabled: boolean; priority: number; intervalMs: number; nextRunAt: number;
  lastRunAt: number | null; lastStatus: string | null; lastError: string | null; consecutiveFailures: number;
  leaseOwner: string | null; leaseExpiresAt: number | null;
  createdAt: number; updatedAt: number;
}
export interface UpsertCrawlSourceInput {
  url: string; kind: CrawlSourceKind; enabled?: boolean; priority?: number;
  intervalMs?: number; nextRunAt?: number;
}
function normalizeSourceUrl(input: string): { url: string; host: string } {
  let parsed: URL;
  try { parsed = new URL(input); } catch { throw new TypeError("采集来源 URL 无效"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
    throw new TypeError("采集来源仅允许不含凭据的 HTTP(S) URL");
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) parsed.port = "";
  const url = parsed.toString();
  if (url.length > 2048) throw new RangeError("采集来源 URL 超过 2048 字符");
  return { url, host: parsed.hostname };
}
function mapSource(row: Record<string, unknown>): CrawlSource {
  return {
    id: String(row.id), url: String(row.url), canonicalUrl: String(row.canonical_url),
    kind: String(row.kind) as CrawlSourceKind, enabled: Boolean(row.enabled),
    priority: Number(row.priority), intervalMs: Number(row.interval_ms), nextRunAt: Number(row.next_run_at),
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    lastStatus: row.last_status == null ? null : String(row.last_status),
    lastError: row.last_error == null ? null : String(row.last_error),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}
export async function upsertCrawlSource(repo: Repository, input: UpsertCrawlSourceInput, now = Date.now()): Promise<CrawlSource> {
  const normalized = normalizeSourceUrl(input.url);
  if (!["sitemap", "rss", "page"].includes(input.kind)) throw new TypeError("采集来源类型无效");
  const intervalMs = Math.max(5 * 60_000, Math.min(30 * 24 * 60 * 60_000, Math.floor(input.intervalMs ?? 30 * 60_000)));
  const priority = Math.max(-100, Math.min(100, Math.floor(input.priority ?? 0)));
  const id = randomUUID();
  await repo.run(
    `INSERT INTO crawl_sources (id,url,canonical_url,kind,enabled,priority,interval_ms,next_run_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(canonical_url) DO UPDATE SET url=excluded.url,kind=excluded.kind,
       enabled=excluded.enabled,priority=excluded.priority,interval_ms=excluded.interval_ms,
       next_run_at=excluded.next_run_at,updated_at=excluded.updated_at`,
    [id, normalized.url, normalized.url, input.kind, input.enabled ?? true, priority, intervalMs,
      Math.max(0, Math.floor(input.nextRunAt ?? now)), now, now],
  );
  const rows = await repo.raw("SELECT * FROM crawl_sources WHERE canonical_url = ? LIMIT 1", [normalized.url]);
  if (!rows[0]) throw new Error("采集来源保存后无法读取");
  return mapSource(rows[0]);
}
export async function listCrawlSources(repo: Repository, options: { enabled?: boolean; limit?: number; offset?: number } = {}): Promise<CrawlSource[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 100)));
  const offset = Math.max(0, Math.min(100_000, Math.floor(options.offset ?? 0)));
  const rows = options.enabled === undefined
    ? await repo.raw("SELECT * FROM crawl_sources ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?", [limit, offset])
    : await repo.raw("SELECT * FROM crawl_sources WHERE enabled = ? ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?", [options.enabled, limit, offset]);
  return rows.map(mapSource);
}
export async function updateCrawlSource(repo: Repository, id: string, patch: Partial<Omit<UpsertCrawlSourceInput,"url">> & { url?: string }, now = Date.now()): Promise<CrawlSource | null> {
  const existing = (await repo.raw("SELECT * FROM crawl_sources WHERE id = ? LIMIT 1", [id]))[0];
  if (!existing) return null;
  const current = mapSource(existing);
  const normalized = patch.url === undefined ? { url: current.url } : normalizeSourceUrl(patch.url);
  const kind = patch.kind ?? current.kind;
  if (!["sitemap", "rss", "page"].includes(kind)) throw new TypeError("采集来源类型无效");
  const intervalMs = patch.intervalMs === undefined ? current.intervalMs : Math.max(5*60_000, Math.min(30*24*60*60_000, Math.floor(patch.intervalMs)));
  const priority = patch.priority === undefined ? current.priority : Math.max(-100, Math.min(100, Math.floor(patch.priority)));
  await repo.run(
    `UPDATE crawl_sources SET url=?,canonical_url=?,kind=?,enabled=?,priority=?,interval_ms=?,next_run_at=?,updated_at=? WHERE id=?`,
    [normalized.url, normalized.url, kind, patch.enabled ?? current.enabled, priority, intervalMs,
      patch.nextRunAt === undefined ? current.nextRunAt : Math.max(0, Math.floor(patch.nextRunAt)), now, id],
  );
  const rows = await repo.raw("SELECT * FROM crawl_sources WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? mapSource(rows[0]) : null;
}
export async function deleteCrawlSource(repo: Repository, id: string): Promise<boolean> {
  return (await repo.runCount("DELETE FROM crawl_sources WHERE id = ?", [id])) > 0;
}
/** 原子认领到期来源；租约避免多个 API/Worker 实例重复调度同一来源。 */
export async function claimDueCrawlSources(repo: Repository, workerId: string, options: { now?: number; limit?: number; leaseMs?: number } = {}): Promise<CrawlSource[]> {
  const owner = workerId.trim().slice(0, 120);
  if (!owner) throw new TypeError("workerId 不能为空");
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 10)));
  const leaseMs = Math.max(30_000, Math.min(30*60_000, Math.floor(options.leaseMs ?? 120_000)));
  return repo.withTransaction(async () => {
    const lock = repo.db.dialect === "pg" ? " FOR UPDATE SKIP LOCKED" : "";
    const rows = await repo.raw(
      `SELECT * FROM crawl_sources WHERE enabled = TRUE AND next_run_at <= ?
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
       ORDER BY priority DESC,next_run_at ASC,created_at ASC LIMIT ?${lock}`,
      [now, now, limit],
    );
    const claimed: CrawlSource[] = [];
    for (const row of rows) {
      const updated = await repo.raw(
        "UPDATE crawl_sources SET lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=? AND enabled=TRUE AND (lease_expires_at IS NULL OR lease_expires_at <= ?) RETURNING *",
        [owner, now + leaseMs, now, String(row.id), now],
      );
      if (updated[0]) claimed.push(mapSource(updated[0]));
    }
    return claimed;
  });
}
/**
 * 数据库级域名租约：跨 API/Worker 实例限制同一 host 的并发抓取。
 * crawl_domain_state 由 durable_crawl_governance 迁移创建。
 */
export async function claimCrawlDomain(
  repo: Repository,
  hostInput: string,
  sourceId: string,
  options: { now?: number; leaseMs?: number } = {},
): Promise<boolean> {
  const host = hostInput.trim().toLowerCase();
  if (!host || host.length > 253) throw new TypeError("采集域名无效");
  const now = options.now ?? Date.now();
  const leaseMs = Math.max(10_000, Math.min(5 * 60_000, Math.floor(options.leaseMs ?? 60_000)));
  return repo.withTransaction(async () => {
    await repo.run(
      "INSERT INTO crawl_domain_state (host,next_allowed_at,lease_task_id,lease_expires_at,updated_at) VALUES (?,0,NULL,NULL,?) ON CONFLICT(host) DO NOTHING",
      [host, now],
    );
    const rows = await repo.raw(
      "UPDATE crawl_domain_state SET lease_task_id=?,lease_expires_at=?,updated_at=? WHERE host=? AND next_allowed_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) RETURNING host",
      [sourceId, now + leaseMs, now, host, now, now],
    );
    return rows.length > 0;
  });
}

/** 释放域名租约，并为下一次请求保留最小间隔。 */
export async function releaseCrawlDomain(
  repo: Repository,
  hostInput: string,
  sourceId: string,
  options: { now?: number; minIntervalMs?: number } = {},
): Promise<boolean> {
  const host = hostInput.trim().toLowerCase();
  const now = options.now ?? Date.now();
  const minIntervalMs = Math.max(0, Math.min(10 * 60_000, Math.floor(options.minIntervalMs ?? 15_000)));
  const rows = await repo.raw(
    "UPDATE crawl_domain_state SET next_allowed_at=CASE WHEN next_allowed_at<? THEN ? ELSE next_allowed_at END,lease_task_id=NULL,lease_expires_at=NULL,updated_at=? WHERE host=? AND lease_task_id=? RETURNING host",
    [now + minIntervalMs, now + minIntervalMs, now, host, sourceId],
  );
  return rows.length > 0;
}

/** 域名繁忙时延后来源，不记作抓取失败，也不增加失败退避计数。 */
export async function deferCrawlSource(
  repo: Repository,
  input: { id: string; workerId: string; now?: number; delayMs?: number },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const delayMs = Math.max(1_000, Math.min(10 * 60_000, Math.floor(input.delayMs ?? 15_000)));
  const rows = await repo.raw(
    "UPDATE crawl_sources SET next_run_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=? AND lease_expires_at>? RETURNING id",
    [now + delayMs, now, input.id, input.workerId, now],
  );
  return rows.length > 0;
}

export async function settleCrawlSource(repo: Repository, input: { id: string; workerId: string; status: string; error?: string | null; now?: number }): Promise<boolean> {
  const now = input.now ?? Date.now();
  const rows = await repo.raw(
    `UPDATE crawl_sources
        SET last_run_at=?, last_status=?, last_error=?,
            consecutive_failures=CASE WHEN ?='error' THEN consecutive_failures+1 ELSE 0 END,
            next_run_at=CASE WHEN enabled=TRUE THEN ? + CASE
              WHEN ?='error' THEN CASE
                WHEN consecutive_failures >= 9 THEN 86400000
                ELSE 300000 * (1 << consecutive_failures)
              END
              ELSE interval_ms
            END ELSE next_run_at END,
            lease_owner=NULL, lease_expires_at=NULL, updated_at=?
      WHERE id=? AND lease_owner=? AND lease_expires_at>? RETURNING id`,
    [now, input.status.slice(0, 40), input.error?.slice(0, 2000) ?? null,
      input.status, now, input.status, now, input.id, input.workerId, now],
  );
  return rows.length > 0;
}
