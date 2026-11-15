/**
 * 共享站点探活（Batch 4 Phase 2 P2-2 第 0 步：从 verify.ts 抽出）。
 *
 * P2-1 的 robots 判定与 candidate 探活原本是 verify.ts 的模块私有实现；
 * P2-2 的官方定价页抓取复用同一管线（同一抓取口径、同一 robots 合规、
 * 同一 probe-cache），故抽成共享模块，verify.ts 改为 import 它。
 *
 * 抓取口径（与 P2-1 一致，不自造判定）：
 *   - guardedFetch（@navhub/ai，逐跳 SSRF 校验）+ candidate profile
 *     （单条 2.5 秒、8KB、最多 3 跳，不伪装浏览器 UA）；
 *   - robots.txt 按 origin 内存缓存 1 小时，禁抓不发站点请求；
 *   - probe-cache（@navhub/core）：结论 TTL 按种类分档（健康 7 天、
 *     死链 12 小时、未验证 1 小时），新鲜缓存直接复用结论、不发请求。
 *
 * 本模块只做探活与 robots 判定，不写任何业务表、不碰身份与收藏。
 */
import {
  classifyProbeError,
  classifyProbeStatus,
  conditionalHeaders,
  type ProbeOutcome,
  type ProbeOutcomeKind,
} from "@navhub/core";
import { guardedFetch, outboundProfile, SsrfBlockedError } from "@navhub/ai";
import { getProbeCache, scheduleProbeCacheFlush } from "./probe-cache.ts";

/** 单条探活硬超时（毫秒）：candidate profile 的 2.5 秒。 */
export const SITE_PROBE_TIMEOUT_MS = 2500;
/** robots.txt 判定按 origin 的内存缓存时长（毫秒）。 */
export const SITE_PROBE_ROBOTS_CACHE_TTL_MS = 60 * 60 * 1000;

export type SiteProbeOutcomeKind = ProbeOutcomeKind;

export interface SiteProbeResult {
  kind: SiteProbeOutcomeKind;
  status?: number;
  latencyMs: number;
  redirectTo?: string | null;
  reason: string;
  /** robots.txt 明确禁抓时为 true（此时 kind 为 unverified，且站点请求根本没发）。 */
  robotsDisallowed?: boolean;
  /**
   * 本次结论来自新鲜 probe-cache，未发任何请求（评审 NIT 1）。
   * 此时 latencyMs 恒为 0——它是“没测”，不是 0ms；调用方不得拿它写
   * 健康字段或巡检历史，否则会把维护格的核实日期推成今天、并往
   * health_checks 里插一条未真实发生的成功行。
   */
  fromCache?: boolean;
  /** fromCache 时：上次真实探活的时间（毫秒戳，即缓存条目的 checkedAt）。 */
  checkedAt?: number;
}

/** 探活取回的页面正文（P2-2 抓取用）：只在本次真实请求成功时才有 body。 */
export interface CandidatePageResult {
  kind: SiteProbeOutcomeKind;
  status: number | null;
  latencyMs: number;
  redirectTo?: string | null;
  reason: string;
  /** 响应正文（candidate profile 上限 8KB；失败/未验证时为空串）。 */
  body: string;
}

type RobotsCheckFn = (url: string) => Promise<boolean>;

let robotsOverride: RobotsCheckFn | null = null;

/** 仅测试用：注入假 robots 判定（true = 禁抓），传 null 恢复默认实现。 */
export function setSiteProbeRobotsCheckForTests(fn: RobotsCheckFn | null): void {
  robotsOverride = fn;
}

/** 仅测试用：清空 robots 内存缓存。 */
export function resetSiteProbeRobotsCacheForTests(): void {
  robotsCache.clear();
}

const robotsCache = new Map<string, { disallowed: boolean; expiresAt: number }>();

export function robotsUrlFor(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return u.origin + "/robots.txt";
  } catch {
    return null;
  }
}

/**
 * robots.txt 纯解析：userAgent 为 NavHubBot（同时认 `*` 组）。
 * 最长匹配规则获胜（Allow 与 Disallow 同长时 Disallow 获胜）；无匹配规则 → 允许。
 * 空 Disallow（`Disallow:`）表示允许一切，不算禁抓。
 */
