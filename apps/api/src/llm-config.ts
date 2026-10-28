/**
 * LLM 配置治理：解析链、加密存储、掩码视图与连通性测试。
 *
 * 解析优先级（高 → 低）：
 *   ① 用户级配置（user_llm_configs.identity）
 *   ② 系统级配置（system_states: ai.llm.config.v1，密钥加密）
 *   ③ 环境变量（NAVHUB_LLM_*）
 *   ④ 内置默认（Agnes 3.0 Flash，无密钥）
 *
 * 安全约定：
 *   - 密钥只以加密信封落库（AES-256-GCM，口令 = NAVHUB_SECRETS_KEY || SESSION_SECRET）；
 *   - 任何读接口只返回掩码；审计只记「是否变更」不记值；
 *   - baseUrl 属服务端可控请求面，写入前做 SSRF 校验（用户级强制禁私网）。
 */
import { randomBytes } from "node:crypto";
import {
  AGNES_BASE_URL,
  AGNES_MODEL,
  AGNES_NAME,
  LlmError,
  assertLlmEndpoint,
  chatCompletion,
  maskApiKey,
  type JsonMode,
  type LlmConfig,
  type LlmProvider,
} from "@navhub/ai";
import {
  decryptGenericPayload,
  encryptGenericPayload,
  type EncryptedPayloadEnvelope,
} from "@navhub/core";
import { z } from "zod";
import type { AppConfig } from "./config.ts";
import type { AppContext } from "./context.ts";

/** system_states 中的配置键（带版本号，便于未来结构演进） */
export const SYSTEM_LLM_CONFIG_KEY = "ai.llm.config.v1";
const SECRET_TYPE = "llm-api-key";

/* ------------------------------------------------------------------ *
 * 输入契约
 * ------------------------------------------------------------------ */

export const LlmProviderInputSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  baseUrl: z.string().trim().url().max(300),
  model: z.string().trim().min(1).max(120),
  /** 省略 = 保持原密钥；空串 = 清除；非空 = 覆盖 */
  apiKey: z.string().max(512).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(65_536).optional(),
  jsonMode: z.enum(["auto", "response_format", "prompt"]).optional(),
  /** 深度思考开关；省略时继承上层（系统级默认开） */
  thinking: z.boolean().optional(),
});
export type LlmProviderInput = z.infer<typeof LlmProviderInputSchema>;

/** 备用模型输入：id 用于保留已存密钥；省略 apiKey 表示沿用同 id 的旧密钥 */
export const LlmFallbackInputSchema = LlmProviderInputSchema.extend({
  id: z.string().max(64).optional(),
  allowPrivateNetwork: z.boolean().optional(),
});
export type LlmFallbackInput = z.infer<typeof LlmFallbackInputSchema>;

export const SystemLlmConfigInputSchema = LlmProviderInputSchema.extend({
  /** 仅系统级可设：允许内网端点（本地 Ollama） */
  allowPrivateNetwork: z.boolean().optional(),
  /**
   * 仅系统级可设：观测大盘折算花费用的单价（¥/1K token）。
   * 0/省略 = 未配置，大盘据此写「未配置单价」而不是报一个凭空捏的 ¥ 数。
   */
  costPer1kTokensRmb: z.number().min(0).max(1000).optional(),
  /** 备用模型池：主模型失败/超时后按顺序尝试（最多 3 个） */
  fallbacks: z.array(LlmFallbackInputSchema).max(3).optional(),
});
export type SystemLlmConfigInput = z.infer<typeof SystemLlmConfigInputSchema>;

/* ------------------------------------------------------------------ *
 * 存储形态
 * ------------------------------------------------------------------ */

interface StoredLlmFallback {
  id: string;
  enabled: boolean;
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnc: EncryptedPayloadEnvelope | null;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  jsonMode: JsonMode;
  allowPrivateNetwork: boolean;
  /** 备用池这一跳是否下发思维链；省略时按产品默认「开」 */
  thinking?: boolean;
}

interface StoredLlmProvider {
  enabled: boolean;
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnc: EncryptedPayloadEnvelope | null;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  jsonMode: JsonMode;
  allowPrivateNetwork: boolean;
  /** 深度思考；旧配置没有该字段时按「开」处理（产品默认） */
  thinking?: boolean;
  /** 观测大盘折算花费的单价（¥/1K token）；未设则回退环境变量 */
  costPer1kTokensRmb?: number;
  /** 备用模型池（仅系统级配置使用） */
  fallbacks: StoredLlmFallback[];
  updatedAt: number;
  updatedBy: string | null;
}

const StoredLlmFallbackSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  name: z.string().default("备用模型"),
  baseUrl: z.string(),
  model: z.string(),
  apiKeyEnc: z.unknown().nullable().optional(),
  timeoutMs: z.number().default(20_000),
  temperature: z.number().default(0.2),
  maxTokens: z.number().default(1024),
  jsonMode: z.enum(["auto", "response_format", "prompt"]).default("auto"),
  allowPrivateNetwork: z.boolean().default(false),
  // 读侧一定要声明：zod 的 object 会剥掉未声明的键，漏一行等于「配置存进去了但永远读不出来」
  thinking: z.boolean().optional(),
});

const StoredLlmProviderSchema = z.object({
  enabled: z.boolean().default(true),
  name: z.string().default(AGNES_NAME),
  baseUrl: z.string().default(AGNES_BASE_URL),
  model: z.string().default(AGNES_MODEL),
  apiKeyEnc: z.unknown().nullable().optional(),
  timeoutMs: z.number().default(20_000),
  temperature: z.number().default(0.2),
  maxTokens: z.number().default(1024),
  jsonMode: z.enum(["auto", "response_format", "prompt"]).default("auto"),
  allowPrivateNetwork: z.boolean().default(false),
  // 同上：管理端「深度思考 = 关」落库后必须在读取时活着回来，
  // 否则 thinking 永远是 undefined → 下游按产品默认「开」处理，
  // 表现为关不掉、超时被抬到 60s、大盘的「思考调用数」恒等于总调用数。
  thinking: z.boolean().optional(),
  costPer1kTokensRmb: z.number().min(0).max(1000).optional(),
  fallbacks: z.array(StoredLlmFallbackSchema).default([]),
  updatedAt: z.number().default(0),
  updatedBy: z.string().nullable().optional(),
});

function secretPassphrase(config: AppConfig): string {
  return config.llm.secretsKey || config.sessionSecret;
}

function envDefaults(config: AppConfig): Omit<StoredLlmProvider, "apiKeyEnc" | "updatedAt" | "updatedBy"> {
  return {
    enabled: true,
    name: config.llm.name || AGNES_NAME,
    baseUrl: config.llm.baseUrl || AGNES_BASE_URL,
    model: config.llm.model || AGNES_MODEL,
    timeoutMs: config.llm.timeoutMs,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
    jsonMode: config.llm.jsonMode,
    allowPrivateNetwork: config.llm.allowPrivateNetwork,
    // 管理端没显式填过单价时，用环境变量的单价兜底；两者都没配就是 0 = 未配置
    costPer1kTokensRmb: config.costPer1kTokensRmb,
    fallbacks: [],
  };
}

function toProvider(stored: StoredLlmProvider, apiKey: string | null, allowPrivateNetwork: boolean): LlmProvider {
  return {
    name: stored.name,
    baseUrl: stored.baseUrl,
    model: stored.model,
    apiKey,
    timeoutMs: stored.timeoutMs,
    temperature: stored.temperature,
    maxTokens: stored.maxTokens,
    jsonMode: stored.jsonMode,
    allowPrivateNetwork,
    // 旧配置没有 thinking 字段 → 按产品默认「开」处理
    thinking: stored.thinking ?? true,
  };
}

function fallbackToProvider(fb: StoredLlmFallback, apiKey: string): LlmProvider {
  return {
    name: fb.name,
    baseUrl: fb.baseUrl,
    model: fb.model,
    apiKey,
    timeoutMs: fb.timeoutMs,
    temperature: fb.temperature,
    maxTokens: fb.maxTokens,
    jsonMode: fb.jsonMode,
    allowPrivateNetwork: fb.allowPrivateNetwork,
    // 省略时由调用点按产品默认「开」处理；显式关掉必须能关掉
    thinking: fb.thinking,
  };
}

async function sealKey(ctx: AppContext, plain: string): Promise<EncryptedPayloadEnvelope> {
  return encryptGenericPayload(plain, secretPassphrase(ctx.config), SECRET_TYPE);
}

