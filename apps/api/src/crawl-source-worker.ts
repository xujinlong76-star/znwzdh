import { randomUUID } from "node:crypto";
import { guardedFetch, moderateSiteWithAi, type SiteModerationPolicy } from "@navhub/ai";
import {
  claimDueCrawlSources,
  claimCrawlDomain,
  releaseCrawlDomain,
  deferCrawlSource,
  settleCrawlSource,
  upsertSiteDiscoveryCandidate,
  recordCrawlAiModerationDecision,
  listCrawlAiModerationDecisions,
  type CrawlSource,
  type SiteDiscoveryCandidate,
} from "@navhub/store";
import type { AppContext } from "./context.ts";
import { resolveLlm, llmProviderReadyAny, type ResolvedLlm } from "./llm-config.ts";
import { reserveLlmQuota, settleLlmQuota } from "./llm-quota.ts";
import { callLlm } from "./llm-usage.ts";
import { loadCrawlAiModerationPolicy, type CrawlAiModerationPolicy } from "./crawl-moderation-policy.ts";


interface CrawlShadowModerationRuntime {
  policy: CrawlAiModerationPolicy;
  resolved: ResolvedLlm;
  reviewed: number;
}

async function processSource(
  ctx: AppContext,
  source: CrawlSource,
  now: number,
): Promise<SiteDiscoveryCandidate[]> {
  const response = await guardedFetch(
    source.url,
    { timeoutMs: 8_000, maxBytes: MAX_SOURCE_BODY_BYTES, maxRedirects: 3, allowPrivateNetworks: false },
    { headers: { accept: source.kind === "sitemap" ? "application/xml,text/xml,*/*"
      : source.kind === "rss" ? "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*"
      : "text/html,application/xhtml+xml,*/*" } },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error("采集来源返回 HTTP " + response.status);
  }
  if (response.truncated) throw new Error("采集来源响应超过 1 MiB，已拒绝不完整内容");
  const details = extractCrawlCandidateDetails(response.body, source.kind, response.finalUrl);
  const saved: SiteDiscoveryCandidate[] = [];
  for (const detail of details) {
    const candidate = await upsertSiteDiscoveryCandidate(ctx.repo, {
      id: randomUUID(),
      url: detail.url,
      canonicalUrl: detail.url,
      title: detail.title,
      description: detail.description,
      source: "crawl:" + source.id,
      evidence: {
        provenance: source.kind,
        sourceId: source.id,
        sourceUrl: source.url,
        fetchedUrl: response.finalUrl,
        httpStatus: response.status,
        contentType: response.contentType,
        discoveredAt: now,
      },
      now,
    });
    saved.push(candidate);
  }
  return saved;
}

