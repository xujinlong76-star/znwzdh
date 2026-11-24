import type { Repository } from "../repository.ts";

export interface CrawlRobotsCacheEntry {
  origin: string;
  body: string | null;
  blocked: boolean;
  status: number;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: number;
  expiresAt: number;
}

function normalizeOrigin(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new TypeError("robots 缓存 origin 无效"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.origin !== input || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("robots 缓存键必须是规范 HTTP(S) origin");
  }
  return url.origin;
}

function mapRow(row: Record<string, unknown>): CrawlRobotsCacheEntry {
  return {
    origin: String(row.origin),
    body: row.body == null ? null : String(row.body),
    blocked: Number(row.blocked) === 1 || row.blocked === true,
    status: Number(row.status),
    etag: row.etag == null ? null : String(row.etag),
    lastModified: row.last_modified == null ? null : String(row.last_modified),
    fetchedAt: Number(row.fetched_at),
    expiresAt: Number(row.expires_at),
  };
}

/** 只返回仍在 TTL 内的共享缓存；过期记录保留供下一次 upsert 覆盖。 */
export async function getCrawlRobotsCache(
  repo: Repository,
  originInput: string,
  now = Date.now(),
): Promise<CrawlRobotsCacheEntry | null> {
  const origin = normalizeOrigin(originInput);
  const rows = await repo.raw(
    "SELECT * FROM crawl_robots_cache WHERE origin = ? AND expires_at > ? LIMIT 1",
    [origin, now],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** 缓存只保存可安全解释的 robots 结果；临时网络错误不得写入缓存。 */
export async function upsertCrawlRobotsCache(
  repo: Repository,
  input: {
    origin: string; body: string | null; blocked: boolean; status: number;
    etag?: string | null; lastModified?: string | null;
    fetchedAt?: number; ttlMs?: number;
  },
): Promise<void> {
  const origin = normalizeOrigin(input.origin);
  if (input.body !== null && input.body.length > 64 * 1024) throw new RangeError("robots 缓存正文超过 64 KiB");
  if (!Number.isInteger(input.status) || input.status < 100 || input.status > 599) {
    throw new RangeError("robots 缓存 HTTP 状态无效");
  }
  const fetchedAt = input.fetchedAt ?? Date.now();
  const ttlMs = Math.max(60_000, Math.min(24 * 60 * 60_000, Math.floor(input.ttlMs ?? 60 * 60_000)));
  await repo.run(
    `INSERT INTO crawl_robots_cache
      (origin, body, blocked, status, etag, last_modified, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(origin) DO UPDATE SET
       body=excluded.body, blocked=excluded.blocked, status=excluded.status,
       etag=excluded.etag, last_modified=excluded.last_modified,
       fetched_at=excluded.fetched_at, expires_at=excluded.expires_at`,
    [origin, input.body, input.blocked, input.status,
      input.etag?.slice(0, 500) ?? null, input.lastModified?.slice(0, 500) ?? null,
      fetchedAt, fetchedAt + ttlMs],
  );
}