export function isRobotsDisallowed(robotsTxt: string, path: string): boolean {
  const targetPath = path || "/";
  let bestAllow = -1;
  let bestDisallow = -1;
  let inApplicableGroup = false;
  let groupHasRule = false;
  // robots.txt 按组解析：每遇到 User-agent 行就重开一组；只有 UA 为 * 或含 navhubbot 的组才适用。
  const lines = robotsTxt.split(/\r?\n/);
  let pendingAgents: string[] = [];
  let groupApplies = false;
  const flushGroup = () => {
    if (pendingAgents.length > 0) {
      groupApplies = pendingAgents.some(
        (ua) => ua === "*" || ua.toLowerCase().includes("navhubbot"),
      );
      inApplicableGroup = groupApplies;
      groupHasRule = false;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (pendingAgents.length > 0 && groupHasRule) {
        // 上一组已有规则：新 User-agent 行开启新组
        pendingAgents = [value.toLowerCase()];
        inApplicableGroup = false;
        groupHasRule = false;
        groupApplies = pendingAgents.some(
          (ua) => ua === "*" || ua.toLowerCase().includes("navhubbot"),
        );
        inApplicableGroup = groupApplies;
      } else {
        pendingAgents.push(value.toLowerCase());
      }
      continue;
    }
    if (field === "allow" || field === "disallow") {
      flushGroup();
      if (!inApplicableGroup) continue;
      groupHasRule = true;
      if (!value) continue; // 空规则：Disallow 空 = 允许，Allow 空无意义
      const rule = value;
      // robots 规则是前缀匹配（不支持 * 与 $ 通配展开：含通配的规则按字面
      // 前缀比对，宁可漏判一条花哨规则，也不把正常路径误判为禁抓）。
      if (!targetPath.startsWith(rule)) continue;
      if (field === "allow") bestAllow = Math.max(bestAllow, rule.length);
      else bestDisallow = Math.max(bestDisallow, rule.length);
    }
  }
  if (bestDisallow < 0) return false;
  return bestDisallow >= bestAllow;
}

async function defaultRobotsDisallowed(url: string): Promise<boolean> {
  let origin: string;
  let path: string;
  try {
    const u = new URL(url);
    origin = u.origin;
    path = u.pathname || "/";
  } catch {
    return false;
  }
  const cached = robotsCache.get(origin);
  if (cached && Date.now() < cached.expiresAt) return cached.disallowed;
  let disallowed = false;
  try {
    const robotsUrl = origin + "/robots.txt";
    const res = await guardedFetch(
      robotsUrl,
      {
        timeoutMs: SITE_PROBE_TIMEOUT_MS,
        maxBytes: 32 * 1024,
        maxRedirects: 3,
        userAgent: outboundProfile("candidate").userAgent,
      },
      { accept: "text/plain" },
    );
    // 只有 200 且有正文才解析；404/其他状态 = 无 robots.txt = 允许抓取。
    if (res.status === 200 && res.body) {
      disallowed = isRobotsDisallowed(res.body, path);
    }
  } catch (err) {
    // robots.txt 读不到（超时/DNS/SSRF 拦截）：SSRF 拦截意味着站点本身也探不了，
    // 交给站点探活去判，这里不提前禁抓；其余失败一律按“无 robots.txt”放行，
    // 绝不因一次读失败就把按钮永久置灰。
    if (err instanceof SsrfBlockedError) {
      // 站点探活同样会被拦截；这里返回 false，让探活走正常 unverified 路径
      // （写 probe-cache、不写健康字段），而不是伪装成 robots 禁抓。
      disallowed = false;
    } else {
      disallowed = false;
    }
  }
  robotsCache.set(origin, { disallowed, expiresAt: Date.now() + SITE_PROBE_ROBOTS_CACHE_TTL_MS });
  return disallowed;
}

/** robots.txt 是否禁抓该 URL（true = 禁抓；读失败/无 robots.txt 一律放行）。 */
export async function checkRobotsAllowed(url: string): Promise<boolean> {
  const check = robotsOverride ?? defaultRobotsDisallowed;
  try {
    return await check(url);
  } catch {
    return false;
  }
}

/* ------------------------------ 候选探活 ------------------------------ */

function outcomeOfStatus(status: number): ProbeOutcome | null {
  const classified = classifyProbeStatus(status);
  if (classified) return classified;
  return { kind: "ok", status, reason: "内容检测通过" };
}

/**
 * 用 candidate profile 取一次页面正文（P2-2 官方定价页抓取用）。
 *
 * 与 probeWithCandidateProfile 的区别：本函数不查 probe-cache（抓取要的是
 * 新鲜正文，不是复用结论），但结论仍按同一口径记进 probe-cache；失败不抛错，
 * 以 kind + reason 回报（超时/连接失败 → unverified，绝不写假值）。
 */
