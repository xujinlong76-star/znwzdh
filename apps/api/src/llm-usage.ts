/**
 * LLM 用量采集与统一执行网关适配器。
 *
 * 目标：
 *  1. 所有向大模型的真实调用（Copilot 对话、工作台生成、元数据富化、连通性探测、健康巡检）
 *     统一在此记录真实延迟、Token 用量与成功/失败状态；
 *  2. 杜绝任何前端观测大盘数据伪造，确保每一条展示在面板上的记录都有源可溯；
 *  3. 兼容备用模型池自动轮换（Fallback Rotation）。
 */
import {
  chatCompletion,
  chatStream,
  isRetryableLlmCode,
  LlmError,
  RetryBudget,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type LlmProvider,
  type LlmStreamEvent,
} from "@navhub/ai";
import type { AppContext } from "./context.ts";
import { llmProviderReady, type ResolvedLlm } from "./llm-config.ts";
import { resolveLlmPrice } from "./llm-prices.ts";

export interface CallLlmOptions {
  scenario: "copilot" | "ai_chat" | "canvas" | "health_audit" | "config_test" | "enrich" | string;
  identity?: string | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  tools?: unknown[];
  toolChoice?: unknown;
  thinking?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** 单次调用的超时时间（毫秒），未指定时使用 provider.timeoutMs */
  timeoutMs?: number;
  /**
   * 端到端截止时间点（`Date.now()` 毫秒）。含备用池轮换在内的全部尝试
   * 共享这一个预算；耗尽即失败，见 packages/ai/src/deadline.ts 的说明。
   */
  deadlineAt?: number;
  /**
   * 备用池轮换退避的接缝（默认真实等待 + `Math.random` 抖动）。
   * 与 `fetchImpl` 同类的注入点，供守卫测试断言等待行为而不测墙钟。
   */
  backoff?: Partial<LlmBackoffHooks>;
  /**
   * 轮换预算（默认进程级共享的那只）。
   *
   * 之所以留注入点：它是「过去 windowMs 内重试/成功比」的滑动窗口，判定结果取决于
   * 时序与别的用例留下的事件——同一文件里的多个轮换用例会互相抢同一份配额
   * （实测第 6 次轮换被判「不可重试」，红的是测试顺序而不是代码）。生产路径不传。
   */
  retryBudget?: RetryBudget;
}

/**
 * 交互式对话（copilot / ai_chat）的默认总预算。
 *
 * 深度思考单次请求可跑到 60s，备用池还能再轮换两家：不设总闸门时最坏等待
 * 是「3 个 provider × 60s」，用户早已离开而中枢仍在计费。120s 取「还愿意等」
 * 与「主模型失败后备用池仍有整整一个单调用窗口」的交点。
 */
export const INTERACTIVE_LLM_BUDGET_MS = 120_000;

/**
 * 备用池重试预算（进程级）。
 *
 * 一个请求打几个 provider 由「这一刻整体健不健康」决定，而不是由单个请求决定：
 * 上游大面积故障时，若每个请求都把整池试完，重试会把一次故障放大成雪崩。
 * 窗口内重试占比超过阈值即停止轮换，让请求快速失败。
 */
const fallbackRetryBudget = new RetryBudget({ ratio: 0.2, minRetries: 5, windowMs: 10_000, maxRetries: 50 });

/** 本地退避：首家用 500ms 量级，每失败一家翻倍，单次封顶 10s（备用池最多 3 家） */
const LLM_BACKOFF_BASE_MS = 500;
const LLM_BACKOFF_MAX_MS = 10_000;
/** 等待之后至少要给下一次请求留出的余量；放不下就不值得再等 */
const LLM_RETRY_MIN_HEADROOM_MS = 1_000;

export interface LlmRetryPlan {
  /** 是否继续轮换下一个候选 */
  proceed: boolean;
  /** 继续之前需要等待的毫秒数；proceed=false 时恒为 0 */
  waitMs: number;
  /** 等待值的来源：服务端建议 / 本地指数退避 / 决定不再重试 */
  source: "server" | "backoff" | "stop";
}

/**
 * 轮换备用池之前的等待决策。
 *
 * 三条判据按优先级：
 *  1. 服务端给了 `retryAfterMs` 就按它等。比服务端允许的时间更早重试不会成功，
 *     且失败请求同样计入配额（越打越糟）；建议值超出本进程能承受的封顶时
 *     **不缩短后照打**，而是放弃轮换——把 90s 压成 10s 再发一次，只是用一次
 *     注定失败的请求换一点虚假进度。
 *  2. 没下发头时按指数退避 + 抖动（抖动取值区间为 `[0.5×上限, 上限]`）。轮换是
 *     进程级行为，没有抖动时同一时刻的成千个请求会齐步走进同一家备用网关。
 *  3. 端到端预算优先于以上两条：等待吃的是用户等待时间，剩余预算连一次带余量
 *     的请求都放不下时，等下去只会把失败推迟到用户已经离开之后。
 */
