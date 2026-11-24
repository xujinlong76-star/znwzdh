import { randomUUID } from "node:crypto";
import { guardedFetch } from "@navhub/ai";
import {
  claimDueCrawlSources,
  settleCrawlSource,
  upsertSiteDiscoveryCandidate,
  type CrawlSource,
} from "@navhub/store";
import type { AppContext } from "./context.ts";

const MAX_CANDIDATES_PER_SOURCE = 100;
const MAX_SOURCE_BODY_BYTES = 1024 * 1024;
const WORKER_INTERVAL_MS = 60_000;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function canonicalCandidateUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(raw.trim()), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || !url.hostname) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    if (url.href.length > 2048) return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractHtmlMetadata(body: string): { title: string | null; description: string | null } {
  const title = body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) ?? null;
  const description = body.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i)?.[1]
    ?.replace(/\s+/g, " ").trim().slice(0, 600) ?? null;
  return { title: title ? decodeEntities(title) : null, description: description ? decodeEntities(description) : null };
}

/** 只解析候选链接，不在解析阶段发起任何二次网络请求。 */
export function extractCrawlCandidateUrls(body: string, kind: CrawlSource["kind"], baseUrl: string): string[] {
  const rawLinks: string[] = [];
  if (kind === "sitemap") {
    for (const match of body.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)) rawLinks.push(match[1]!.replace(/<[^>]+>/g, "").trim());
  } else if (kind === "rss") {
    for (const match of body.matchAll(/<link\b[^>]*>([\s\S]*?)<\/link\s*>/gi)) rawLinks.push(match[1]!.replace(/<[^>]+>/g, "").trim());
    for (const match of body.matchAll(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/gi)) rawLinks.push(match[1]!);
    for (const match of body.matchAll(/<guid\b[^>]*>([\s\S]*?)<\/guid\s*>/gi)) rawLinks.push(match[1]!.replace(/<[^>]+>/g, "").trim());
  } else {
    for (const match of body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) rawLinks.push(match[1]!);
  }
  const unique = new Set<string>();
  for (const raw of rawLinks) {
    const url = canonicalCandidateUrl(raw, baseUrl);
    if (url) unique.add(url);
    if (unique.size >= MAX_CANDIDATES_PER_SOURCE) break;
  }
  return [...unique];
}

async function processSource(ctx: AppContext, source: CrawlSource, now: number): Promise<number> {
  const response = await guardedFetch(source.url, {
    timeoutMs: 8_000,
    maxBytes: MAX_SOURCE_BODY_BYTES,
    maxRedirects: 3,
    allowPrivateNetworks: false,
  }, { accept: source.kind === "sitemap" ? "application/xml,text/xml,*/*" : "application/rss+xml,application/atom+xml,text/html,*/*" });

  if (response.status < 200 || response.status >= 300) {
    throw new Error("来源返回 HTTP " + response.status);
  }
  const baseUrl = response.finalUrl || source.url;
  const candidates = extractCrawlCandidateUrls(response.body, source.kind, baseUrl);
  const metadata = extractHtmlMetadata(response.body);
  let inserted = 0;
  for (const url of candidates) {
    await upsertSiteDiscoveryCandidate(ctx.repo, {
      id: randomUUID(),
      url,
      canonicalUrl: url,
      title: metadata.title,
      description: metadata.description,
      source: "crawl:" + source.kind + ":" + new URL(source.url).hostname,
      confidence: 0.5,
      evidence: {
        sourceId: source.id,
        sourceKind: source.kind,
        fetchedAt: now,
        httpStatus: response.status,
        responseTruncated: response.truncated,
        sourceFinalUrl: baseUrl,
      },
      now,
    });
    inserted++;
  }
  return inserted;
}

/**
 * 单轮只认领有限来源；来源抓取统一走 guardedFetch，禁止在 Worker 中使用原生 fetch。
 * 默认不开启调度，需显式设置 NAVHUB_CRAWL_WORKER_ENABLED=1。
 */
export async function runCrawlSourceWorkerBatch(
  ctx: AppContext,
  options: { workerId: string; now?: number; limit?: number; leaseMs?: number } ,
): Promise<{ claimed: number; succeeded: number; failed: number; candidates: number }> {
  const now = options.now ?? Date.now();
  const sources = await claimDueCrawlSources(ctx.repo, options.workerId, {
    now, limit: options.limit ?? 5, leaseMs: options.leaseMs ?? 90_000,
  });
  let succeeded = 0, failed = 0, candidates = 0;
  for (const source of sources) {
    try {
      candidates += await processSource(ctx, source, now);
      await settleCrawlSource(ctx.repo, { id: source.id, workerId: options.workerId, status: "ok", now });
      succeeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await settleCrawlSource(ctx.repo, { id: source.id, workerId: options.workerId, status: "error", error: message, now });
      failed++;
    }
  }
  return { claimed: sources.length, succeeded, failed, candidates };
}

export function startCrawlSourceWorker(
  ctx: AppContext,
  options: { workerId: string; intervalMs?: number; limit?: number },
): { stop(): void; drain(): Promise<void> } {
  const intervalMs = Math.max(10_000, Math.min(10 * 60_000, Math.floor(options.intervalMs ?? WORKER_INTERVAL_MS)));
  let stopped = false;
  let active: Promise<void> | null = null;
  const tick = () => {
    if (stopped || active) return;
    active = runCrawlSourceWorkerBatch(ctx, { workerId: options.workerId, limit: options.limit ?? 5 })
      .then(result => {
        if (result.claimed) console.info("[crawl-worker]", JSON.stringify(result));
      })
      .catch(error => console.error("[crawl-worker] batch failed:", error))
      .finally(() => { active = null; });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return {
    stop() { stopped = true; clearInterval(timer); },
    async drain() { stopped = true; clearInterval(timer); await active; },
  };
}
