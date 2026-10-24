/**
 * 统一大模型网关（全仓唯一 LLM HTTP 出口）。
 *
 * 设计约束：
 *
 *  1. **唯一出口。** 除本文件外，仓库内不得出现 `/chat/completions` 字面量
 *     （守卫测试 `apps/api/test/llm-gateway-guard.test.ts` 会扫描源码）。
 *     好处：超时、鉴权、JSON 模式兼容、错误归一化只维护一份。
 *
 *  2. **OpenAI 兼容优先。** Agnes 3.0 Flash、DeepSeek、Ollama、vLLM 都提供
 *     `POST {baseUrl}/chat/completions`；`baseUrl` 允许直接写到 `.../v1`。
 *
 *  3. **不认参数就摘掉再试一次。** `jsonMode: "auto"` 时先带 `response_format`，
 *     遇到 400/422 且错误体点名该参数，则记住「该端点不支持」并去参重试；
 *     思维链参数（`thinking` / `chat_template_kwargs`）同理 —— 深度思考是产品
 *     默认开的，严格的兼容网关会把它判成未知字段，不去参就等于全站 AI 一起挂。
 *
 *  4. **SSRF 把关。** baseUrl 由管理员/用户配置，属于「用户可控输入 ->
 *     服务端发起请求」路径：仅允许 http/https，默认拒绝环回/私网/链路本地，
 *     DNS 解析后按真实 IP 判定（防 127.0.0.1.nip.io 这类绕过）。
 *
 *  5. **不重试业务失败。** 网关只做上面两类「去参」技术性重试（每类各一次，
 *     判定只看字段名）；超时/鉴权/限流/坏响应一律原样抛出，
 *     业务层（如富化）自己的两次尝试与启发式降级保持不变。
 */
import { DEFAULT_GUARD, assertUrlShape, resolveAndCheck } from "./ssrf.ts";

/** Agnes 3.0 Flash 官方参数（文档 2026-10） */
export const AGNES_NAME = "Agnes 3.0 Flash";
export const AGNES_BASE_URL = "https://api.agnes-ai.cn/v1";
export const AGNES_MODEL = "agnes-3.0-flash";

export type JsonMode = "auto" | "response_format" | "prompt";

/** 单次模型调用的连接参数（系统级/用户级配置解析后的最终形态） */
export interface LlmProvider {
  /** 展示名，仅用于 UI，不参与请求 */
  name?: string;
  /** 形如 https://api.agnes-ai.cn/v1；也接受完整的 .../chat/completions */
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: JsonMode;
  /** 允许 baseUrl 指向内网（本地 Ollama 等）；仅系统级配置可开启 */
  allowPrivateNetwork?: boolean;
  /** 默认是否启用深度思考（调用点未显式指定时以此为准） */
  thinking?: boolean;
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 需要严格 JSON 输出：按 provider.jsonMode 决定是否带 response_format */
  json?: boolean;
  tools?: unknown[];
  toolChoice?: unknown;
  /**
   * 深度思考（下发 `thinking` 与 vLLM 系的 `chat_template_kwargs.enable_thinking`）。
   * 只在 true 时下发该字段：不支持的服务商收到未知字段可能 400，
   * 而 false 与「不带」在语义上等价（默认不思考）。
   * 400 点名这些字段时网关会去参重试一次，并把该端点记成「不支持思维链参数」。
   */
  thinking?: boolean;
  signal?: AbortSignal;
  /** 测试注入；生产不传 */
  fetchImpl?: typeof fetch;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  content: string;
  /** 深度思考推导过程（Agnes / DeepSeek reasoning_content 或 <think>...</think>） */
  reasoningContent?: string;
  model: string;
  usage: ChatUsage;
  latencyMs: number;
  /** 实际采用的 JSON 约束方式，便于调用方判断输出可信度 */
  jsonModeUsed: "response_format" | "prompt" | "none";
  /**
   * 思维链参数是否真的下发到了端点。
   * false = 端点拒收该字段，本次已去参重试：回答仍然可用，但没有推理过程，
   * 用量记录必须按「未思考」记账，否则大盘的「思考调用数」是虚的。
   */
  thinkingApplied?: boolean;
}

