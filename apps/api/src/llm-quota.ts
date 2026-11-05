/**
 * LLM 额度闸门（每日预算 + 原子预留 + 诚实降级）。
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
 * 3. **先查后写的并发缝**（P0-3 新增）。闸门原本只有两步：读窗口用量、在 JS 里比上限。
 *    两步之间隔着 await，20 个并发请求会同时看到「还没超」并全部放行——上限 5 的档位
 *    实际放出去 20 次调用。单请求视角每一步都对，所以串行写的单元测试永远发现不了它。
 *    现在判定与占位在 `repo.reserveLlmQuota` 的同一个事务里完成（SQLite `BEGIN IMMEDIATE`，
 *    PG 额外一把跨进程 advisory 锁），并发请求看到的是彼此已申报的额度。
 *
 * 口径（三条独立计数，任一命中即拒；每条都是「已落账用量 + 在途预留」vs 上限）：
 *   - `identity`：单个身份 24h 滚动窗口内的调用次数与 token（登录 userId / 匿名 anonId 都是身份）；
 *   - `anonymous`：没有身份（identity 为 NULL）的流量**合池**计数 —— 它不是「每人一份」，
 *     而是「所有无法归属的请求共享一份」，因为没有 anonId 的请求本身就没有可信的「每人」边界；
 *   - `system`：过去 24h 内所有**非用户自带 key**（source ≠ 'user'）的消耗合计，
 *     即运维者那把 key 的总预算。用户自带 key 的场景不计入这里，避免「一人配了 key
 *     就把全站额度吃掉」。
 *
 * 预留的生命周期：`reserveLlmQuota` 成功 → 拿到一个 hold；调用方**必须**在 `finally`
 * 里 `settleLlmQuota`。删行即结算——真实数字由 `llm_usage` 说话，预留不参与成本统计，
 * 避免同一笔消耗记两次。进程被 kill / SSE 半路断开这些来不及结算的行由 TTL 兜底，
 * 下一次预留顺手回收，所以「忘了释放」最坏也只占住额度 `reserveTtlMs` 毫秒。
 *
 * 拒绝时给的是可执行的语义，不是一句「出错了」：`Retry-After` + 窗口重置时间 +
 * 用的是哪一档额度 + 是被真实用量挡住还是在途预留挡住。调用方（前端）据此显示
 * 「今天的 AI 额度用完了，X 小时后恢复」，而不是把限制伪装成故障。
 *
 * 默认值（见 `config.ts` 的 `llmQuota`）刻意宽松：正常单人/小团队一天用不到上限，
 * 上限存在的意义是「无上限」这件事本身不可接受。设 0 = 关闭该档（老行为）。
 */
import type { AppContext } from "./context.ts";
import type { LlmQuotaReservationRecord, LlmQuotaTier } from "@navhub/store";
import { recordLlmQuotaRejected, recordLlmQuotaSettleFailure } from "./metrics.ts";

/** 额度窗口：24h 滚动，避免「本地零点重置」带来的跨时区歧义与整点突发 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type LlmQuotaScope = "identity" | "anonymous" | "system";

/**
 * 一次成功预留换来的持有权柄。
 *
 * null = 三档全关（没写库，也就无需结算）：这样「测试环境默认关闭额度」
 * 不会在表里留下几百万行没人认领的占位。
 */
export type LlmQuotaHold = LlmQuotaReservationRecord | null;

export interface LlmQuotaState {
  scope: LlmQuotaScope;
  limit: number;
  used: number;
  /** 计量的是次数还是 token */
  metric: "calls" | "tokens";
  /** 拒绝来自已落账用量、在途预留，还是两者叠加 */
  blockedBy: "usage" | "reservation" | "both";
  /** 窗口重置 / 最早预留到期中较早的那个（用于 Retry-After） */
  retryAfterMs: number;
}

export class LlmQuotaError extends Error {
  readonly statusCode = 429;
  readonly code = "llm_quota";
  readonly scope: LlmQuotaScope;
  readonly metric: "calls" | "tokens";
  readonly limit: number;
  readonly used: number;
  readonly blockedBy: "usage" | "reservation" | "both";
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
    this.blockedBy = state.blockedBy;
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
        blockedBy: this.blockedBy,
        retryAfterSeconds: Math.max(1, Math.ceil(this.retryAfterMs / 1000)),
      },
    };
  }
}

/**
 * 把 config 的六个数字摊成三档。
 *
 * `source === 'user'` 时不生成系统档：用户自带 key 的消耗不该吃运维者预算，
 * 这一条在预留侧必须和 `llm_usage` 的 `excludeUserSource` 口径一一对应，
 * 否则「查的时候不算、占的时候算」会让系统档凭空紧一截。
 */
