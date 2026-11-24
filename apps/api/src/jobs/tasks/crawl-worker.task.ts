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
    if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) continue;
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
      if (seen.has(normalized)) continue;
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

export interface CrawlWorkerSummary {
  seedsEnqueued: number;
  tasksClaimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  heldForReview: number;
  candidatesCreated: number;
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
      if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
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
    heldForReview: 0, candidatesCreated: 0, feedUrlsEnqueued: 0, stopped: false,
  };
  const maxTasks = Math.max(1, Math.min(25, Math.floor(payload.maxTasks ?? 10)));
  const workerId = "crawl-worker:" + randomUUID();

  for (let i = 0; i < maxTasks; i++) {
    if (run.shouldStop()) { summary.stopped = true; break; }
    const task = await claimCrawlTask(ctx.repo, workerId, {
      leaseMs: 120_000, minDomainIntervalMs: 2_000, scanLimit: 50,
    });
    if (!task) break;
    summary.tasksClaimed++;
    try {
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
      if (response.status === 429 || response.status >= 500) {
        await settleCrawlTask(ctx.repo, {
          id: task.id, workerId, outcome: "retry",
          error: "上游暂时不可用，HTTP " + response.status,
          nextRunAt: Date.now() + retryDelay(task.attempts), now: Date.now(),
        });
        summary.retried++;
        continue;
      }
      if (response.status < 200 || response.status >= 400) {
        await settleCrawlTask(ctx.repo, {
          id: task.id, workerId, outcome: "dead_letter",
          error: "不可重试的 HTTP 状态 " + response.status, now: Date.now(),
        });
        summary.deadLettered++;
        continue;
      }

      const isSitemap = task.source === "sitemap_seed" || /<urlset\b|<sitemapindex\b/i.test(response.body);
      const isRss = task.source === "rss_seed" || /<rss\b|<feed\b/i.test(response.body);
      if ((isSitemap || isRss) && response.body) {
        const kind = isSitemap ? "sitemap" : "rss";
        const links = extractFeedUrls(response.body, response.finalUrl, kind);
        for (const url of links) {
          if (run.shouldStop()) break;
          const queued = await enqueueCrawlTask(ctx.repo, {
            url, source: childSource(task.source), priority: 0, maxAttempts: 5, requeueCompleted: true,
          });
          if (queued.status === "queued" || queued.status === "retry") summary.feedUrlsEnqueued++;
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
            source: task.source, confidence: existing.length ? 35 : 60,
            evidence: {
              fetchedStatus: response.status, finalUrl: response.finalUrl,
              fetchedAt: Date.now(), contentHash, simhash64: fp.simhash,
              tokenCount: fp.tokenCount, truncated: response.truncated,
              exactDuplicateOf: existing[0]?.canonical_url ?? null,
            },
          });
          summary.candidatesCreated++;
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