export type LlmErrorCode =
  | "config"
  | "ssrf"
  | "timeout"
  | "auth"
  | "rate_limit"
  | "http"
  | "network"
  | "invalid_response";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status?: number;
  /** 服务端返回的可读片段（截断，不含请求头/密钥） */
  readonly detail?: string;

  constructor(code: LlmErrorCode, message: string, status?: number, detail?: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_DETAIL_CHARS = 400;

/** 端点不支持 response_format 的进程级记忆（baseUrl|model -> true） */
const jsonModeUnsupported = new Set<string>();

/**
 * 端点不支持思维链参数的进程级记忆。
 *
 * `thinking` / `chat_template_kwargs` 是给 Agnes 与 vLLM 系用的，但严格的
 * OpenAI 兼容网关会把未知字段判成 400。而深度思考是**产品默认开**的：没有这层
 * 记忆，接上这类网关就等于全站 AI 一起挂，且报错只写「模型返回 HTTP 400」。
 */
const thinkingParamUnsupported = new Set<string>();

/** 测试用：清空能力记忆 */
export function resetLlmCapabilityCache(): void {
  jsonModeUnsupported.clear();
  thinkingParamUnsupported.clear();
}

/** baseUrl 归一化为 chat/completions 终点 */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return trimmed + "/chat/completions";
}

/**
 * 密钥掩码：保留前 3 后 4（短密钥只留尾部 2 位），永不回显明文。
 * 非字符串/空串统一返回空串，避免把 "null" 当成掩码展示。
 */
export function maskApiKey(key: string | null | undefined): string {
  const value = typeof key === "string" ? key.trim() : "";
  if (!value) return "";
  if (value.length <= 8) return "****" + value.slice(-2);
  return value.slice(0, 3) + "****" + value.slice(-4);
}

/**
 * 校验 LLM 端点（协议 + DNS 解析后的真实 IP）。
 * 抛 LlmError(code="ssrf")，调用方无需再处理 SsrfBlockedError。
 */
export async function assertLlmEndpoint(baseUrl: string, allowPrivateNetwork = false): Promise<void> {
  let url: URL;
  try {
    url = assertUrlShape(baseUrl);
  } catch (err) {
    throw new LlmError("config", "接口地址无效：" + (err instanceof Error ? err.message : String(err)));
  }
  try {
    await resolveAndCheck(url, { ...DEFAULT_GUARD, allowPrivateNetworks: allowPrivateNetwork });
  } catch (err) {
    throw new LlmError("ssrf", err instanceof Error ? err.message : String(err));
  }
}

function capabilityKey(provider: LlmProvider): string {
  return provider.baseUrl.replace(/\/+$/, "") + "|" + provider.model;
}

function normalizeContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") parts.push(part);
      else if (part && typeof part === "object") {
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") parts.push(record.text);
      }
    }
    return parts.length > 0 ? parts.join("") : null;
  }
  return null;
}

function normalizeUsage(raw: unknown): ChatUsage {
  const usage = (raw ?? {}) as Record<string, unknown>;
  const pick = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    promptTokens: pick(usage.prompt_tokens ?? usage.promptTokens),
    completionTokens: pick(usage.completion_tokens ?? usage.completionTokens),
    totalTokens: pick(usage.total_tokens ?? usage.totalTokens),
  };
}

/**
 * 「这个端点不支持 response_format」的判定词。
 *
 * 只能按**字段名**判定，不能用 `unknown field` / `unrecognized` / `extra parameter`
 * 这类泛化措辞：那条 400 说的可能是请求体里的任何字段（例如刚加上的 `thinking`、
 * `chat_template_kwargs`）。误判的后果是进程级的——`jsonModeUnsupported` 会记住
 * 这个 `baseUrl|model`，之后所有调用都静默丢掉 `response_format`，只能靠测试专用的
 * reset 清掉；表现为 JSON 解析失败率莫名升高、富化悄悄降级成启发式。
 */
const RESPONSE_FORMAT_HINT = /response[\s_-]?format|json_object|json_schema|structured_outputs/i;

/** response_format 相关的错误体判定（只在 auto + 400/422 时使用） */
function looksLikeResponseFormatRejection(detail: string): boolean {
  return RESPONSE_FORMAT_HINT.test(detail);
}

/**
 * 「这个端点拒收了思维链字段」的判定：既要点名字段，也要有拒绝措辞。
 *
 * 字段判定不能只认 `"thinking"` 这种带引号的形式：错误体是 JSON 原文，
 * 引号在文本里是 `\"`，紧邻 thinking 的其实是反斜杠。所以按「非字母数字边界」
 * 取词，并要求同一句话里出现拒绝措辞（unsupported / extra fields / key 等），
 * 避免把正文里偶然提到 thinking 的其它 400 误判成参数不支持。
 * 即使误判，去参重试失败时也不会写脏能力记忆（见 chatCompletion）。
 */
const THINKING_PARAM_FIELD =
  /chat[\s_-]?template[\s_-]?kwargs|enable[\s_-]?thinking|(?:^|[^a-z0-9])thinking(?:[^a-z0-9]|$)/i;
const PARAM_REJECTION_CUE =
  /unsupported|unrecognized|unexpected|unknown|extra|invalid|not\s+(?:allowed|permitted|supported|recognized|expected)|fields?\b|parameters?\b|props?\b|arguments?\b|keys?\b/i;

