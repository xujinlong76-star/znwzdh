import { createHash, randomUUID } from "node:crypto";
import { fingerprintPageContent } from "@navhub/core";
import { guardedFetch } from "@navhub/ai";
import {
  claimCrawlTask,
  enqueueCrawlTask,
  recordCrawlFingerprint,
  settleCrawlTask,
  upsertSiteDiscoveryCandidate,
} from "@navhub/store";
import type { AppContext } from "../../context.ts";
import type { JobRunHandle } from "../../jobs.ts";

export type CrawlSeedKind = "sitemap" | "rss" | "page";
export interface CrawlSeed { url: string; kind: CrawlSeedKind; }

const MAX_SEEDS = 100;
const MAX_FEED_ITEMS = 50;
const MAX_BODY_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  return url.toString();
}

/** 支持 JSON 数组字符串，方便容器环境变量注入；不接受任意对象字段。 */
export function parseCrawlSeeds(raw: string | undefined): CrawlSeed[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new TypeError("NAVHUB_CRAWL_SEEDS 必须是 JSON 数组"); }
  if (!Array.isArray(parsed)) throw new TypeError("NAVHUB_CRAWL_SEEDS 必须是 JSON 数组");
  const out: CrawlSeed[] = [];
  const seen = new Set<string>();
  for (const item of parsed.slice(0, MAX_SEEDS)) {
    const value = typeof item === "string" ? { url: item, kind: "page" } : item as Record<string, unknown>;
    if (!value || typeof value.url !== "string") continue;
    const kind = value.kind === "sitemap" || value.kind === "rss" ? value.kind : "page";
    let url: string;
    try { url = canonicalUrl(value.url); } catch { continue; }
    const parsedUrl = new URL(url);
    if (url.length > 2048 || !["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, kind });
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/\s+/g, " ").trim();
}

function htmlField(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1] ? stripHtml(decodeXml(match[1])).slice(0, 500) || null : null;
}

export function extractHtmlMetadata(html: string): { title: string | null; description: string | null; text: string } {
  const title = htmlField(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = htmlField(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    ?? htmlField(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  return { title, description, text: stripHtml(html).slice(0, 100_000) };
}

export function extractFeedUrls(xml: string, baseUrl: string, kind: "sitemap" | "rss"): string[] {
  const candidates: string[] = [];
  if (kind === "sitemap") {
    for (const match of xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)) {
      candidates.push(decodeXml(match[1] ?? "").trim());
    }
  } else {
    for (const item of xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)) {
      const block = item[0];
      const link = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1]
        ?? block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]
        ?? block.match(/<id[^>]*>([\s\S]*?)<\/id>/i)?.[1];
      if (link) candidates.push(decodeXml(link).trim());
    }
  }
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates.slice(0, MAX_FEED_ITEMS)) {
    try {
      const url = new URL(raw, baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      url.hash = "";
      const normalized = url.toString();
      if (normalized.length > 2048 || seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    } catch { /* 忽略格式错误的 feed 项，不中断整批 */ }
  }
  return urls;
}

function seedSource(kind: CrawlSeedKind): string {
  return kind === "sitemap" ? "sitemap_seed" : kind === "rss" ? "rss_seed" : "page_seed";
}

function childSource(parent: string): string {
  if (parent === "sitemap_seed") return "sitemap_page";
  if (parent === "rss_seed") return "rss_item";
  return "discovered_page";
}

function retryDelay(attempts: number): number {
  const base = 60_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 60 * 60_000);
}

