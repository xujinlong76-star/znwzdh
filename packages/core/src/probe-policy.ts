/**
 * 探活判定的**唯一事实源**。
 *
 * 背景（真实缺陷）：同一个问题「这个 URL 算不算活着」在本仓被写了三遍——
 *   1. `apps/api/src/plugin-audit.ts` 的 `BLOCKED_BY_BOT_STATUSES` + `summarizeProbes`
 *   2. `apps/api/src/routes/plugin-audit.ts` 的 `classifyProbeFailure` / `classifyProbeStatus`
 *   3. `packages/core/src/url-deep-diagnose.ts` 的 5xx / 机器人拦截 / 4xx 三个分支
 *
 * 三套口径各自演化，就出现了「超时判死」和「5xx 判死」两次事故：候选列表说
 * 「不可达（站点已确认下线）」，深检却说「服务端异常，可能维护或过载」。
 *
 * 这里把判定收敛成一张表。三个消费方都只做「读结论 + 翻译成本层词汇」，
 * 不再各自判断。新增状态码或异常类型时**只改这一个文件**。
 *
 * 口径（与全仓三分类一致）：
 *   - 只有「页面确定不存在」才允许说死：404 / 410 / 451、域名不解析、端口拒绝、
 *     证书无效、跳转成环、SSRF 拒绝；
 *   - 超时、连接中断、5xx、其余 4xx 都是「没测准 / 此刻不可用」，一律 unverified，
 *     文案里必须写明「不等于站点已死」，避免被读成死亡通知。
 */

/** 探活结论的原子分类 */
export type ProbeOutcomeKind =
  | "ok" // 2xx/3xx 且内容未判定为异常
  | "blocked" // 存活但拒绝爬虫（WAF/风控）
  | "parked" // 域名停放 / 软 404（内容层证据）
  | "dead" // 已确认失效
  | "unverified" // 没测准：超时、连接中断、4xx 拒绝
  | "server-error"; // 5xx：服务端此刻异常

export interface ProbeOutcome {
  kind: ProbeOutcomeKind;
  /** 面向运营的中文原因。禁止外露原始 err.message（含内部地址与英文堆栈） */
  reason: string;
  /** HTTP 状态码（有响应时才有） */
  status?: number;
}

/** 候选平替的四档（+ 已死），面板与排序共用 */
export type CandidateGrade = "verified" | "blocked" | "unverified" | "suspicious" | "dead";

/**
 * 「服务端活着、只是拒绝爬虫」的状态码。
 *
 * 401 未授权 / 403 禁止 / 405 方法不允许 / 412 前置条件失败 / 429 限流 / 418 茶壶。
 * 418 之所以算：Cloudflare/Akamai 一类 WAF 常拿它回应「我识别出你是爬虫」，
 * 实测 shop.lululemon.com、www.underarmour.com 返回 418，浏览器里完全正常。
 * 400 不算：请求格式错误与风控拦截都会返回 400，无法区分，宁可留给人工复核。
 */
export const BOT_BLOCKED_STATUSES: readonly number[] = [401, 403, 405, 412, 418, 429];

/** 「页面确定不存在」的状态码。451 = 因法律原因不可用。 */
export const CONFIRMED_GONE_STATUSES: readonly number[] = [404, 410, 451];

export function isBotBlockedStatus(status: number): boolean {
  return BOT_BLOCKED_STATUSES.includes(status);
}

/**
 * HTTP 状态码 → 探活结论。1xx–3xx 返回 null：不是失败，交回调用方继续做内容判定。
 *
 * 注意顺序：机器人拦截必须先于「≥400」判断，否则 403 会被算成一次普通 4xx，
 * 把「WAF 挡我」写成「请求被拒绝」。
 */