function buildTiers(ctx: AppContext, identity: string | null, source: string): LlmQuotaTier[] {
  const cfg = ctx.config.llmQuota;
  const tiers: LlmQuotaTier[] = [];
  if (identity) {
    if (cfg.identityDailyCalls > 0 || cfg.identityDailyTokens > 0) {
      tiers.push({
        scope: "identity",
        identity,
        maxCalls: cfg.identityDailyCalls,
        maxTokens: cfg.identityDailyTokens,
      });
    }
  } else if (cfg.anonymousDailyCalls > 0 || cfg.anonymousDailyTokens > 0) {
    tiers.push({
      scope: "anonymous",
      identity: null,
      maxCalls: cfg.anonymousDailyCalls,
      maxTokens: cfg.anonymousDailyTokens,
    });
  }
  const systemEnabled = source !== "user" && (cfg.systemDailyCalls > 0 || cfg.systemDailyTokens > 0);
  if (systemEnabled) {
    tiers.push({
      scope: "system",
      // identity 省略 = 全量（按 source 过滤），与 sumLlmUsage 的三态口径一致
      excludeUserSource: true,
      maxCalls: cfg.systemDailyCalls,
      maxTokens: cfg.systemDailyTokens,
    });
  }
  return tiers;
}

/**
 * 预留额度并返回结论。
 *
 * `identity` 必须是**本次实际会用来取密钥的那个身份**（`identityTrusted` 闸门之后
 * 的值），不能是未校验的自报串 —— 否则「按身份限流」本身就变成可绕的：
 * 每次换一个假身份就等于重置一次额度。
 *
 * `source` 省略时按 `"system"` 申报（最保守）。这是因为调用点普遍在闸门**之后**
 * 才 `resolveLlm`、才知道用的是谁的 key；宁可让在途的用户自带 key 临时占住系统档
 * 几秒（占用量受并发数约束，且结算即释放），也不要「以为知道是 user、于是完全不占」
 * 那种会放过脚本的乐观假设。已经拿到 key 来源的调用方应当显式传。
 */
export async function reserveLlmQuota(
  ctx: AppContext,
  identity: string | null | undefined,
  options?: { estimatedTokens?: number; source?: string; reservedCalls?: number },
): Promise<{ ok: true; hold: LlmQuotaHold } | { ok: false; error: LlmQuotaError }> {
  const cfg = ctx.config.llmQuota;
  const named = typeof identity === "string" && identity.length > 0 ? identity : null;
  const source = options?.source ?? "system";
  const tiers = buildTiers(ctx, named, source);

  // 三档全关（测试环境的默认）就别开事务：留一行没人结算的预留，
  // 既让 llm_quota_reservations 白长，也让观测上的 active 变成噪音。
  if (tiers.length === 0) return { ok: true, hold: null };

  const result = await ctx.repo.reserveLlmQuota({
    identity: named,
    source,
    reservedCalls: options?.reservedCalls ?? 1,
    reservedTokens: Number.isFinite(options?.estimatedTokens)
      ? Math.floor(options!.estimatedTokens as number)
      : cfg.reserveTokens,
    windowMs: WINDOW_MS,
    ttlMs: cfg.reserveTtlMs,
    tiers,
  });

  if (result.ok) return { ok: true, hold: result.reservation };

  const blocked = result.blocked;
  const scope = (["identity", "anonymous", "system"] as const).includes(blocked.scope as LlmQuotaScope)
    ? (blocked.scope as LlmQuotaScope)
    : "identity";
  recordLlmQuotaRejected(scope, blocked.metric, blocked.blockedBy !== "usage");
  return {
    ok: false,
    error: new LlmQuotaError({
      scope,
      metric: blocked.metric,
      limit: blocked.limit,
      used: blocked.used,
      blockedBy: blocked.blockedBy,
      retryAfterMs: blocked.retryAfterMs,
    }),
  };
}

/**
 * 结算一次预留：删掉占位行，把额度交还给下一个并发请求。
 *
 * 它在 `finally` 里跑，所以**永不抛出**——一次删库失败不能让原本已经成功的
 * SSE 响应变成 500，也不能把真正的异常盖掉。失败计入
 * `navhub_llm_quota_settle_failures_total`，那行只能等 TTL 回收。
 */
export async function settleLlmQuota(ctx: AppContext, hold: LlmQuotaHold | undefined): Promise<boolean> {
  if (!hold) return false;
  try {
    return await ctx.repo.settleLlmQuotaReservation(hold.id);
  } catch {
    recordLlmQuotaSettleFailure();
    return false;
  }
}

/** 拒绝时的 HTTP 落地：状态码 + Retry-After + 结构化额度信息 */
export function replyQuotaBlocked(reply: import("fastify").FastifyReply, error: LlmQuotaError) {
  reply.code(429);
  reply.header("retry-after", String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
  reply.header("cache-control", "no-store");
  return error.toResponseBody();
}
