/**
 * 出站请求的 profile 表（唯一配置源）。
 *
 * 问题：超时、体积上限、UA 原本散在 `ssrf.ts` 的 DEFAULT_GUARD、
 * `routes/plugin-audit.ts` 的候选探活常量、`audit-queue-service.ts` 的任务探活常量里。
 * 改一处漏一处，就会出现「同步体检 2.5s 超时、异步任务 4s 超时」这种同一系统两套耐心，
 * 进而让同一站点在两个入口得到不同结论。
 *
 * 三个 profile 的差异必须**只有下表列出的三项**（超时 / 体积 / 跳数），
 * 其余（协议白名单、SSRF、凭证剥离、逐跳校验）完全共用——由
 * `packages/ai/test/outbound-profile.test.ts` 断言。
 */
export interface OutboundProfile {
  /** 单次请求的硬超时（毫秒） */
  timeoutMs: number;
  /** 最多读取多少字节响应体（超出即标记 truncated） */
  maxBytes: number;
  /** 最多跟随几次重定向 */
  maxRedirects: number;
  /** 对外声明的 UA（部分站点按 UA 决定放行还是拦截） */
  userAgent: string;
}

/** 抓取正文（AI 富化 / 站点元数据）：愿意等，也要读完整页 */
export const FETCH_PROFILE = "fetch" as const;
/** 同步抽样体检：一次 30 条，需要较快返回 */
export const PROBE_PROFILE = "probe" as const;
/** 候选平替探活：只要证明「能打开且不是停放页」，2.5 秒足够 */
export const CANDIDATE_PROFILE = "candidate" as const;

export type OutboundProfileName = typeof FETCH_PROFILE | typeof PROBE_PROFILE | typeof CANDIDATE_PROFILE;

const UA = "NavHubBot/0.1 (+https://github.com/navhub)";

export const OUTBOUND_PROFILES: Record<OutboundProfileName, OutboundProfile> = {
  fetch: { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 6, userAgent: UA },
  probe: { timeoutMs: 4_000, maxBytes: 64 * 1024, maxRedirects: 4, userAgent: UA },
  candidate: { timeoutMs: 2_500, maxBytes: 8 * 1024, maxRedirects: 3, userAgent: UA },
};

export function outboundProfile(name: OutboundProfileName): OutboundProfile {
  return OUTBOUND_PROFILES[name];
}