function looksLikeThinkingParamRejection(detail: string): boolean {
  return THINKING_PARAM_FIELD.test(detail) && PARAM_REJECTION_CUE.test(detail);
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, MAX_DETAIL_CHARS);
  } catch {
    return "";
  }
}

function httpError(res: Response, detail: string): LlmError {
  const status = res.status;
  if (status === 401 || status === 403) return new LlmError("auth", "模型鉴权失败（HTTP " + status + "）", status, detail);
  if (status === 429) return new LlmError("rate_limit", "模型限流（HTTP 429）", status, detail);
  return new LlmError("http", "模型返回 HTTP " + status, status, detail);
}

/** 合并外部 AbortSignal 与内部超时 */
function timeoutSignal(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function buildBody(
  provider: LlmProvider,
  opts: ChatOptions,
  useResponseFormat: boolean,
  stream: boolean,
  includeThinking = true,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: opts.messages,
    stream,
  };
  const temperature = opts.temperature ?? provider.temperature;
  if (typeof temperature === "number") body.temperature = temperature;
  const maxTokens = opts.maxTokens ?? provider.maxTokens;
  if (typeof maxTokens === "number" && maxTokens > 0) body.max_tokens = Math.min(maxTokens, 65_536);
  if (useResponseFormat) body.response_format = { type: "json_object" };
  if (Array.isArray(opts.tools) && opts.tools.length > 0) {
    body.tools = opts.tools;
    if (opts.toolChoice !== undefined) body.tool_choice = opts.toolChoice;
  }
  // 深度思考：Agnes 官方规范使用 thinking: { type: 'enabled', budget_tokens }，
  // 同时兼容 vLLM 系的 chat_template_kwargs: { enable_thinking: true }
  if (opts.thinking === true && includeThinking) {
    body.thinking = {
      type: "enabled",
      budget_tokens: Math.min(typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 2048, 4096),
    };
    body.chat_template_kwargs = { enable_thinking: true };
  }
  return body;
}

function assertProvider(provider: LlmProvider): void {
  if (!provider || typeof provider !== "object") throw new LlmError("config", "缺少模型配置");
  if (!provider.baseUrl || !provider.baseUrl.trim()) throw new LlmError("config", "缺少接口地址（baseUrl）");
  if (!provider.model || !provider.model.trim()) throw new LlmError("config", "缺少模型名称（model）");
}

/** 单次调用（内部） */
async function callOnce(
  provider: LlmProvider,
  opts: ChatOptions,
  useResponseFormat: boolean,
  includeThinking = true,
): Promise<ChatResult> {
  assertProvider(provider);
  const url = chatCompletionsUrl(provider.baseUrl);
  await assertLlmEndpoint(url, provider.allowPrivateNetwork === true);

  const baseTimeout = provider.timeoutMs && provider.timeoutMs > 0 ? provider.timeoutMs : DEFAULT_TIMEOUT_MS;
  // 思维链确实下发时才放宽超时：去参重试走的是普通请求，没必要多等 40 秒
  const timeoutMs = opts.thinking === true && includeThinking ? Math.max(baseTimeout, 60_000) : baseTimeout;
  const gate = timeoutSignal(timeoutMs, opts.signal);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const startedAt = Date.now();

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.apiKey) headers.Authorization = "Bearer " + provider.apiKey;

    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(provider, opts, useResponseFormat, false, includeThinking)),
      signal: gate.signal,
      // LLM 端点不应重定向；禁跟随可避免「302 -> 内网」绕过 SSRF 预检
      redirect: "error",
    });

    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw httpError(res, detail);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new LlmError("invalid_response", "模型响应不是合法 JSON", res.status);
    }

    const record = (payload ?? {}) as Record<string, unknown>;
    const choices = Array.isArray(record.choices) ? record.choices as Array<Record<string, unknown>> : [];
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    const content = normalizeContent(message?.content);
    if (content === null) {
      throw new LlmError("invalid_response", "模型响应缺少 choices[0].message.content", res.status);
    }

    let reasoningContent: string | undefined =
      typeof message?.reasoning_content === "string" ? message.reasoning_content : undefined;
    let finalContent = content;
    if (!reasoningContent && typeof finalContent === "string") {
      const thinkMatch = /<think>([\s\S]*?)<\/think>/i.exec(finalContent);
      if (thinkMatch && typeof thinkMatch[1] === "string") {
        reasoningContent = thinkMatch[1].trim();
        finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
      }
    }

    return {
      content: finalContent,
      reasoningContent,
      model: typeof record.model === "string" ? record.model : provider.model,
      usage: normalizeUsage(record.usage),
      latencyMs: Date.now() - startedAt,
      jsonModeUsed: useResponseFormat ? "response_format" : opts.json ? "prompt" : "none",
      thinkingApplied: opts.thinking === true && includeThinking,
    };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (gate.timedOut()) throw new LlmError("timeout", "模型调用超时（" + timeoutMs + "ms）");
    if (err instanceof Error && err.name === "AbortError") throw new LlmError("network", "模型调用被取消");
    throw new LlmError("network", "模型网络请求失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    gate.cleanup();
  }
}