export function planLlmRetryWait(input: {
  retryAfterMs?: number;
  /** 本次请求内已失败的候选数（从 1 开始） */
  failures: number;
  deadlineAt?: number;
  now?: number;
  random?: () => number;
}): LlmRetryPlan {
  const random = input.random ?? Math.random;
  const remaining = input.deadlineAt === undefined ? Number.POSITIVE_INFINITY : input.deadlineAt - (input.now ?? Date.now());
  const serverMs =
    typeof input.retryAfterMs === "number" && Number.isFinite(input.retryAfterMs) && input.retryAfterMs >= 0
      ? Math.round(input.retryAfterMs)
      : undefined;

  let waitMs: number;
  if (serverMs !== undefined) {
    if (serverMs > LLM_BACKOFF_MAX_MS) return { proceed: false, waitMs: 0, source: "stop" };
    waitMs = serverMs;
  } else {
    const attempt = Math.max(1, Math.floor(input.failures));
    const ceiling = Math.min(LLM_BACKOFF_BASE_MS * 2 ** (attempt - 1), LLM_BACKOFF_MAX_MS);
    waitMs = Math.round(ceiling * (0.5 + random() * 0.5));
  }

  if (Number.isFinite(remaining) && remaining <= waitMs + LLM_RETRY_MIN_HEADROOM_MS) {
    return { proceed: false, waitMs: 0, source: "stop" };
  }
  return { proceed: true, waitMs, source: serverMs !== undefined ? "server" : "backoff" };
}

/**
 * 可中断的等待。signal 已中断或等待期间中断时返回 false。
 *
 * 监听器在正常醒来时主动移除：这是常驻进程，每次重试挂一个不清理的 abort
 * 监听器会随请求数线性泄漏。
 */
export async function sleepAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return !signal?.aborted;
  if (signal?.aborted) return false;
  return await new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 等待实现与抖动源的可注入接缝：守卫测试据此断言「等了、等了多久」而不测墙钟 */
export interface LlmBackoffHooks {
  sleep: (ms: number, signal?: AbortSignal) => Promise<boolean>;
  random: () => number;
}

/**
 * 封装带用量记录的模型调用
 */
