/**
 * Crawl scheduling policies shared by discovery and refresh workers.
 * Durable queue state/leases live in @navhub/store; this module is pure policy.
 */
export type CrawlFailureKind = "network" | "timeout" | "rate_limit" | "server" | "not_found" | "gone" | "invalid_url" | "robots_denied" | "auth_required" | "unknown";
export type CrawlDisposition = "retry" | "hold_for_review" | "dead_letter";
export interface CrawlRetryPolicy { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; jitterRatio?: number; }

export function classifyCrawlFailure(kind: CrawlFailureKind, attempt: number, policy: CrawlRetryPolicy = {}): CrawlDisposition {
  const maxAttempts = policy.maxAttempts ?? 6;
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError("attempt 必须是正整数");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("maxAttempts 必须是正整数");
  if (kind === "robots_denied" || kind === "auth_required") return "hold_for_review";
  if (kind === "not_found" || kind === "gone" || kind === "invalid_url") return "dead_letter";
  return attempt >= maxAttempts ? "dead_letter" : "retry";
}

/** Exponential backoff with bounded jitter. Retry-After is a server lower bound and is never shortened. */
export function crawlRetryDelayMs(attempt: number, policy: CrawlRetryPolicy = {}, random = 0.5, retryAfterMs?: number | null): number {
  const base = policy.baseDelayMs ?? 30_000, cap = policy.maxDelayMs ?? 6 * 60 * 60 * 1_000, jitter = policy.jitterRatio ?? 0.2;
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError("attempt 必须是正整数");
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(cap) || cap < base) throw new RangeError("退避时间配置无效");
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new RangeError("jitterRatio 必须在 0–1 之间");
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new RangeError("random 必须在 0–1 之间");
  if (retryAfterMs !== undefined && retryAfterMs !== null && (!Number.isFinite(retryAfterMs) || retryAfterMs < 0)) throw new RangeError("retryAfterMs 无效");
  const exponential = Math.min(cap, base * 2 ** Math.min(attempt - 1, 30));
  const localDelay = Math.min(cap, Math.max(0, Math.round(exponential * (1 - jitter + 2 * jitter * random))));
  return Math.max(retryAfterMs ?? 0, localDelay);
}

export function domainMayStartCrawl(now: number, lastStartedAt: number | null, minIntervalMs: number): boolean {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("now 无效");
  if (lastStartedAt !== null && (!Number.isFinite(lastStartedAt) || lastStartedAt < 0)) throw new RangeError("lastStartedAt 无效");
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) throw new RangeError("minIntervalMs 无效");
  return lastStartedAt === null || now - lastStartedAt >= minIntervalMs;
}

export function normalizeCrawlHost(input: string): string {
  let url: URL;
  try { url = new URL(input.includes("://") ? input : `https://${input}`); } catch { throw new TypeError("采集目标 URL 无效"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("只允许 HTTP(S) 采集目标");
  if (url.username || url.password || !url.hostname) throw new TypeError("采集目标不得包含账号密码且必须有主机名");
  return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}
