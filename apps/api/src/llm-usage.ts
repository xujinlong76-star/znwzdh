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

  let lastError: unknown = null;
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
      fallbackRetryBudget.recordSuccess();

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
      if (!fallbackRetryBudget.canRetry()) break;
      fallbackRetryBudget.recordRetry();
      // 继续尝试备用模型池
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

  let lastError: unknown = null;
  for (const { provider, source } of candidates) {
    if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) {
      lastError ??= new LlmError("timeout", "模型流式调用已超出总预算");
      break;
    }
    if (!llmProviderReady(provider)) continue;
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
          fallbackRetryBudget.recordSuccess();
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
      if (!fallbackRetryBudget.canRetry()) throw err;
      fallbackRetryBudget.recordRetry();
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