async function waitForDomainWindow(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Retry-After 可为秒数或 HTTP-date；最大等待 6 小时，不能被上游无限期挂起。 */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number {
  if (!value?.trim()) return 0;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(6 * 60 * 60_000, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 0;
  return Math.min(6 * 60 * 60_000, Math.max(0, date - now));
}

export interface RobotsRule { allow: boolean; path: string; }
interface RobotsGroup { agents: string[]; rules: RobotsRule[]; }

/** RFC 9309 的保守子集：User-agent 分组、Allow/Disallow、最长匹配优先、Allow 同长优先。 */
function robotsPatternMatches(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith("$");
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const parts = raw.split("*");
  let cursor = 0;
  if (!raw.startsWith("*") && !target.startsWith(parts[0] ?? "")) return false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (!part) continue;
    const at = target.indexOf(part, cursor);
    if (at < 0) return false;
    if (i === 0 && !raw.startsWith("*") && at !== 0) return false;
    cursor = at + part.length;
  }
  return !anchored || target.endsWith(parts[parts.length - 1] ?? "");
}

export function isRobotsAllowed(robotsTxt: string, targetUrl: string, userAgent = "NavHubDiscoveryBot"): boolean {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let hasRules = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent" && value) {
      if (current && hasRules) { current = null; hasRules = false; }
      if (!current) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current || (key !== "allow" && key !== "disallow")) continue;
    if (value) current.rules.push({ allow: key === "allow", path: value });
    hasRules = true;
  }
  const agent = userAgent.toLowerCase();
  const matching = groups.map((group) => ({
    group,
    score: Math.max(0, ...group.agents.map((name) => name === "*" ? 0 : agent.includes(name) ? name.length : -1)),
  })).filter((item) => item.score >= 0);
  if (!matching.length) return true;
  const bestScore = Math.max(...matching.map((item) => item.score));
  const rules = matching.filter((item) => item.score === bestScore).flatMap((item) => item.group.rules);
  if (!rules.length) return true;
  const url = new URL(targetUrl);
  const target = url.pathname + url.search;
  let winner: { allow: boolean; specificity: number } | null = null;
  for (const rule of rules) {
    if (!robotsPatternMatches(rule.path, target)) continue;
    const specificity = Array.from(rule.path.replace(/[*$]/g, "")).length;
    if (!winner || specificity > winner.specificity || (specificity === winner.specificity && rule.allow)) {
      winner = { allow: rule.allow, specificity };
    }
  }
  return winner?.allow ?? true;
}

type RobotsResult =
  | { kind: "allowed" }
  | { kind: "blocked"; reason: string }
  | { kind: "retry"; reason: string; retryAfterMs: number };

const ROBOTS_CACHE_TTL_MS = 60 * 60_000;
const ROBOTS_CACHE_MAX_ENTRIES = 5_000;
const robotsCache = new Map<string, { expiresAt: number; body: string | null; blocked: boolean }>();

function cacheRobots(origin: string, value: { expiresAt: number; body: string | null; blocked: boolean }): void {
  if (!robotsCache.has(origin) && robotsCache.size >= ROBOTS_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, cached] of robotsCache) {
      if (cached.expiresAt <= now) robotsCache.delete(key);
    }
    if (robotsCache.size >= ROBOTS_CACHE_MAX_ENTRIES) {
      const oldest = robotsCache.keys().next().value;
      if (oldest) robotsCache.delete(oldest);
    }
  }
  robotsCache.set(origin, value);
}

async function checkRobotsPolicy(url: string, signal?: AbortSignal): Promise<RobotsResult> {
  const target = new URL(url);
  const origin = target.origin;
  const now = Date.now();
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > now) {
    if (cached.blocked) return { kind: "blocked", reason: "robots.txt 禁止自动抓取该站点" };
    if (cached.body !== null && !isRobotsAllowed(cached.body, url)) {
      return { kind: "blocked", reason: "robots.txt Disallow 规则禁止抓取该 URL" };
    }
    return { kind: "allowed" };
  }
  try {
    const response = await guardedFetch(new URL("/robots.txt", origin).toString(), {
      timeoutMs: 5_000, maxBytes: 64 * 1024, maxRedirects: 3,
      userAgent: "NavHubDiscoveryBot/1.0 (+https://github.com/xujinlong76-star/znwzdh)",
    }, { signal });
    if (response.status === 404 || response.status === 410) {
      cacheRobots(origin, { expiresAt: now + ROBOTS_CACHE_TTL_MS, body: "", blocked: false });
      return { kind: "allowed" };
    }
    if (response.status === 401 || response.status === 403 || response.status === 451) {
      cacheRobots(origin, { expiresAt: now + ROBOTS_CACHE_TTL_MS, body: null, blocked: true });
      return { kind: "blocked", reason: "robots.txt 不允许自动抓取" };
    }
    if (response.truncated || /text\/html/i.test(response.contentType ?? "") || /<html\b/i.test(response.body)) {
      cacheRobots(origin, { expiresAt: now + ROBOTS_CACHE_TTL_MS, body: null, blocked: true });
      return { kind: "blocked", reason: "robots.txt 返回了超限内容或 HTML 页面，无法安全确认抓取许可" };
    }
    if (response.status === 429 || response.status >= 500 || response.status < 200 || response.status >= 300) {
      return {
        kind: "retry", reason: "robots.txt 暂时不可读取，按 fail-closed 策略稍后重试",
        retryAfterMs: parseRetryAfterMs(response.retryAfter, now),
      };
    }
    cacheRobots(origin, { expiresAt: now + ROBOTS_CACHE_TTL_MS, body: response.body, blocked: false });
    return isRobotsAllowed(response.body, url)
      ? { kind: "allowed" }
      : { kind: "blocked", reason: "robots.txt Disallow 规则禁止抓取该 URL" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "retry", reason: "robots.txt 检查失败，按 fail-closed 策略稍后重试：" + reason, retryAfterMs: 0 };
  }
}