async function moderateCandidateShadow(
  ctx: AppContext,
  candidate: SiteDiscoveryCandidate,
  runtime: CrawlShadowModerationRuntime,
): Promise<void> {
  if (runtime.reviewed >= runtime.policy.maxAiReviewsPerRun || !llmProviderReadyAny(runtime.resolved)) return;
  const previous = await listCrawlAiModerationDecisions(ctx.repo, { candidateId: candidate.id, limit: 10 });
  const recentlyReviewed = previous.some(row =>
    row.decision_source === "ai" && row.status === "completed" &&
    Number(row.created_at) >= Date.now() - 24 * 60 * 60_000,
  );
  if (recentlyReviewed) return;

  runtime.reviewed++;
  const holdResult = await reserveLlmQuota(ctx, null, { estimatedTokens: 1800, source: runtime.resolved.source });
  if (!holdResult.ok) {
    await recordCrawlAiModerationDecision(ctx.repo, {
      id: randomUUID(), candidateId: candidate.id, decisionSource: "ai", mode: "shadow",
      status: "quota_blocked", reasons: [holdResult.error.message], model: null,
      policyVersion: "crawl-shadow-v1", actor: "crawl-worker",
    });
    return;
  }

  try {
    const policy: Partial<SiteModerationPolicy> = {
      autoApproveConfidence: runtime.policy.autoApproveConfidence,
      rejectConfidence: runtime.policy.rejectConfidence,
      minQualityScore: runtime.policy.minQualityScore,
      maxExcerptChars: runtime.policy.maxExcerptChars,
      requireHttps: runtime.policy.requireHttps,
    };
    const result = await moderateSiteWithAi(runtime.resolved.provider, {
      url: candidate.url,
      title: candidate.title,
      description: candidate.description,
      contentExcerpt: null,
      evidence: candidate.evidence,
    }, policy, {
      complete: async (_provider, request) => {
        const completion = await callLlm(ctx, runtime.resolved, {
          scenario: "health_audit",
          identity: null,
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          json: request.json,
          signal: request.signal,
          deadlineAt: request.deadlineAt,
        });
        return { content: completion.content, model: completion.model };
      },
    });
    await recordCrawlAiModerationDecision(ctx.repo, {
      id: randomUUID(), candidateId: candidate.id, decisionSource: "ai", mode: "shadow",
      status: "completed", verdict: result.verdict, confidence: result.confidence,
      qualityScore: result.qualityScore, risks: result.risks, reasons: result.reasons,
      model: result.model, policyVersion: result.policyVersion, actor: "crawl-worker",
    });
  } catch (error) {
    await recordCrawlAiModerationDecision(ctx.repo, {
      id: randomUUID(), candidateId: candidate.id, decisionSource: "ai", mode: "shadow",
      status: "error", reasons: [error instanceof Error ? error.message.slice(0, 240) : "模型审核失败"],
      model: runtime.resolved.provider.model || null, policyVersion: "crawl-shadow-v1", actor: "crawl-worker",
    });
    throw error;
  } finally {
    await settleLlmQuota(ctx, holdResult.hold);
  }
}

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

function cleanMarkupText(value: string, max: number): string | null {
  const cleaned = decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, max);
  return cleaned || null;
}

export interface CrawlCandidateDetail {
  url: string;
  title: string | null;
  description: string | null;
}

function xmlText(block: string, tag: string): string | null {
  const match = block.match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + "\\s*>", "i"));
  return match?.[1] ? cleanMarkupText(match[1], 600) : null;
}

function candidateDetailsFromBlock(block: string, baseUrl: string, kind: CrawlSource["kind"]): CrawlCandidateDetail | null {
  let rawUrl: string | undefined;
  if (kind === "sitemap") {
    rawUrl = xmlText(block, "loc") ?? undefined;
  } else {
    const guid = xmlText(block, "guid");
    rawUrl = block.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/i)?.[1]
      ?? xmlText(block, "link")
      ?? (guid && /^https?:\/\//i.test(guid) ? guid : undefined);
  }
  if (!rawUrl) return null;
  const url = canonicalCandidateUrl(rawUrl, baseUrl);
  if (!url) return null;
  const title = xmlText(block, kind === "sitemap" ? "news:title" : "title");
  const description = kind === "sitemap" ? xmlText(block, "news:description")
    : xmlText(block, "description") ?? xmlText(block, "summary") ?? xmlText(block, "content");
  return { url, title, description };
}

/** 解析候选 URL 与候选自身的标题/描述；不在解析阶段发起二次网络请求。 */
export function extractCrawlCandidateDetails(body: string, kind: CrawlSource["kind"], baseUrl: string): CrawlCandidateDetail[] {
  const raw: CrawlCandidateDetail[] = [];
  if (kind === "sitemap") {
    const blocks = [...body.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi)];
    for (const match of blocks) {
      const detail = candidateDetailsFromBlock(match[1]!, baseUrl, kind);
      if (detail) raw.push(detail);
    }
    if (!raw.length) {
      for (const match of body.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)) {
        const detail = candidateDetailsFromBlock("<loc>" + match[1] + "</loc>", baseUrl, kind);
        if (detail) raw.push(detail);
      }
    }
  } else if (kind === "rss") {
    const blocks = [...body.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)\s*>/gi)];
    for (const match of blocks) {
      const detail = candidateDetailsFromBlock(match[1]!, baseUrl, kind);
      if (detail) raw.push(detail);
    }
    if (!raw.length) {
      for (const match of body.matchAll(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/gi)) {
        const url = canonicalCandidateUrl(match[1]!, baseUrl);
        if (url) raw.push({ url, title: null, description: null });
      }
    }
  } else {
    for (const match of body.matchAll(/<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
      const url = canonicalCandidateUrl(match[2]!, baseUrl);
      if (url) raw.push({ url, title: cleanMarkupText(match[4]!, 300), description: null });
    }
  }

  const unique = new Map<string, CrawlCandidateDetail>();
  for (const item of raw) {
    const existing = unique.get(item.url);
    if (!existing) unique.set(item.url, item);
    else unique.set(item.url, {
      url: item.url,
      title: existing.title ?? item.title,
      description: existing.description ?? item.description,
    });
    if (unique.size >= MAX_CANDIDATES_PER_SOURCE) break;
  }
  return [...unique.values()];
}

