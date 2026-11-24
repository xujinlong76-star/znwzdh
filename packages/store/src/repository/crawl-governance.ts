import { randomUUID } from "node:crypto";
import type { Repository } from "../repository.ts";
import { normalizeCrawlHost } from "@navhub/core";

export type CrawlTaskStatus = "queued" | "leased" | "retry" | "done" | "dead_letter" | "hold_for_review";

export interface CrawlTask {
  id: string;
  url: string;
  canonicalUrl: string;
  host: string;
  source: string;
  status: CrawlTaskStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  nextRunAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EnqueueCrawlTaskInput {
  url: string;
  source: string;
  priority?: number;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
  /** 仅可信的周期性来源可重开 done 任务；死信/人工挂起不会被复活。 */
  requeueCompleted?: boolean;
  now?: number;
}

export interface CrawlFingerprintInput {
  canonicalUrl: string;
  contentHash: string;
  simhash64: string;
  language?: string | null;
  siteId?: string | null;
  fetchedAt?: number;
}

function canonicalizeCrawlUrl(input: string): { url: string; host: string } {
  let parsed: URL;
  try { parsed = new URL(input); } catch { throw new TypeError("采集 URL 无效"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError("仅允许 HTTP(S) 采集 URL");
  if (parsed.username || parsed.password || !parsed.hostname) throw new TypeError("采集 URL 不得包含账号密码");
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) parsed.port = "";
  return { url: parsed.toString(), host: normalizeCrawlHost(parsed.hostname) };
}

function rowToCrawlTask(row: Record<string, unknown>): CrawlTask {
  return {
    id: String(row.id), url: String(row.url), canonicalUrl: String(row.canonical_url),
    host: String(row.host), source: String(row.source), status: String(row.status) as CrawlTaskStatus,
    priority: Number(row.priority ?? 0), attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 6), nextRunAt: Number(row.next_run_at ?? 0),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

/** URL 幂等入队；已审核/死信任务不会被重复发现自动复活。 */
export async function enqueueCrawlTask(repo: Repository, input: EnqueueCrawlTaskInput): Promise<CrawlTask> {
  const normalized = canonicalizeCrawlUrl(input.url);
  const source = input.source.trim().slice(0, 120);
  if (!source) throw new TypeError("采集来源不能为空");
  if (normalized.url.length > 2048) throw new RangeError("采集 URL 超过 2048 字符");
  const payloadJson = input.payload ? JSON.stringify(input.payload) : null;
  if (payloadJson && payloadJson.length > 16_384) throw new RangeError("采集任务 payload 超过 16 KiB");
  const now = input.now ?? Date.now();
  const id = randomUUID();
  const priority = Math.max(-100, Math.min(100, Math.floor(input.priority ?? 0)));
  const maxAttempts = Math.max(1, Math.min(20, Math.floor(input.maxAttempts ?? 6)));
  await repo.run(
    `INSERT INTO crawl_tasks
      (id, url, canonical_url, host, source, payload_json, status, priority, attempts, max_attempts,
       next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?)
     ON CONFLICT(canonical_url) DO UPDATE SET
       status = CASE WHEN ? = 1 AND crawl_tasks.status = 'done' THEN 'queued' ELSE crawl_tasks.status END,
       attempts = CASE WHEN ? = 1 AND crawl_tasks.status = 'done' THEN 0 ELSE crawl_tasks.attempts END,
       next_run_at = CASE WHEN ? = 1 AND crawl_tasks.status = 'done' THEN excluded.next_run_at ELSE crawl_tasks.next_run_at END,
       url = CASE WHEN crawl_tasks.status IN ('queued','retry') OR (? = 1 AND crawl_tasks.status = 'done') THEN excluded.url ELSE crawl_tasks.url END,
       source = CASE WHEN crawl_tasks.status IN ('queued','retry') OR (? = 1 AND crawl_tasks.status = 'done') THEN excluded.source ELSE crawl_tasks.source END,
       priority = CASE WHEN crawl_tasks.status IN ('queued','retry') OR (? = 1 AND crawl_tasks.status = 'done') THEN CASE WHEN crawl_tasks.priority > excluded.priority THEN crawl_tasks.priority ELSE excluded.priority END ELSE crawl_tasks.priority END,
       payload_json = CASE WHEN crawl_tasks.status IN ('queued','retry') OR (? = 1 AND crawl_tasks.status = 'done') THEN excluded.payload_json ELSE crawl_tasks.payload_json END,
       updated_at = excluded.updated_at`,
    [id, normalized.url, normalized.url, normalized.host, source,
      payloadJson, priority, maxAttempts, now, now, now,
      ...Array(7).fill(input.requeueCompleted ? 1 : 0)],
  );
  const rows = await repo.raw("SELECT * FROM crawl_tasks WHERE canonical_url = ? LIMIT 1", [normalized.url]);
  if (!rows[0]) throw new Error("采集任务入队后无法读取");
  return rowToCrawlTask(rows[0]);
}

/**
 * 跨实例原子认领。PG 使用 SKIP LOCKED + host 行锁；SQLite 在 Repository 事务写锁内串行。
 * 同域名只允许一个有效租约，且每次启动后强制保留 minDomainIntervalMs 间隔。
 */
export async function claimCrawlTask(
  repo: Repository,
  workerId: string,
  options: { leaseMs?: number; minDomainIntervalMs?: number; now?: number; scanLimit?: number } = {},
): Promise<CrawlTask | null> {
  const owner = workerId.trim().slice(0, 120);
  if (!owner) throw new TypeError("workerId 不能为空");
  const now = options.now ?? Date.now();
  const leaseMs = Math.max(5_000, Math.min(30 * 60_000, Math.floor(options.leaseMs ?? 120_000)));
  const minInterval = Math.max(0, Math.min(24 * 60 * 60_000, Math.floor(options.minDomainIntervalMs ?? 30_000)));
  const scanLimit = Math.max(1, Math.min(100, Math.floor(options.scanLimit ?? 25)));

  return repo.withTransaction(async () => {
    const lock = repo.db.dialect === "pg" ? " FOR UPDATE SKIP LOCKED" : "";
    const candidates = await repo.raw(
      `SELECT * FROM crawl_tasks
        WHERE status IN ('queued','retry') AND next_run_at <= ?
        ORDER BY priority DESC, next_run_at ASC, created_at ASC
        LIMIT ?${lock}`,
      [now, scanLimit],
    );
    // 多候选跨域名时，所有事务按 host 字典序拿域名行锁，避免 A→B / B→A 死锁。
    const domainByHost = new Map<string, Record<string, unknown>>();
    const hosts = [...new Set(candidates.map((row) => String(row.host)))].sort();
    for (const host of hosts) {
      await repo.run(
        "INSERT INTO crawl_domain_state (host, next_allowed_at, lease_task_id, lease_expires_at, updated_at) VALUES (?, 0, NULL, NULL, ?) ON CONFLICT(host) DO NOTHING",
        [host, now],
      );
      const domainLock = repo.db.dialect === "pg" ? " FOR UPDATE" : "";
      const domainRows = await repo.raw(
        "SELECT * FROM crawl_domain_state WHERE host = ? LIMIT 1" + domainLock,
        [host],
      );
      if (domainRows[0]) domainByHost.set(host, domainRows[0]);
    }
    for (const candidate of candidates) {
      const host = String(candidate.host);
      const domain = domainByHost.get(host);
      if (!domain) continue;
      if (Number(domain.next_allowed_at ?? 0) > now) continue;
      if (domain.lease_task_id && Number(domain.lease_expires_at ?? 0) > now) continue;

      const id = String(candidate.id);
      const expiresAt = now + leaseMs;
      const claimed = await repo.raw(
        "UPDATE crawl_tasks SET status = 'leased', attempts = attempts + 1, lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status IN ('queued','retry') RETURNING *",
        [owner, expiresAt, now, id],
      );
      if (!claimed[0]) continue;
      await repo.run(
        "UPDATE crawl_domain_state SET next_allowed_at = ?, lease_task_id = ?, lease_expires_at = ?, updated_at = ? WHERE host = ?",
        [now + minInterval, id, expiresAt, now, host],
      );
      return rowToCrawlTask(claimed[0]);
    }
    return null;
  });
}

/** 仅租约持有者可结算，迟到 Worker 不能覆盖重领任务。 */
export async function settleCrawlTask(
  repo: Repository,
  input: {
    id: string;
    workerId: string;
    outcome: "done" | "retry" | "dead_letter" | "hold_for_review";
    error?: string | null;
    nextRunAt?: number | null;
    now?: number;
  },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  return repo.withTransaction(async () => {
    const rows = await repo.raw(
      "UPDATE crawl_tasks SET status = ?, last_error = ?, next_run_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'leased' AND lease_owner = ? AND lease_expires_at > ? RETURNING host",
      [input.outcome, input.error?.slice(0, 2000) ?? null,
        input.outcome === "retry" ? Math.max(now, input.nextRunAt ?? now) : 0,
        now, input.id, input.workerId, now],
    );
    if (!rows[0]) return false;
    await repo.run(
      "UPDATE crawl_domain_state SET lease_task_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE host = ? AND lease_task_id = ?",
      [now, String(rows[0].host), input.id],
    );
    return true;
  });
}

/** 续租同样采用 owner + 状态 CAS，避免失去租约的旧 Worker 续活。 */
export async function renewCrawlLease(
  repo: Repository,
  input: { id: string; workerId: string; leaseMs?: number; now?: number },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const expiresAt = now + Math.max(5_000, Math.min(30 * 60_000, Math.floor(input.leaseMs ?? 120_000)));
  return repo.withTransaction(async () => {
    const rows = await repo.raw(
      "UPDATE crawl_tasks SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'leased' AND lease_owner = ? AND lease_expires_at > ? RETURNING host",
      [expiresAt, now, input.id, input.workerId, now],
    );
    if (!rows[0]) return false;
    await repo.run(
      "UPDATE crawl_domain_state SET lease_expires_at = ?, updated_at = ? WHERE host = ? AND lease_task_id = ?",
      [expiresAt, now, String(rows[0].host), input.id],
    );
    return true;
  });
}

/** 进程崩溃后的租约回收；超过最大尝试次数转死信，不会无限重试。 */
export async function reapExpiredCrawlLeases(
  repo: Repository,
  options: { now?: number; retryDelayMs?: number } = {},
): Promise<{ retried: number; deadLettered: number }> {
  const now = options.now ?? Date.now();
  const delay = Math.max(1_000, Math.min(6 * 60 * 60_000, Math.floor(options.retryDelayMs ?? 60_000)));
  return repo.withTransaction(async () => {
    const rows = await repo.raw(
      "SELECT id, host, attempts, max_attempts FROM crawl_tasks WHERE status = 'leased' AND lease_expires_at <= ? ORDER BY host ASC, id ASC LIMIT 500",
      [now],
    );
    let retried = 0, deadLettered = 0;
    for (const row of rows) {
      const terminal = Number(row.attempts) >= Number(row.max_attempts);
      const nextStatus = terminal ? "dead_letter" : "retry";
      const updated = await repo.raw(
        "UPDATE crawl_tasks SET status = ?, last_error = 'Worker lease expired', next_run_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'leased' AND lease_expires_at <= ? RETURNING id",
        [nextStatus, terminal ? 0 : now + delay, now, String(row.id), now],
      );
      if (!updated.length) continue;
      await repo.run(
        "UPDATE crawl_domain_state SET lease_task_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE host = ? AND lease_task_id = ?",
        [now, String(row.host), String(row.id)],
      );
      if (terminal) deadLettered++; else retried++;
    }
    return { retried, deadLettered };
  });
}

export async function recordCrawlFingerprint(repo: Repository, input: CrawlFingerprintInput): Promise<void> {
  const canonical = canonicalizeCrawlUrl(input.canonicalUrl).url;
  if (!input.contentHash.trim() || !input.simhash64.trim()) throw new TypeError("页面指纹不能为空");
  const fetchedAt = input.fetchedAt ?? Date.now();
  await repo.run(
    `INSERT INTO crawl_page_fingerprints
      (canonical_url, site_id, content_hash, simhash64, language, fetched_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(canonical_url) DO UPDATE SET
       site_id = excluded.site_id, content_hash = excluded.content_hash,
       simhash64 = excluded.simhash64, language = excluded.language,
       fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`,
    [canonical, input.siteId ?? null, input.contentHash.slice(0, 128),
      input.simhash64.slice(0, 64), input.language?.slice(0, 16) ?? null, fetchedAt, fetchedAt],
  );
}

export async function findCrawlFingerprint(
  repo: Repository,
  canonicalUrl: string,
): Promise<{ canonicalUrl: string; siteId: string | null; contentHash: string; simhash64: string; language: string | null; fetchedAt: number } | null> {
  const canonical = canonicalizeCrawlUrl(canonicalUrl).url;
  const rows = await repo.raw("SELECT * FROM crawl_page_fingerprints WHERE canonical_url = ? LIMIT 1", [canonical]);
  const row = rows[0];
  return row ? {
    canonicalUrl: String(row.canonical_url), siteId: row.site_id == null ? null : String(row.site_id),
    contentHash: String(row.content_hash), simhash64: String(row.simhash64),
    language: row.language == null ? null : String(row.language), fetchedAt: Number(row.fetched_at),
  } : null;
}