export async function callLlm(
  ctx: AppContext,
  resolved: ResolvedLlm,
  opts: CallLlmOptions,
): Promise<ChatResult> {
  const baseChatOpts: Omit<ChatOptions, "thinking"> = {
    messages: opts.messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    json: opts.json,
    tools: opts.tools,
    toolChoice: opts.toolChoice,
    signal: opts.signal,
    deadlineAt: opts.deadlineAt,
    fetchImpl: opts.fetchImpl,
  };

  const candidates: Array<{ provider: LlmProvider; source: string }> = [
    { provider: resolved.provider, source: resolved.source },
    ...resolved.fallbacks.map((fb) => ({ provider: fb, source: "fallback" })),
  ];
  const backoff: LlmBackoffHooks = {
    sleep: opts.backoff?.sleep ?? sleepAbortable,
    random: opts.backoff?.random ?? Math.random,
  };
  const budget = opts.retryBudget ?? fallbackRetryBudget;

  let lastError: unknown = null;
  let failures = 0;
  for (const { provider, source } of candidates) {
    /**
     * 总预算耗尽 ⇒ 不再发起任何请求。闸门放在最前：备用池轮换是「用户等待时间的乘法」，
     * 前一次慢调用把预算烧完后，再打下一个 provider 只会把失败推迟到用户已经离开之后。
     */
    if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) {
      lastError ??= new LlmError("timeout", "模型调用已超出总预算");
      break;
    }
    // 无密钥但显式放行内网的本地网关（Ollama 等）同样可调用
    if (!llmProviderReady(provider)) continue;
    /**
     * 换下一家之前先等（决策见 planLlmRetryWait）。等待放在轮次开头而不是失败的
     * catch 里：最后一家失败之后已经没有候选可打，在那里等待等于让用户白等。
     */
    if (failures > 0) {
      const plan = planLlmRetryWait({
        retryAfterMs: lastError instanceof LlmError ? lastError.retryAfterMs : undefined,
        failures,
        deadlineAt: opts.deadlineAt,
        random: backoff.random,
      });
      if (!plan.proceed) break;
      /**
       * 等待期间用户按下「停止」⇒ 立刻停，与上面 aborted 分支同一口径：
       * 不打下一家，也不再多记一行失败用量。
       */
      if (!(await backoff.sleep(plan.waitMs, opts.signal))) break;
    }
    // 深度思考：调用点显式指定优先，否则用该 provider 的配置默认值（产品默认开）
    const thinking = opts.thinking ?? provider.thinking ?? true;
    const chatOpts: ChatOptions = { ...baseChatOpts, thinking };
    const effectiveProvider: LlmProvider = opts.timeoutMs
      ? { ...provider, timeoutMs: Math.max(provider.timeoutMs ?? 20_000, opts.timeoutMs) }
      : provider;
    const startedAt = Date.now();
    try {
      const res = await chatCompletion(effectiveProvider, chatOpts);
      const latencyMs = res.latencyMs || (Date.now() - startedAt);
      budget.recordSuccess();

      await ctx.repo.recordLlmUsage({
        scenario: opts.scenario,
        source,
        model: res.model || provider.model,
        identity: opts.identity,
        promptTokens: res.usage?.promptTokens,
        completionTokens: res.usage?.completionTokens,
        latencyMs,
        ok: true,
        // 端点拒收思维链参数时会去参重试；记账必须按「实际下发」而不是「请求了」，
        // 否则大盘的「思考调用数」把没思考的调用也算进去了。
        thinking: res.thinkingApplied ?? thinking,
        // 单价快照按「实际应答的模型」取：备用池换过家时，主模型的价格不适用
        price: await resolveLlmPrice(ctx, res.model || provider.model),
      });

      return res;
    } catch (err) {
      lastError = err;
      /**
       * 调用方已经取消 ⇒ 立刻停：
       * ① 不再打备用模型池（此前会接着最多 3 个 provider、每个再等 60 秒，
       *    用户按下「停止」之后中枢还在花钱）；
       * ② 不写 ok:false 的用量行——取消不是模型坏，记进来会把
       *    「用户等太久放弃」算进大盘失败率，让真实故障被稀释。
       */
      if (opts.signal?.aborted) break;
      /**
       * 上游网关把「取消」当 200 正常回答返回（content = 用户已取消）时，
       * 这里会收到 code=cancelled。它不是模型故障：
       * ① 不打备用池——再打一次只会再拿到一条取消提示或重复回答；
       * ② 不写 ok:false 的用量行——取消不是失败，记进来会稀释真实故障率。
       */
      if (err instanceof LlmError && err.code === "cancelled") break;
      const latencyMs = Date.now() - startedAt;
      const errorCode = err instanceof LlmError ? err.code : "unknown";

      await ctx.repo.recordLlmUsage({
        scenario: opts.scenario,
        source,
        model: provider.model,
        identity: opts.identity,
        latencyMs,
        ok: false,
        errorCode,
        thinking,
        price: await resolveLlmPrice(ctx, provider.model),
      });
      /**
       * 换 provider 只对「这家现在不行」有意义，且必须过预算闸门：
       *  - 鉴权/配置/坏响应/取消换谁都一样，继续打只是给用户加等待、给大盘加失败行；
       *  - 预算耗尽意味着池子整体不健康（重试占比过高），再轮换是放大故障而不是吸收故障。
       */
      if (!isRetryableLlmCode(errorCode, err instanceof LlmError ? err.status : undefined)) break;
      if (!budget.canRetry()) break;
      budget.recordRetry();
      // 这里只记「决定再打一家」；实际等待在下一轮开头做，见上面的 planLlmRetryWait
      failures += 1;
    }
  }

  if (lastError) throw lastError;
  throw new LlmError("config", "当前未配置有效的模型 API 密钥");
}

/**
 * 流式调用的选项：与 callLlm 同一套预算/身份/取消语义。
 * JSON 模式没有流式等价物（结构化生成必须看到完整文本才能校验），故不接收。
 */
export type CallLlmStreamOptions = Omit<CallLlmOptions, "json" | "tools" | "toolChoice">;

/**
 * 流式版 callLlm：用量、预算、轮换、取消四条语义与非流式对齐。
 *
 * 轮换只允许发生在「第一个正文分块之前」：一旦有字节发给用户，再换一家模型
 * 只会让界面出现两段拼接的回答；此时失败按该跳失败记账并原样抛出，由路由层
 * 决定是降级兜底还是报错。
 *
 * 取消（客户端 abort / 上游取消哨兵）不写 llm_usage：与非流式同口径，
 * 取消不是模型坏，记进失败率会把真实故障稀释掉。
 */