export function extractCrawlCandidateUrls(body: string, kind: CrawlSource["kind"], baseUrl: string): string[] {
  return extractCrawlCandidateDetails(body, kind, baseUrl).map(item => item.url);
}

type CrawlShadowModerationRuntime = {
  policy: CrawlAiModerationPolicy;
  resolved: Awaited<ReturnType<typeof resolveLlm>>;
  reviewed: number;
};

/** AI 结论只写 Shadow 审核账本；绝不改变候选状态或触发发布。 */
async function moderateCandidateShadow(
  ctx: AppContext,
  candidate: SiteDiscoveryCandidate,
  runtime: CrawlShadowModerationRuntime,
): Promise<void> {
  if (candidate.status !== "pending" || runtime.reviewed >= runtime.policy.maxAiReviewsPerRun) return;
  const recent = await ctx.repo.raw(
    "SELECT id FROM crawl_ai_moderation_decisions WHERE candidate_id=? AND decision_source='ai' AND mode='shadow' AND status='completed' AND created_at>=? LIMIT 1",
    [candidate.id, Date.now() - 24 * 60 * 60_000],
  );
  if (recent.length) return;
  runtime.reviewed++;

  const record = async (input: {
    status: "completed" | "error" | "quota_blocked";
    verdict?: string | null;
    confidence?: number | null;
    qualityScore?: number | null;
    risks?: string[];
    reasons?: string[];
    model?: string | null;
    policyVersion?: string | null;
  }) => recordCrawlAiModerationDecision(ctx.repo, {
    id: randomUUID(), candidateId: candidate.id, decisionSource: "ai", mode: "shadow",
    status: input.status, verdict: input.verdict, confidence: input.confidence,
    qualityScore: input.qualityScore, risks: input.risks, reasons: input.reasons,
    model: input.model, policyVersion: input.policyVersion, actor: "crawl-worker",
  });

  const readyProviders = [runtime.resolved.provider, ...runtime.resolved.fallbacks].filter(llmProviderReady);
  if (readyProviders.length === 0) {
    await record({ status: "error", reasons: ["未配置可用的大模型；候选保持待审核"] });
    return;
  }
  const quota = await reserveLlmQuota(ctx, null, {
    source: runtime.resolved.source, estimatedTokens: 1800,
  });
  if (!quota.ok) {
    await record({ status: "quota_blocked", reasons: [quota.error.message.slice(0, 240)] });
    return;
  }

  try {
    const result = await moderateSiteWithAi(runtime.resolved.provider, {
      url: candidate.url,
      title: candidate.title,
      description: candidate.description,
      evidence: {
        provenance: "crawl_source_item_metadata",
        warnings: ["尚未安全抓取候选页面正文；审核证据仅包含来源条目元数据"],
      },
    }, {
      autoApproveConfidence: runtime.policy.autoApproveConfidence,
      rejectConfidence: runtime.policy.rejectConfidence,
      minQualityScore: runtime.policy.minQualityScore,
      maxExcerptChars: runtime.policy.maxExcerptChars,
      requireHttps: runtime.policy.requireHttps,
    }, {
      deadlineAt: Date.now() + 30_000,
      complete: async (_provider, request) => {
        const response = await callLlm(ctx, runtime.resolved, {
          scenario: "crawl_moderation_shadow",
          identity: null,
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          json: request.json,
          thinking: false,
          signal: request.signal,
          deadlineAt: request.deadlineAt,
          fetchImpl: request.fetchImpl,
        });
        return { content: response.content, model: response.model };
      },
    });
    await record({
      status: "completed", verdict: result.verdict, confidence: result.confidence,
      qualityScore: result.qualityScore, risks: result.risks, reasons: result.reasons,
      model: result.model, policyVersion: result.policyVersion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await record({ status: "error", reasons: [message.slice(0, 240)] });
  } finally {
    await settleLlmQuota(ctx, quota.hold);
  }
}

/** 只抓取已注册来源；任何网络请求都经过逐跳 DNS/重定向校验的 guardedFetch。 */
async function processSource(
  ctx: AppContext,
  source: CrawlSource,
  now: number,
): Promise<SiteDiscoveryCandidate[]> {
  const response = await guardedFetch(source.url, {
    timeoutMs: 8_000,
    maxBytes: MAX_SOURCE_BODY_BYTES,
    maxRedirects: 3,
    allowPrivateNetworks: false,
  }, {
    accept: "application/xml,application/rss+xml,application/atom+xml,text/html;q=0.9,*/*;q=0.1",
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("采集来源返回 HTTP " + response.status);
  }
  if (response.truncated) throw new Error("采集来源响应体超过 1 MiB 安全上限");
  const details = extractCrawlCandidateDetails(response.body, source.kind, response.finalUrl);
  const discovered: SiteDiscoveryCandidate[] = [];
  for (const detail of details) {
    const candidate = await upsertSiteDiscoveryCandidate(ctx.repo, {
      id: randomUUID(),
      url: detail.url,
      canonicalUrl: detail.url,
      title: detail.title,
      description: detail.description,
      source: "crawl_source:" + source.id,
      evidence: {
        sourceUrl: response.finalUrl,
        sourceKind: source.kind,
        discoveredAt: now,
        parser: source.kind === "sitemap" ? "sitemap_xml" : source.kind === "rss" ? "rss_atom" : "html_anchor",
      },
      now,
    });
    discovered.push(candidate);
  }
  return discovered;
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
    now, limit: options.limit ?? 5, leaseMs: options.leaseMs ?? 5 * 60_000,
  });
  let moderation: CrawlShadowModerationRuntime | null = null;
  try {
    const policy = await loadCrawlAiModerationPolicy(ctx);
    if (policy.enabled && policy.mode === "shadow") {
      moderation = { policy, resolved: await resolveLlm(ctx), reviewed: 0 };
    }
  } catch (error) {
    console.error("[crawl-worker] AI moderation policy unavailable; candidates remain pending:", error);
  }
  let succeeded = 0, failed = 0, candidates = 0;
  for (const source of sources) {
    const host = new URL(source.url).hostname.toLowerCase();
    const domainClaimed = await claimCrawlDomain(ctx.repo, host, source.id, { now, leaseMs: 5 * 60_000 });
    if (!domainClaimed) {
      await deferCrawlSource(ctx.repo, { id: source.id, workerId: options.workerId, now, delayMs: 15_000 });
      continue;
    }
    let discovered: SiteDiscoveryCandidate[] = [];
    try {
      discovered = await processSource(ctx, source, now);
      candidates += discovered.length;
      await settleCrawlSource(ctx.repo, { id: source.id, workerId: options.workerId, status: "ok", now });
      succeeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await settleCrawlSource(ctx.repo, { id: source.id, workerId: options.workerId, status: "error", error: message, now });
      failed++;
    } finally {
      await releaseCrawlDomain(ctx.repo, host, source.id, { now: Date.now(), minIntervalMs: 15_000 });
    }
    // AI 调用在抓取租约释放后执行，避免模型慢调用占住域名租约或让来源租约过期。
    if (moderation) {
      for (const candidate of discovered) {
        try { await moderateCandidateShadow(ctx, candidate, moderation); }
        catch (error) { console.error("[crawl-worker] shadow moderation failed:", error); }
        if (moderation.reviewed >= moderation.policy.maxAiReviewsPerRun) break;
      }
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
