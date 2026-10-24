/**
 * LLM 额度闸门（每日预算 + 诚实降级）。
 *
 * 修的是「烧钥不设闸」这一族真实事故：
 *
 * 1. **公共站的匿名流量花的是运维者那把系统 key**。`recordLlmUsage` 以前只写不读，
 *    全站没有任何一处把用量和上限对照：一个脚本对着 `/api/copilot/chat`、
 *    `/api/enrich`、`/api/sites/:id/recommend-alternative` 循环，就能把运维者的
 *    账单打穿，而面板上只会多出几万行真实记录。按 IP 的 rateLimit 只挡得住「频率」，
 *    挡不住「一天内缓慢但持续的消耗」。
 * 2. **借他人密钥**：自报身份（`identityOf`）在某些部署里未经签名绑定就能走到
 *    `resolveLlm`，于是「自称 `github:<别人>`」= 花别人的额度，用量还记在别人账上。
 *
 * 口径（三条独立计数，任一命中即拒）：
 *   - `identity`：单个身份 24h 滚动窗口内的调用次数与 token（登录 userId / 匿名 anonId 都是身份）；
 *   - `anonymous`：没有身份（identity 为 NULL）的流量**合池**计数 —— 它不是「每人一份」，
 *     而是「所有无法归属的请求共享一份」，因为没有 anonId 的请求本身就没有可信的「每人」边界；
 *   - `system`：过去 24h 内所有**非用户自带 key**（source ≠ 'user'）的消耗合计，
 *     即运维者那把 key 的总预算。用户自带 key 的场景不计入这里，避免「一人配了 key
 *     就把全站额度吃掉」。
 *
 * 拒绝时给的是可执行的语义，不是一句「出错了」：`Retry-After` + 窗口重置时间 +
 * 用的是哪一档额度。调用方（前端）据此显示「今天的 AI 额度用完了，X 小时后恢复」，
 * 而不是把限制伪装成故障。
 *
 * 默认值（见 `config.ts` 的 `llmQuota`）刻意宽松：正常单人/小团队一天用不到上限，
 * 上限存在的意义是「无上限」这件事本身不可接受。设 0 = 关闭该档（老行为）。
 */
import type { AppContext } from "./context.ts";

/** 额度窗口：24h 滚动，避免「本地零点重置」带来的跨时区歧义与整点突发 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type LlmQuotaScope = "identity" | "anonymous" | "system";

export interface LlmQuotaState {
  scope: LlmQuotaScope;
  limit: number;
  used: number;
  /** 计量的是次数还是 token */
  metric: "calls" | "tokens";
  /** 窗口内最早一条用量到满 24h 的剩余时间（用于 Retry-After） */
  retryAfterMs: number;
}

export class LlmQuotaError extends Error {
  readonly statusCode = 429;
  readonly code = "llm_quota";
  readonly scope: LlmQuotaScope;
  readonly metric: "calls" | "tokens";
  readonly limit: number;
  readonly used: number;
  readonly retryAfterMs: number;

  constructor(state: LlmQuotaState) {
    super(
      state.metric === "calls"
        ? `今日 AI 调用次数已达上限（${state.used}/${state.limit}）`
        : `今日 AI token 已达上限（${state.used}/${state.limit}）`,
    );
    this.name = "LlmQuotaError";
    this.scope = state.scope;
    this.metric = state.metric;
    this.limit = state.limit;
    this.used = state.used;
    this.retryAfterMs = state.retryAfterMs;
  }

  /** 给 HTTP 层的最小响应体：前端据此区分「额度限制」与「模型故障」 */
  toResponseBody() {
    return {
      error: this.message,
      code: this.code,
      quota: {
        scope: this.scope,
        metric: this.metric,
        limit: this.limit,
        used: this.used,
        retryAfterSeconds: Math.max(1, Math.ceil(this.retryAfterMs / 1000)),
      },
    };
  }
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * 检查额度并返回结论。
 *
 * `identity` 必须是**本次实际会用来取密钥的那个身份**（`identityTrusted` 闸门之后
 * 的值），不能是未校验的自报串 —— 否则「按身份限流」本身就变成可绕的：
 * 每次换一个假身份就等于重置一次额度。
 */
export async function checkLlmQuota(
  ctx: AppContext,
  identity: string | null | undefined,
): Promise<{ ok: true } | { ok: false; error: LlmQuotaError }> {
  const cfg = ctx.config.llmQuota;
  const since = Date.now() - WINDOW_MS;
  const named = typeof identity === "string" && identity.length > 0 ? identity : null;

  // 第一档：单身份（含匿名 anonId，它也是身份字符串）
  if (named && (cfg.identityDailyCalls > 0 || cfg.identityDailyTokens > 0)) {
    const used = await ctx.repo.sumLlmUsage({ since, identity: named });
    const block = evaluate("identity", used, cfg.identityDailyCalls, cfg.identityDailyTokens, since);
    if (block) return { ok: false, error: block };
  }

  // 第二档：无法归属的流量合池（identity IS NULL）
  if (!named && (cfg.anonymousDailyCalls > 0 || cfg.anonymousDailyTokens > 0)) {
    const used = await ctx.repo.sumLlmUsage({ since, identity: null });
    const block = evaluate("anonymous", used, cfg.anonymousDailyCalls, cfg.anonymousDailyTokens, since);
    if (block) return { ok: false, error: block };
  }

  // 第三档：运维者那把 key 的总预算（只数 source ≠ 'user' 的消耗）
  if (cfg.systemDailyCalls > 0 || cfg.systemDailyTokens > 0) {
    const used = await ctx.repo.sumLlmUsage({ since, excludeUserSource: true });
    const block = evaluate("system", used, cfg.systemDailyCalls, cfg.systemDailyTokens, since);
    if (block) return { ok: false, error: block };
  }

  return { ok: true };

  function evaluate(
    scope: LlmQuotaScope,
    used: { calls: number; tokens: number; firstAt: number | null },
    maxCalls: number,
    maxTokens: number,
    windowStart: number,
  ): LlmQuotaError | null {
    const limitCalls = clampNonNegative(maxCalls);
    const limitTokens = clampNonNegative(maxTokens);
    // 重置时间以窗口内**最早一条**为准：额度是滚动消耗的，最早那条一过期就腾出空间，
    // 比「now + 24h」诚实（后者会让用户白等半天）。没有任何记录时不该走到这里。
    const retryAfterMs = used.firstAt && used.firstAt > windowStart
      ? Math.max(0, used.firstAt + WINDOW_MS - Date.now())
      : WINDOW_MS;

    if (limitCalls > 0 && used.calls >= limitCalls) {
      return new LlmQuotaError({ scope, metric: "calls", limit: limitCalls, used: used.calls, retryAfterMs });
    }
    if (limitTokens > 0 && used.tokens >= limitTokens) {
      return new LlmQuotaError({ scope, metric: "tokens", limit: limitTokens, used: used.tokens, retryAfterMs });
    }
    return null;
  }
}

/** 拒绝时的 HTTP 落地：状态码 + Retry-After + 结构化额度信息 */
export function replyQuotaBlocked(reply: import("fastify").FastifyReply, error: LlmQuotaError) {
  reply.code(429);
  reply.header("retry-after", String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
  reply.header("cache-control", "no-store");
  return error.toResponseBody();
}
