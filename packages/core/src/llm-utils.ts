/**
 * LLM 配置工具函数（纯函数，无应用层依赖）。
 *
 * 从 apps/api/src/llm-config.ts 迁移而来，供 MCP 工具包使用，
 * 避免 packages/mcp 反向依赖 apps/api。
 *
 * 仅包含纯函数与数据结构定义，不依赖 AppContext。
 */

export interface LlmProvider {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs?: number;
  timeoutMsExplicit?: boolean;
  jsonMode?: boolean;
  allowPrivateNetwork?: boolean;
  thinking?: boolean;
  enabled?: boolean;
  label?: string;
}

export type LlmSource = "user" | "system" | "fallback" | "disabled";

export interface ResolvedLlm {
  provider: LlmProvider;
  fallbacks: LlmProvider[];
  source: LlmSource;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  timeoutMsExplicit: boolean;
  jsonMode: boolean;
  allowPrivateNetwork: boolean;
  thinking: boolean;
  fallbacks: LlmProvider[];
}

export function enrichLlmOf(resolved: ResolvedLlm): LlmConfig {
  const base: LlmConfig = {
    baseUrl: resolved.provider.baseUrl,
    apiKey: resolved.provider.apiKey ?? null,
    model: resolved.provider.model,
    timeoutMs: resolved.provider.timeoutMs ?? 20_000,
    timeoutMsExplicit: resolved.provider.timeoutMsExplicit === true,
    jsonMode: resolved.provider.jsonMode ?? false,
    allowPrivateNetwork: resolved.provider.allowPrivateNetwork ?? false,
    thinking: resolved.provider.thinking ?? true,
    fallbacks: resolved.fallbacks.map((fb) => ({
      baseUrl: fb.baseUrl,
      apiKey: fb.apiKey ?? null,
      model: fb.model,
      timeoutMs: fb.timeoutMs ?? 20_000,
      timeoutMsExplicit: fb.timeoutMsExplicit === true,
      jsonMode: fb.jsonMode ?? false,
      allowPrivateNetwork: fb.allowPrivateNetwork ?? false,
    })),
  };
  return base;
}