/**
 * 发起一次 chat completions 调用。
 *
 * 网关只做「去参」这一类技术性重试，不重试业务失败（超时/鉴权/限流/坏响应）：
 * - `response_format`：jsonMode=auto 且端点 400/422 点名不支持时，改走提示词约束；
 * - 思维链参数：严格 OpenAI 兼容网关会拒收未知字段，而去参后普通回答照常可用。
 * 两类判定都记进进程级能力缓存，后续调用直接跳过，不再白撞一次 400。
 */
export async function chatCompletion(provider: LlmProvider, opts: ChatOptions): Promise<ChatResult> {
  const mode: JsonMode = provider.jsonMode ?? "auto";
  const key = capabilityKey(provider);
  let useResponseFormat = opts.json === true && mode !== "prompt" && !jsonModeUnsupported.has(key);
  let includeThinking = opts.thinking === true && !thinkingParamUnsupported.has(key);

  for (;;) {
    try {
      return await callOnce(provider, opts, useResponseFormat, includeThinking);
    } catch (err) {
      const detail = err instanceof LlmError ? (err.detail ?? "") : "";
      const paramRejected =
        err instanceof LlmError && (err.status === 400 || err.status === 422);
      if (!paramRejected) throw err;

      if (useResponseFormat && mode === "auto" && looksLikeResponseFormatRejection(detail)) {
        // 记住该端点不支持，后续直接走「提示词约束」
        jsonModeUnsupported.add(key);
        useResponseFormat = false;
        continue;
      }
      if (includeThinking && looksLikeThinkingParamRejection(detail)) {
        // 先去参试一次：只有这次真成功了，才有证据说「该端点不支持思维链」。
        // 反过来（例如 400 其实是提示词过长）不把整个进程的记忆写脏，
        // 否则全站再也拿不到推理过程，界面上只表现为「伴侣不给思考」。
        const retried = await callOnce(provider, opts, useResponseFormat, false).catch(() => null);
        if (!retried) throw err;
        thinkingParamUnsupported.add(key);
        return retried;
      }
      throw err;
    }
  }
}

/** SSE 行解析：返回增量文本；非数据行返回 null */
export function extractSseDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
    return normalizeContent(parsed.choices?.[0]?.delta?.content);
  } catch {
    return null;
  }
}

/**
 * 流式调用（供后续对话式功能使用）。
 * 逐段产出增量文本；调用方负责拼接与最终校验。
 */
export async function* chatStream(provider: LlmProvider, opts: ChatOptions): AsyncGenerator<string, void, unknown> {
  assertProvider(provider);
  const url = chatCompletionsUrl(provider.baseUrl);
  await assertLlmEndpoint(url, provider.allowPrivateNetwork === true);

  const timeoutMs = provider.timeoutMs && provider.timeoutMs > 0 ? provider.timeoutMs : DEFAULT_TIMEOUT_MS;
  const gate = timeoutSignal(timeoutMs, opts.signal);
  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream" };
    if (provider.apiKey) headers.Authorization = "Bearer " + provider.apiKey;

    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(
        // 流式无法「先 400 再去参重试」（请求体已经开流），所以只复用非流式调用
        // 学到的能力记忆：该端点已知不支持思维链参数时，一开始就不带。
        buildBody(provider, opts, false, true, opts.thinking === true && !thinkingParamUnsupported.has(capabilityKey(provider))),
      ),
      signal: gate.signal,
      redirect: "error",
    });
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw httpError(res, detail);
    }
    if (!res.body) throw new LlmError("invalid_response", "模型未返回流式响应体", res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const delta = extractSseDelta(line);
        if (delta) yield delta;
        if (line.trim() === "data: [DONE]") return;
      }
    }
    if (buffer.trim()) {
      const delta = extractSseDelta(buffer);
      if (delta) yield delta;
    }
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (gate.timedOut()) throw new LlmError("timeout", "模型流式调用超时（" + timeoutMs + "ms）");
    if (err instanceof Error && err.name === "AbortError") throw new LlmError("network", "模型流式调用被取消");
    throw new LlmError("network", "模型流式请求失败：" + (err instanceof Error ? err.message : String(err)));
  } finally {
    gate.cleanup();
  }
}