export function classifyProbeStatus(status: number): ProbeOutcome | null {
  if (!Number.isFinite(status) || status < 400) return null;

  if (isBotBlockedStatus(status)) {
    return { kind: "blocked", status, reason: `HTTP ${status}：拒绝爬虫，无法验证内容` };
  }
  if (CONFIRMED_GONE_STATUSES.includes(status)) {
    return { kind: "dead", status, reason: `HTTP ${status}：页面不存在或已下线` };
  }
  if (status >= 500) {
    return {
      kind: "server-error",
      status,
      reason: `HTTP ${status}：服务端暂时不可用，未能确认可用性（不等于站点已死）`,
    };
  }
  if (status === 408) {
    return { kind: "unverified", status, reason: "HTTP 408：服务端等待请求超时，未能确认可用性" };
  }
  return { kind: "unverified", status, reason: `HTTP ${status}：请求被目标拒绝，未能确认可用性` };
}

export interface ProbeErrorContext {
  /** 本次探测实际耗时（毫秒） */
  elapsedMs: number;
  /** 本次探测的超时上限（毫秒） */
  timeoutMs: number;
  /** 仅用于服务端日志，不会外泄给前端 */
  url?: string;
}

/**
 * 异常 → 探活结论。
 *
 * 顺序有讲究：先认「我方抛出的中文错误」（语义明确），再看底层 errno，
 * 最后才用耗时兜底判超时。耗时判据必须 ≥0.95×上限——很多运行时在超时后
 * 抛的是 `fetch failed` / `socket hang up`，消息里根本没有 timeout 字样。
 */
export function classifyProbeError(err: unknown, ctx: ProbeErrorContext): ProbeOutcome {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();

  if (raw.includes("DNS 解析失败") || raw.includes("DNS 无结果") || msg.includes("enotfound") || msg.includes("eai_again")) {
    return { kind: "dead", reason: "域名无法解析（域名可能已过期或不存在）" };
  }
  if (raw.includes("重定向次数超过")) {
    return { kind: "dead", reason: "重定向次数过多，浏览器同样会报错" };
  }
  if (raw.includes("受保护网段") || raw.includes("禁止访问该端口") || raw.includes("仅允许 http")) {
    return { kind: "dead", reason: "目标指向内网或非法地址，已拒绝探测" };
  }
  if (msg.includes("certificate") || msg.includes("ssl") || msg.includes("tls") || msg.includes("self-signed")) {
    return { kind: "dead", reason: "HTTPS 证书无效，浏览器会拦截" };
  }
  if (msg.includes("econnrefused")) {
    return { kind: "dead", reason: "连接被拒绝（目标端口无服务）" };
  }

  const isTimeout =
    ctx.elapsedMs >= ctx.timeoutMs * 0.95 ||
    msg.includes("timeout") ||
    msg.includes("timedout") ||
    msg.includes("aborted");
  if (isTimeout) {
    return {
      kind: "unverified",
      reason: `${(ctx.timeoutMs / 1000).toFixed(1)} 秒内未响应（慢不等于死，建议稍后复检）`,
    };
  }

  // 其余（连接被重置、socket hang up、底层 fetch failed）可能只是网络抖动或对端限速。
  // 原始文本含内部地址，只进服务端日志。
  if (ctx.url) {
    console.warn(`[probe-policy] 未能判定 url=${ctx.url} err=${raw.slice(0, 200)}`);
  }
  return { kind: "unverified", reason: "连接中断，未能确认可达性" };
}

const KIND_TO_GRADE: Record<ProbeOutcomeKind, CandidateGrade> = {
  ok: "verified",
  blocked: "blocked",
  parked: "suspicious",
  dead: "dead",
  // 5xx 与超时同级：都不是「确认失效」，只是这一刻没测准
  "server-error": "unverified",
  unverified: "unverified",
};

/** 探活结论 → 候选平替档位 */
export function outcomeToCandidateGrade(kind: ProbeOutcomeKind): CandidateGrade {
  return KIND_TO_GRADE[kind];
}

/** 深检层的 HTTP 结论词汇（null = 交给内容层继续判） */
export type ProbeHttpVerdict = "server-error" | "bot-blocked" | "http-error" | null;

/** 探活结论 → 深检 HTTP 层结论。让深检与候选列表说的是同一件事。 */
export function outcomeToHttpVerdict(kind: ProbeOutcomeKind): ProbeHttpVerdict {
  if (kind === "server-error") return "server-error";
  if (kind === "blocked") return "bot-blocked";
  if (kind === "dead" || kind === "unverified") return "http-error";
  return null;
}