export async function* callLlmStream(
  ctx: AppContext,
  resolved: ResolvedLlm,
  opts: CallLlmStreamOptions,
): AsyncGenerator<LlmStreamEvent, void, unknown> {
  const baseChatOpts: Omit<ChatOptions, "thinking"> = {
    messages: opts.messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    signal: opts.signal,
    deadlineAt: opts.deadlineAt,
    fetchImpl: opts.fetchImpl,
  };

  const candidates: Array<{ provider: LlmProvider; source: string }> = [
    { provider: resolved.provider, source: resolved.source },
    ...resolved.fallbacks.map((fb) => ({ provider: fb, source: "fallback" })),
  ];
  const backoff: LlmBackoffHooks = {
    sleep: opts.backoff?.sleep ?? sleepAbortable,
    random: opts.backoff?.random ?? Math.random,
  };
  const budget = opts.retryBudget ?? fallbackRetryBudget;

  let lastError: unknown = null;
  let failures = 0;
  for (const { provider, source } of candidates) {
    if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) {
      lastError ??= new LlmError("timeout", "模型流式调用已超出总预算");
      break;
    }
    if (!llmProviderReady(provider)) continue;
    /** 与非流式同一套等待决策（见 callLlm）；此时还没有字节出门，等待可被「停止」打断 */
    if (failures > 0) {
      const plan = planLlmRetryWait({
        retryAfterMs: lastError instanceof LlmError ? lastError.retryAfterMs : undefined,
        failures,
        deadlineAt: opts.deadlineAt,
        random: backoff.random,
      });
      if (!plan.proceed) break;
      if (!(await backoff.sleep(plan.waitMs, opts.signal))) break;
    }
    const thinking = opts.thinking ?? provider.thinking ?? true;
    const chatOpts: ChatOptions = { ...baseChatOpts, thinking };
    const effectiveProvider: LlmProvider = opts.timeoutMs
      ? { ...provider, timeoutMs: Math.max(provider.timeoutMs ?? 20_000, opts.timeoutMs) }
      : provider;
    const startedAt = Date.now();
    let emitted = false;
    try {
      for await (const event of chatStream(effectiveProvider, chatOpts)) {
        // reasoning 也算「已经开流」：思考链已经推给用户，此时换模型会把
        // 两家模型的推理过程拼成一段，比失败更糟
        if (event.type === "delta" || event.type === "reasoning") emitted = true;
        if (event.type === "end") {
          budget.recordSuccess();
          await ctx.repo.recordLlmUsage({
            scenario: opts.scenario,
            source,
            model: event.model || provider.model,
            identity: opts.identity,
            promptTokens: event.usage?.promptTokens,
            completionTokens: event.usage?.completionTokens,
            latencyMs: Date.now() - startedAt,
            ok: true,
            // 网关按「实际是否下发思维链参数」回报，不用请求值冒充
            thinking: event.thinkingApplied,
            price: await resolveLlmPrice(ctx, event.model || provider.model),
          });
        }
        yield event;
      }
      return;
    } catch (err) {
      lastError = err;
      // 客户端取消 / 上游取消：不打备用池、不写失败用量（与非流式同口径）
      if (opts.signal?.aborted) throw err;
      if (err instanceof LlmError && err.code === "cancelled") throw err;
      const latencyMs = Date.now() - startedAt;
      const errorCode = err instanceof LlmError ? err.code : "unknown";
      await ctx.repo.recordLlmUsage({
        scenario: opts.scenario,
        source,
        model: provider.model,
        identity: opts.identity,
        latencyMs,
        ok: false,
        errorCode,
        thinking,
        price: await resolveLlmPrice(ctx, provider.model),
      });
      // 已经把内容发出去再换模型 = 两段回答拼接，只能原样失败
      if (emitted) throw err;
      if (!isRetryableLlmCode(errorCode, err instanceof LlmError ? err.status : undefined)) throw err;
      if (!budget.canRetry()) throw err;
      budget.recordRetry();
      failures += 1;
    }
  }

  if (lastError) throw lastError;
  throw new LlmError("config", "当前未配置有效的模型 API 密钥");
}

/**
 * 构造用于 enrichSiteWithLlm 的用量回调
 */
export function createEnrichUsageCallback(
  ctx: AppContext,
  source: string,
  identity?: string | null,
  scenario = "enrich",
) {
  return (call: {
    ok: boolean;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    errorCode?: string;
    thinking?: boolean;
  }) => {
    void (async () => {
      await ctx.repo.recordLlmUsage({
        scenario,
        source,
        model: call.model,
        identity,
        promptTokens: call.promptTokens,
        completionTokens: call.completionTokens,
        latencyMs: call.latencyMs,
        ok: call.ok,
        errorCode: call.errorCode,
        thinking: Boolean(call.thinking),
        price: await resolveLlmPrice(ctx, call.model),
      });
    })();
  };
}
