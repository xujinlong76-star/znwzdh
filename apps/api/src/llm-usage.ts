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
  LlmError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type LlmProvider,
} from "@navhub/ai";
import type { AppContext } from "./context.ts";
import { llmProviderReady, type ResolvedLlm } from "./llm-config.ts";

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
    fetchImpl: opts.fetchImpl,
  };

  const candidates: Array<{ provider: LlmProvider; source: string }> = [
    { provider: resolved.provider, source: resolved.source },
    ...resolved.fallbacks.map((fb) => ({ provider: fb, source: "fallback" })),
  ];

  let lastError: unknown = null;
  for (const { provider, source } of candidates) {
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
      });

      return res;
    } catch (err) {
      lastError = err;
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
      });
      // 继续尝试备用模型池
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
    void ctx.repo.recordLlmUsage({
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
    });
  };
}