export async function fetchCandidatePage(
  url: string,
  signal?: AbortSignal,
): Promise<CandidatePageResult> {
  const started = Date.now();
  const profile = outboundProfile("candidate");
  try {
    const res = await guardedFetch(
      url,
      {
        timeoutMs: SITE_PROBE_TIMEOUT_MS,
        maxBytes: profile.maxBytes,
        maxRedirects: profile.maxRedirects,
        userAgent: profile.userAgent,
      },
      { signal },
    );
    const elapsed = Date.now() - started;
    const outcome = outcomeOfStatus(res.status) ?? {
      kind: "ok" as const,
      status: res.status,
      reason: "内容检测通过",
    };
    const cache = await getProbeCache();
    cache.record(url, outcome, { etag: res.etag ?? null, lastModified: res.lastModified ?? null });
    scheduleProbeCacheFlush(cache);
    return {
      kind: outcome.kind,
      status: res.status,
      latencyMs: elapsed,
      redirectTo: res.redirects?.at(-1) ?? null,
      reason: outcome.reason,
      body: res.body ?? "",
    };
  } catch (err) {
    const elapsed = Date.now() - started;
    const outcome = classifyProbeError(err, {
      elapsedMs: elapsed,
      timeoutMs: SITE_PROBE_TIMEOUT_MS,
      url,
    });
    const cache = await getProbeCache();
    cache.record(url, outcome);
    scheduleProbeCacheFlush(cache);
    return { kind: outcome.kind, status: null, latencyMs: elapsed, redirectTo: null, reason: outcome.reason, body: "" };
  }
}

/**
 * candidate profile 探活（P2-1 刷新验证用；原 verify.ts 的 defaultProbeSite，
 * 原样搬入，只改名）。
 *
 * 新鲜 probe-cache 直接复用结论、不发请求；过期缓存带条件头重测（304 即
 * 未变更）。只返回结论，不返回正文。
 * 新鲜缓存命中时 fromCache 为 true、latencyMs 为 0（没发请求，不是 0ms），
 * 并带上原始 checkedAt；调用方不得据此写健康字段（见 verify.ts 的写库口径）。
 */
export async function probeWithCandidateProfile(
  url: string,
  signal: AbortSignal,
): Promise<SiteProbeResult> {
  const started = Date.now();
  const profile = outboundProfile("candidate");
  const cache = await getProbeCache();
  const cached = cache.lookup(url);
  if (cached?.fresh) {
    // 新鲜缓存：一个出站请求都不发，直接复用上次结论（TTL：健康 7 天、
    // 死链 12 小时、未验证 1 小时，见 probe-cache.ts 的 PROBE_CACHE_TTL_MS）。
    // fromCache 标记 + 原始 checkedAt：调用方据此跳过写库——latencyMs 0
    // 与此刻时间戳都不是本次实测值，写了就是假值（评审 NIT 1）。
    return {
      kind: cached.entry.kind,
      ...(cached.entry.status !== undefined ? { status: cached.entry.status } : {}),
      latencyMs: 0,
      redirectTo: null,
      reason: `缓存命中：${cached.entry.reason}`,
      fromCache: true,
      checkedAt: cached.entry.checkedAt,
    };
  }
  try {
    const res = await guardedFetch(
      url,
      {
        timeoutMs: SITE_PROBE_TIMEOUT_MS,
        maxBytes: profile.maxBytes,
        maxRedirects: profile.maxRedirects,
        userAgent: profile.userAgent,
      },
      { signal, headers: conditionalHeaders(cached?.entry) },
    );
    const elapsed = Date.now() - started;
    if (res.status === 304 && cached) {
      cache.markRevalidated(url);
      scheduleProbeCacheFlush(cache);
      return {
        kind: cached.entry.kind,
        ...(cached.entry.status !== undefined ? { status: cached.entry.status } : {}),
        latencyMs: elapsed,
        redirectTo: null,
        reason: `未变更（304）：${cached.entry.reason}`,
      };
    }
    const outcome = outcomeOfStatus(res.status) ?? {
      kind: "ok" as const,
      status: res.status,
      reason: "内容检测通过",
    };
    cache.record(url, outcome, { etag: res.etag ?? null, lastModified: res.lastModified ?? null });
    scheduleProbeCacheFlush(cache);
    return {
      kind: outcome.kind,
      status: res.status,
      latencyMs: elapsed,
      redirectTo: res.redirects?.at(-1) ?? null,
      reason: outcome.reason,
    };
  } catch (err) {
    const elapsed = Date.now() - started;
    const outcome = classifyProbeError(err, {
      elapsedMs: elapsed,
      timeoutMs: SITE_PROBE_TIMEOUT_MS,
      url,
    });
    cache.record(url, outcome);
    scheduleProbeCacheFlush(cache);
    return { kind: outcome.kind, latencyMs: elapsed, redirectTo: null, reason: outcome.reason };
  }
}