export interface CrawlWorkerSummary {
  seedsEnqueued: number;
  tasksClaimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  heldForReview: number;
  candidatesUpserted: number;
  feedUrlsEnqueued: number;
  stopped: boolean;
}

export async function handleCrawlWorker(
  ctx: AppContext,
  run: JobRunHandle,
  payload: { seeds?: CrawlSeed[]; maxTasks?: number } = {},
): Promise<CrawlWorkerSummary> {
  const now = Date.now();
  const seeds = [...(payload.seeds ?? []), ...parseCrawlSeeds(process.env.NAVHUB_CRAWL_SEEDS)];
  const uniqueSeeds = new Map<string, CrawlSeed>();
  for (const seed of seeds.slice(0, MAX_SEEDS)) {
    try {
      const url = canonicalUrl(seed.url);
      const parsed = new URL(url);
      if (url.length <= 2048 && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
        uniqueSeeds.set(url, { url, kind: seed.kind });
      }
    } catch { /* malformed seeds are rejected, not scheduled */ }
  }

  let seedsEnqueued = 0;
  for (const seed of uniqueSeeds.values()) {
    if (run.shouldStop()) break;
    const task = await enqueueCrawlTask(ctx.repo, {
      url: seed.url, source: seedSource(seed.kind), priority: 10, maxAttempts: 5, requeueCompleted: true, now,
    });
    if (task.status === "queued" || task.status === "retry") seedsEnqueued++;
  }

  const summary: CrawlWorkerSummary = {
    seedsEnqueued, tasksClaimed: 0, completed: 0, retried: 0, deadLettered: 0,
    heldForReview: 0, candidatesUpserted: 0, feedUrlsEnqueued: 0, stopped: false,
  };
  const maxTasks = Math.max(1, Math.min(25, Math.floor(payload.maxTasks ?? 10)));
  const workerId = "crawl-worker:" + randomUUID();

  for (let i = 0; i < maxTasks; i++) {
    if (run.shouldStop()) { summary.stopped = true; break; }
    let task = await claimCrawlTask(ctx.repo, workerId, {
      leaseMs: 120_000, minDomainIntervalMs: 2_000, scanLimit: 50,
    });
    // 同一域名的后续任务会被 2 秒频控暂时挡住；短暂等待后再认领，
    // 避免「每轮只抓同一域名 1 页、下一轮要等 30 分钟」的吞吐问题。
    if (!task && !run.shouldStop()) {
      await waitForDomainWindow(2_050, run.signal);
      if (!run.shouldStop()) {
        task = await claimCrawlTask(ctx.repo, workerId, {
          leaseMs: 120_000, minDomainIntervalMs: 2_000, scanLimit: 50,
        });
      }
    }
    if (!task) break;
    summary.tasksClaimed++;
    try {
      const robots = await checkRobotsPolicy(task.url, run.signal);
      if (robots.kind === "blocked") {
        await settleCrawlTask(ctx.repo, {
          id: task.id, workerId, outcome: "hold_for_review", error: robots.reason, now: Date.now(),
        });
        summary.heldForReview++;
        continue;
      }
      if (robots.kind === "retry") {
        await settleCrawlTask(ctx.repo, {
          id: task.id, workerId, outcome: "retry", error: robots.reason,
          nextRunAt: Date.now() + Math.max(retryDelay(task.attempts), robots.retryAfterMs), now: Date.now(),
        });
        summary.retried++;
        continue;
      }
      const response = await guardedFetch(task.url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: MAX_BODY_BYTES,
        maxRedirects: 5,
        userAgent: "NavHubDiscoveryBot/1.0 (+https://github.com/xujinlong76-star/znwzdh)",
      }, { signal: run.signal });
      if (response.status === 401 || response.status === 403 || response.status === 451) {
        await settleCrawlTask(ctx.repo, {
          id: task.id, workerId, outcome: "hold_for_review",
          error: "目标站点要求认证、拒绝自动抓取或限制访问", now: Date.now(),
        });
        summary.heldForReview++;
        continue;
      }
      if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
        await settleCrawlTask(ctx.repo, {
          id: task.id, workerId, outcome: "retry",
          error: "上游暂时不可用，HTTP " + response.status,
          nextRunAt: Date.now() + Math.max(retryDelay(task.attempts), parseRetryAfterMs(response.retryAfter)), now: Date.now(),
        });
        summary.retried++;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        await settleCrawlTask(ctx.repo, {
          id: task.id, workerId, outcome: "dead_letter",
          error: "不可重试的 HTTP 状态 " + response.status, now: Date.now(),
        });
        summary.deadLettered++;
        continue;
      }

      const bodyLooksSitemap = /<urlset\b|<sitemapindex\b/i.test(response.body);
      const bodyLooksRss = /<rss\b|<feed\b/i.test(response.body);
      if ((task.source === "sitemap_seed" && !bodyLooksSitemap) || (task.source === "rss_seed" && !bodyLooksRss)) {
        await settleCrawlTask(ctx.repo, {
          id: task.id, workerId, outcome: "hold_for_review",
          error: "种子地址未返回预期的 Sitemap / RSS / Atom 文档，可能是登录页或错误页",
          now: Date.now(),
        });
        summary.heldForReview++;
        continue;
      }
      const isSitemap = task.source === "sitemap_seed" || bodyLooksSitemap;
      const isRss = task.source === "rss_seed" || bodyLooksRss;
      if ((isSitemap || isRss) && response.body) {
        const kind = isSitemap ? "sitemap" : "rss";
        const links = extractFeedUrls(response.body, response.finalUrl, kind);
        let feedInterrupted = false;
        for (const url of links) {
          if (run.shouldStop()) { feedInterrupted = true; break; }
          const queued = await enqueueCrawlTask(ctx.repo, {
            url, source: childSource(task.source), priority: 0, maxAttempts: 5, requeueCompleted: true,
          });
          if (queued.status === "queued" || queued.status === "retry") summary.feedUrlsEnqueued++;
        }
        if (feedInterrupted) {
          await settleCrawlTask(ctx.repo, {
            id: task.id, workerId, outcome: "retry",
            error: "采集任务在 feed 分发过程中被协作式停止",
            nextRunAt: Date.now() + 30_000, now: Date.now(),
          });
          summary.retried++;
          summary.stopped = true;
          break;
        }
      } else if (response.body && /(?:text\/html|application\/xhtml\+xml)/i.test(response.contentType ?? "")) {
        const metadata = extractHtmlMetadata(response.body);
        const fp = fingerprintPageContent(metadata.text);
        const contentHash = "sha256:" + createHash("sha256").update(metadata.text).digest("hex");
        const finalUrl = canonicalUrl(response.finalUrl);
        const existing = await ctx.repo.raw(
          "SELECT canonical_url FROM crawl_page_fingerprints WHERE content_hash = ? AND canonical_url <> ? LIMIT 1",
          [contentHash, finalUrl],
        );
        await recordCrawlFingerprint(ctx.repo, {
          canonicalUrl: finalUrl, contentHash, simhash64: fp.simhash,
          language: response.body.match(/<html[^>]+lang=["']([^"']+)/i)?.[1] ?? null,
          fetchedAt: Date.now(),
        });
        if (metadata.title || metadata.description || metadata.text.length >= 80) {
          await upsertSiteDiscoveryCandidate(ctx.repo, {
            id: randomUUID(), url: finalUrl, canonicalUrl: finalUrl,
            title: metadata.title, description: metadata.description,
            source: task.source,
            evidence: {
              fetchedStatus: response.status, finalUrl: response.finalUrl,
              fetchedAt: Date.now(), contentHash, simhash64: fp.simhash,
              tokenCount: fp.tokenCount, truncated: response.truncated,
              exactDuplicateOf: existing[0]?.canonical_url ?? null,
            },
          });
          summary.candidatesUpserted++;
        }
      }
      await settleCrawlTask(ctx.repo, {
        id: task.id, workerId, outcome: "done", now: Date.now(),
      });
      summary.completed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const review = /SsrfBlockedError|SSRF|受保护网段|禁止访问该端口/i.test(message);
      const outcome = review ? "hold_for_review" : task.attempts >= task.maxAttempts ? "dead_letter" : "retry";
      await settleCrawlTask(ctx.repo, {
        id: task.id, workerId, outcome,
        error: message.slice(0, 1800),
        nextRunAt: outcome === "retry" ? Date.now() + retryDelay(task.attempts) : null,
        now: Date.now(),
      });
      if (outcome === "hold_for_review") summary.heldForReview++;
      else if (outcome === "dead_letter") summary.deadLettered++;
      else summary.retried++;
      if (run.signal.aborted) { summary.stopped = true; break; }
    }
  }

  await ctx.repo.recordEvent("crawl_worker", { meta: summary }).catch(() => undefined);
  return summary;
}