async function openKey(ctx: AppContext, envelope: EncryptedPayloadEnvelope | null): Promise<string | null> {
  if (!envelope) return null;
  try {
    const value = await decryptGenericPayload<string>(envelope, secretPassphrase(ctx.config));
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    // 口令轮换或密文损坏：按「无密钥」处理，管理端可重新填写
    return null;
  }
}

async function readStoredSystem(ctx: AppContext): Promise<StoredLlmProvider | null> {
  const raw = await ctx.repo.getSystemState<unknown>(SYSTEM_LLM_CONFIG_KEY);
  if (!raw || typeof raw !== "object") return null;
  const parsed = StoredLlmProviderSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    ...envDefaults(ctx.config),
    ...parsed.data,
    apiKeyEnc: (parsed.data.apiKeyEnc ?? null) as EncryptedPayloadEnvelope | null,
    fallbacks: parsed.data.fallbacks.map((fb) => ({
      ...fb,
      apiKeyEnc: (fb.apiKeyEnc ?? null) as EncryptedPayloadEnvelope | null,
    })),
    updatedBy: parsed.data.updatedBy ?? null,
  };
}

async function readStoredUser(ctx: AppContext, identity: string): Promise<StoredLlmProvider | null> {
  const row = await ctx.repo.getUserLlmConfig(identity);
  if (!row) return null;
  const parsed = StoredLlmProviderSchema.safeParse(row.provider);
  if (!parsed.success) return null;
  return {
    ...envDefaults(ctx.config),
    ...parsed.data,
    allowPrivateNetwork: false,
    apiKeyEnc: (parsed.data.apiKeyEnc ?? null) as EncryptedPayloadEnvelope | null,
    // 个人配置不存备用池：统一复用系统级备用模型（安全网）
    fallbacks: [],
    updatedAt: parsed.data.updatedAt ?? row.updatedAt,
    updatedBy: parsed.data.updatedBy ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * 解析链
 * ------------------------------------------------------------------ */

/**
 * 观测大盘折算花费用的单价（¥/1K token）。
 *
 * 口径：管理端显式填的值 > 环境变量 NAVHUB_LLM_COST_PER_1K_TOKENS > 0。
 * 返回 0 代表「没配」——调用方必须据此回 null，而不是按某个默认报价折算：
 * 任何写死的单价都会让运维面板上的 ¥ 数变成假账。
 */
export async function getLlmCostUnitPriceRmb(ctx: AppContext): Promise<number> {
  const stored = await readStoredSystem(ctx);
  // stored 为 null（管理端从没存过配置）时 readStoredSystem 不会兜底环境变量，这里补上
  const value = stored?.costPer1kTokensRmb ?? ctx.config.costPer1kTokensRmb;
  return typeof value === "number" && value > 0 ? value : 0;
}

export type LlmSource = "user" | "system" | "env" | "default";

export interface ResolvedLlm {
  provider: LlmProvider;
  /** 备用模型池（主模型失败/超时后按顺序尝试），无则为空数组 */
  fallbacks: LlmProvider[];
  source: LlmSource;
}

/** 解出可用的备用 provider（跳过停用项与无密钥项） */
async function resolveFallbacks(ctx: AppContext, stored: StoredLlmProvider | null): Promise<LlmProvider[]> {
  if (!stored || !stored.enabled) return [];
  const out: LlmProvider[] = [];
  for (const fb of stored.fallbacks) {
    if (!fb.enabled) continue;
    const key = await openKey(ctx, fb.apiKeyEnc);
    if (!key) continue;
    out.push(fallbackToProvider(fb, key));
  }
  return out;
}

/**
 * 解析「本次请求该用哪个模型」。
 *
 * - 用户配置需同时满足「存在 + enabled + 能解出密钥」，否则回退系统层；
 * - 系统层 enabled=false 视为「管理端显式关闭」：返回无密钥 provider，
 *   调用方据此跳过 LLM（不会被环境变量意外复活）；
 * - 无身份（任务队列等）直接走系统层；
 * - 备用池始终取系统级配置（个人配置失败时也能兜底）。
 */
export async function resolveLlm(ctx: AppContext, identity?: string | null): Promise<ResolvedLlm> {
  const system = await readStoredSystem(ctx);
  const systemFallbacks = await resolveFallbacks(ctx, system);

  if (identity) {
    const user = await readStoredUser(ctx, identity);
    if (user && user.enabled) {
      const userKey = await openKey(ctx, user.apiKeyEnc);
      if (userKey) return { provider: toProvider(user, userKey, false), fallbacks: systemFallbacks, source: "user" };
    }
  }

  if (system) {
    if (!system.enabled) {
      return {
        // 显式关闭：不只清空密钥，也撤销「放行内网」。否则免密钥的本地网关
        // 仍会被判定为可用（llmProviderReady 只看 allowPrivateNetwork），
        // 等于绕过管理端的关闭开关。
        provider: toProvider(system, null, false),
        fallbacks: [],
        source: "system",
      };
    }
    const key = (await openKey(ctx, system.apiKeyEnc)) ?? ctx.config.llm.apiKey;
    return { provider: toProvider(system, key, system.allowPrivateNetwork), fallbacks: systemFallbacks, source: "system" };
  }

  const env: LlmProvider = {
    name: ctx.config.llm.name,
    baseUrl: ctx.config.llm.baseUrl,
    model: ctx.config.llm.model,
    apiKey: ctx.config.llm.apiKey,
    timeoutMs: ctx.config.llm.timeoutMs,
    temperature: ctx.config.llm.temperature,
    maxTokens: ctx.config.llm.maxTokens,
    jsonMode: ctx.config.llm.jsonMode,
    allowPrivateNetwork: ctx.config.llm.allowPrivateNetwork,
    thinking: ctx.config.llm.thinking,
  };
  return { provider: env, fallbacks: [], source: env.apiKey ? "env" : "default" };
}

/**
 * 转成富化模块使用的 LlmConfig（含备用池）。
 * 放在这里而不是调用点重复拼装：类型收敛 + 默认值只有一处。
 */
export function enrichLlmOf(resolved: ResolvedLlm): LlmConfig {
  const base: LlmConfig = {
    baseUrl: resolved.provider.baseUrl,
    apiKey: resolved.provider.apiKey ?? null,
    model: resolved.provider.model,
    timeoutMs: resolved.provider.timeoutMs ?? 20_000,
    jsonMode: resolved.provider.jsonMode,
    allowPrivateNetwork: resolved.provider.allowPrivateNetwork,
    thinking: resolved.provider.thinking ?? true,
    fallbacks: resolved.fallbacks.map((fb) => ({
      baseUrl: fb.baseUrl,
      apiKey: fb.apiKey ?? null,
      model: fb.model,
      timeoutMs: fb.timeoutMs ?? 20_000,
      jsonMode: fb.jsonMode,
      allowPrivateNetwork: fb.allowPrivateNetwork,
    })),
  };
  return base;
}

/** 配置变更后刷新能力位（/api/health、metrics、启动日志共用） */
export async function refreshLlmCapability(ctx: AppContext): Promise<void> {
  try {
    const { provider } = await resolveLlm(ctx);
    ctx.capabilities.llm = llmProviderReady(provider);
  } catch {
    ctx.capabilities.llm = false;
  }
}

/**
 * provider 是否可用于真实调用。
 *
 * 不能只看 `apiKey`：本地 Ollama 等自托管网关不需要密钥，配置页预设也明确写着
 * 「可留空」。是否放行由 `allowPrivateNetwork` 控制 —— 它只能由管理员在系统级
 * 配置里开启（用户级配置强制为 false），因此不存在匿名用户借空密钥访问内网的路径。
 */
export function llmProviderReady(
  provider: { apiKey?: string | null; allowPrivateNetwork?: boolean } | null | undefined,
): boolean {
  if (!provider) return false;
  return Boolean(provider.apiKey) || provider.allowPrivateNetwork === true;
}

/* ------------------------------------------------------------------ *
 * 视图（掩码）
 * ------------------------------------------------------------------ */

export interface LlmFallbackView {
  id: string;
  enabled: boolean;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  jsonMode: JsonMode;
  allowPrivateNetwork: boolean;
}

export interface LlmConfigView {
  configured: boolean;
  source: "db" | "env" | "default";
  enabled: boolean;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  jsonMode: JsonMode;
  allowPrivateNetwork: boolean;
  /** 深度思考（默认开；可在配置页关闭） */
  thinking: boolean;
  /** 观测大盘折算花费的单价（¥/1K token）；0 = 未配置 */
  costPer1kTokensRmb: number;
  /** 备用模型池（仅系统级；密钥只回显掩码） */
  fallbacks: LlmFallbackView[];
  updatedAt: number | null;
  updatedBy: string | null;
  /** 最终生效的模型信息与来源 */
  effective: { source: "system" | "env" | "default"; name: string; model: string; baseUrl: string };
}

function viewOf(stored: StoredLlmProvider, key: string | null, source: "db" | "env" | "default", effective?: LlmConfigView["effective"]): LlmConfigView {
  return {
    configured: Boolean(key),
    source,
    enabled: stored.enabled,
    name: stored.name,
    baseUrl: stored.baseUrl,
    model: stored.model,
    hasApiKey: Boolean(key),
    apiKeyMasked: maskApiKey(key),
    timeoutMs: stored.timeoutMs,
    temperature: stored.temperature,
    maxTokens: stored.maxTokens,
    jsonMode: stored.jsonMode,
    allowPrivateNetwork: stored.allowPrivateNetwork,
    thinking: stored.thinking ?? true,
    costPer1kTokensRmb: stored.costPer1kTokensRmb ?? 0,
    fallbacks: [],
    updatedAt: stored.updatedAt || null,
    updatedBy: stored.updatedBy,
    effective: effective ?? {
      source: source === "db" ? "system" : source,
      name: stored.name,
      model: stored.model,
      baseUrl: stored.baseUrl,
    },
  };
}

export async function getSystemLlmConfigView(ctx: AppContext): Promise<LlmConfigView> {
  const resolved = await resolveLlm(ctx);
  const effective: LlmConfigView["effective"] = {
    source: resolved.source === "user" ? "system" : (resolved.source as "system" | "env" | "default"),
    name: resolved.provider.name || AGNES_NAME,
    model: resolved.provider.model,
    baseUrl: resolved.provider.baseUrl,
  };
  const stored = await readStoredSystem(ctx);
  if (stored) {
    const key = (await openKey(ctx, stored.apiKeyEnc)) ?? ctx.config.llm.apiKey;
    const fallbacks: LlmFallbackView[] = [];
    for (const fb of stored.fallbacks) {
      const fbKey = await openKey(ctx, fb.apiKeyEnc);
      fallbacks.push({
        id: fb.id,
        enabled: fb.enabled,
        name: fb.name,
        baseUrl: fb.baseUrl,
        model: fb.model,
        hasApiKey: Boolean(fbKey),
        apiKeyMasked: maskApiKey(fbKey),
        timeoutMs: fb.timeoutMs,
        temperature: fb.temperature,
        maxTokens: fb.maxTokens,
        jsonMode: fb.jsonMode,
        allowPrivateNetwork: fb.allowPrivateNetwork,
      });
    }
    return { ...viewOf(stored, key, "db", effective), fallbacks, effective };
  }
  const envKey = ctx.config.llm.apiKey;
  const defaults: StoredLlmProvider = {
    ...envDefaults(ctx.config),
    apiKeyEnc: null,
    updatedAt: 0,
    updatedBy: null,
  };
  return { ...viewOf(defaults, envKey, envKey ? "env" : "default", effective), effective };
}

/* ------------------------------------------------------------------ *
 * 写入（系统级）
 * ------------------------------------------------------------------ */

export async function saveSystemLlmConfig(
  ctx: AppContext,
  input: SystemLlmConfigInput,
  actor: string,
  ip?: string,
): Promise<LlmConfigView> {
  const existing = await readStoredSystem(ctx);
  const base: StoredLlmProvider = existing ?? {
    ...envDefaults(ctx.config),
    apiKeyEnc: null,
    updatedAt: 0,
    updatedBy: null,
  };

  // 有效安全开关：本次显式值 > 既有配置 > 环境默认；SSRF 校验必须用它
  const allowPrivate = typeof input.allowPrivateNetwork === "boolean" ? input.allowPrivateNetwork : base.allowPrivateNetwork;
  await assertLlmEndpoint(input.baseUrl, allowPrivate); // 抛 LlmError -> 路由层转 400

  let apiKeyEnc = base.apiKeyEnc;
  const rawKey = typeof input.apiKey === "string" ? input.apiKey.trim() : undefined;
  if (rawKey !== undefined) {
    apiKeyEnc = rawKey === "" ? null : await sealKey(ctx, rawKey);
  }

  // 备用池：整表替换；未给 apiKey 的条目按 id 沿用旧密文
  const existingById = new Map((existing?.fallbacks ?? []).map((fb) => [fb.id, fb]));
  let fallbacks = existing?.fallbacks ?? [];
  if (input.fallbacks !== undefined) {
    const next: StoredLlmFallback[] = [];
    for (const fb of input.fallbacks) {
      const prev = fb.id ? existingById.get(fb.id) : undefined;
      const fbAllowPrivate =
        typeof fb.allowPrivateNetwork === "boolean" ? fb.allowPrivateNetwork : prev?.allowPrivateNetwork ?? allowPrivate;
      await assertLlmEndpoint(fb.baseUrl, fbAllowPrivate); // 抛 LlmError -> 路由层转 400

      let fbKeyEnc = prev?.apiKeyEnc ?? null;
      const fbRawKey = typeof fb.apiKey === "string" ? fb.apiKey.trim() : undefined;
      if (fbRawKey !== undefined) {
        fbKeyEnc = fbRawKey === "" ? null : await sealKey(ctx, fbRawKey);
      }

      next.push({
        id: fb.id ?? "fb-" + randomBytes(6).toString("hex"),
        enabled: fb.enabled ?? true,
        name: fb.name ?? prev?.name ?? "备用模型",
        baseUrl: fb.baseUrl,
        model: fb.model,
        apiKeyEnc: fbKeyEnc,
        timeoutMs: fb.timeoutMs ?? prev?.timeoutMs ?? 20_000,
        temperature: fb.temperature ?? prev?.temperature ?? 0.2,
        maxTokens: fb.maxTokens ?? prev?.maxTokens ?? 1024,
        jsonMode: fb.jsonMode ?? prev?.jsonMode ?? "auto",
        allowPrivateNetwork: fbAllowPrivate,
        // 省略 = 沿用该条既有的思考开关（与 apiKey 同的「不填不改」语义）
        thinking: fb.thinking ?? prev?.thinking,
      });
    }
    fallbacks = next;
  }

  const stored: StoredLlmProvider = {
    enabled: input.enabled ?? base.enabled,
    name: input.name ?? base.name,
    baseUrl: input.baseUrl,
    model: input.model,
    apiKeyEnc,
    timeoutMs: input.timeoutMs ?? base.timeoutMs,
    temperature: input.temperature ?? base.temperature,
    maxTokens: input.maxTokens ?? base.maxTokens,
    jsonMode: input.jsonMode ?? base.jsonMode,
    // 产品默认开；显式关掉才落 false
    thinking: input.thinking ?? base.thinking ?? true,
    // 显式填 0 = 清除单价（大盘回到「未配置」），省略 = 沿用原值
    costPer1kTokensRmb: input.costPer1kTokensRmb ?? base.costPer1kTokensRmb ?? 0,
    allowPrivateNetwork: allowPrivate,
    fallbacks,
    updatedAt: Date.now(),
    updatedBy: actor,
  };

  await ctx.repo.setSystemState(SYSTEM_LLM_CONFIG_KEY, stored);
  await ctx.repo.audit({
    actor,
    action: "llm.config.set",
    target: SYSTEM_LLM_CONFIG_KEY,
    diff: {
      model: stored.model,
      baseUrl: stored.baseUrl,
      enabled: stored.enabled,
      allowPrivateNetwork: stored.allowPrivateNetwork,
      fallbackCount: stored.fallbacks.length,
      apiKeyChanged: rawKey !== undefined,
    },
    ip,
  });
  await refreshLlmCapability(ctx);
  return getSystemLlmConfigView(ctx);
}

export async function resetSystemLlmConfig(ctx: AppContext, actor: string, ip?: string): Promise<LlmConfigView> {
  await ctx.repo.deleteSystemState(SYSTEM_LLM_CONFIG_KEY);
  await ctx.repo.audit({ actor, action: "llm.config.reset", target: SYSTEM_LLM_CONFIG_KEY, ip });
  await refreshLlmCapability(ctx);
  return getSystemLlmConfigView(ctx);
}

/* ------------------------------------------------------------------ *
 * 用户级
 * ------------------------------------------------------------------ */

export interface UserLlmConfigView {
  configured: boolean;
  enabled: boolean;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  jsonMode: JsonMode;
  thinking: boolean;
  updatedAt: number | null;
  /** 系统默认摘要（不含地址与密钥），供「跟随系统」提示 */
  system: { source: "db" | "env" | "default"; name: string; model: string };
  /** 最终生效的模型信息与来源 */
  effective: { source: "user" | "system" | "env" | "default"; name: string; model: string; baseUrl: string };
}

async function systemSummary(ctx: AppContext): Promise<UserLlmConfigView["system"]> {
  const stored = await readStoredSystem(ctx);
  if (stored) return { source: "db", name: stored.name, model: stored.model };
  return {
    source: ctx.config.llm.apiKey ? "env" : "default",
    name: ctx.config.llm.name,
    model: ctx.config.llm.model,
  };
}

export async function getUserLlmConfigView(ctx: AppContext, identity: string): Promise<UserLlmConfigView> {
  const stored = await readStoredUser(ctx, identity);
  const system = await systemSummary(ctx);
  const resolved = await resolveLlm(ctx, identity);
  const effective: UserLlmConfigView["effective"] = {
    source: resolved.source,
    name: resolved.provider.name || AGNES_NAME,
    model: resolved.provider.model,
    baseUrl: resolved.provider.baseUrl,
  };
  if (!stored) {
    return {
      configured: false,
      enabled: false,
      name: "",
      baseUrl: "",
      model: "",
      hasApiKey: false,
      apiKeyMasked: "",
      timeoutMs: ctx.config.llm.timeoutMs,
      temperature: ctx.config.llm.temperature,
      maxTokens: ctx.config.llm.maxTokens,
      jsonMode: ctx.config.llm.jsonMode,
      thinking: ctx.config.llm.thinking,
      updatedAt: null,
      system,
      effective,
    };
  }
  const key = await openKey(ctx, stored.apiKeyEnc);
  return {
    configured: Boolean(key),
    enabled: stored.enabled,
    name: stored.name,
    baseUrl: stored.baseUrl,
    model: stored.model,
    hasApiKey: Boolean(key),
    apiKeyMasked: maskApiKey(key),
    timeoutMs: stored.timeoutMs,
    temperature: stored.temperature,
    maxTokens: stored.maxTokens,
    jsonMode: stored.jsonMode,
    thinking: stored.thinking ?? true,
    updatedAt: stored.updatedAt || null,
    system,
    effective,
  };
}

export async function saveUserLlmConfig(
  ctx: AppContext,
  identity: string,
  input: LlmProviderInput,
  ip?: string,
): Promise<UserLlmConfigView> {
  // 用户级一律禁私网：个人自定义端点不能成为探测内网的跳板
  await assertLlmEndpoint(input.baseUrl, false);

  const existing = await readStoredUser(ctx, identity);
  let apiKeyEnc = existing?.apiKeyEnc ?? null;
  const rawKey = typeof input.apiKey === "string" ? input.apiKey.trim() : undefined;
  if (rawKey !== undefined) {
    apiKeyEnc = rawKey === "" ? null : await sealKey(ctx, rawKey);
  }

  const stored: StoredLlmProvider = {
    enabled: input.enabled ?? true,
    name: input.name ?? existing?.name ?? "自定义模型",
    baseUrl: input.baseUrl,
    model: input.model,
    apiKeyEnc,
    timeoutMs: input.timeoutMs ?? existing?.timeoutMs ?? ctx.config.llm.timeoutMs,
    temperature: input.temperature ?? existing?.temperature ?? ctx.config.llm.temperature,
    maxTokens: input.maxTokens ?? existing?.maxTokens ?? ctx.config.llm.maxTokens,
    jsonMode: input.jsonMode ?? existing?.jsonMode ?? ctx.config.llm.jsonMode,
    thinking: input.thinking ?? existing?.thinking ?? ctx.config.llm.thinking,
    allowPrivateNetwork: false,
    fallbacks: [],
    updatedAt: Date.now(),
    updatedBy: identity,
  };

  // 无密钥的个人配置会在解析链里被跳过（等于没配），必须明确拒绝而不是静默保存
  if (!stored.apiKeyEnc) {
    throw new LlmError("config", "请填写 API 密钥：没有密钥的个人模型不会生效");
  }

  await ctx.repo.upsertUserLlmConfig(identity, stored as unknown as Record<string, unknown>);
  await ctx.repo.audit({
    actor: identity,
    actorKind: "user",
    action: "llm.config.user.set",
    target: "user_llm_configs",
    diff: { model: stored.model, apiKeyChanged: rawKey !== undefined },
    ip,
  });
  return getUserLlmConfigView(ctx, identity);
}

export async function deleteUserLlmConfig(ctx: AppContext, identity: string, ip?: string): Promise<UserLlmConfigView> {
  await ctx.repo.deleteUserLlmConfig(identity);
  await ctx.repo.audit({
    actor: identity,
    actorKind: "user",
    action: "llm.config.user.reset",
    target: "user_llm_configs",
    ip,
  });
  return getUserLlmConfigView(ctx, identity);
}

/* ------------------------------------------------------------------ *
 * 连通性测试
 * ------------------------------------------------------------------ */

export interface LlmTestResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  replyPreview: string;
  error?: string;
  code?: string;
  status?: number;
}

/**
 * 用候选配置发一次最小请求。
 * 未填密钥时按作用域取已存密钥（用户 → 系统 → 环境），便于「只改地址先测」。
 */
export async function testLlmProvider(
  ctx: AppContext,
  input: LlmProviderInput & { allowPrivateNetwork?: boolean },
  identity?: string | null,
): Promise<LlmTestResult> {
  const allowPrivate = input.allowPrivateNetwork === true;
  await assertLlmEndpoint(input.baseUrl, allowPrivate);

  let apiKey = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : null;
  if (!apiKey && identity) {
    const user = await readStoredUser(ctx, identity);
    if (user) apiKey = await openKey(ctx, user.apiKeyEnc);
  }
  if (!apiKey) {
    const system = await readStoredSystem(ctx);
    if (system) apiKey = await openKey(ctx, system.apiKeyEnc);
  }
  if (!apiKey) apiKey = ctx.config.llm.apiKey;

  if (!apiKey && !allowPrivate) {
    return { ok: false, latencyMs: 0, model: input.model, replyPreview: "", error: "尚未配置 API 密钥", code: "config" };
  }

  const startedAt = Date.now();
  try {
    const result = await chatCompletion(
      {
        baseUrl: input.baseUrl,
        model: input.model,
        apiKey,
        timeoutMs: Math.min(input.timeoutMs ?? 20_000, 30_000),
        temperature: 0,
        maxTokens: 32,
        jsonMode: input.jsonMode ?? "auto",
        // 连通性探测只要一个 token，开思考纯属浪费
        thinking: false,
        allowPrivateNetwork: allowPrivate,
      },
      {
        messages: [
          { role: "system", content: "你是连通性测试助手，只回复 ok，不要输出其它内容。" },
          { role: "user", content: "ping" },
        ],
        temperature: 0,
        maxTokens: 32,
      },
    );
    const latencyMs = result.latencyMs || (Date.now() - startedAt);
    void ctx.repo.recordLlmUsage({
      scenario: "ai_config_test",
      // source 描述的是「哪个配置层发起的测试」：带身份 = 用户级配置，否则是系统级。
      // 不能用 allowPrivateNetwork 代替 —— 它只表示是否放行内网地址，
      // 否则管理端测系统配置会被记成 user，观测面板的来源分布从此失真。
      source: identity ? "user" : "system",
      model: result.model,
      identity,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      latencyMs,
      ok: true,
    });
    return {
      ok: true,
      latencyMs,
      model: result.model,
      replyPreview: result.content.trim().slice(0, 80),
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    void ctx.repo.recordLlmUsage({
      scenario: "ai_config_test",
      source: identity ? "user" : "system",
      model: input.model,
      identity,
      latencyMs,
      ok: false,
      errorCode: err instanceof LlmError ? err.code : "network",
    });
    if (err instanceof LlmError) {
      return {
        ok: false,
        latencyMs,
        model: input.model,
        replyPreview: "",
        error: err.message,
        code: err.code,
        status: err.status,
      };
    }
    return {
      ok: false,
      latencyMs,
      model: input.model,
      replyPreview: "",
      error: err instanceof Error ? err.message : String(err),
      code: "network",
    };
  }
}
