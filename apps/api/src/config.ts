/**
 * 运行配置与环境装配模块 (Runtime Configuration & Environment Assembly)
 *
 * 架构支持双运行形态：
 *   - lite:     SQLite + sqlite-vec + FTS5（个人 / NAS / 容器单机零外部依赖运行）
 *   - standard: PostgreSQL + pgvector + tsvector（多节点 / 高并发生产环境）
 *
 * 外部依赖缺省策略：
 *   即便缺少 LLM API Key 或未下载本地向量权重，中枢服务仍将平稳启动并自动降级为
 *   混合启发式逻辑，保障核心导航与搜索的高可用性（具备完整自动化测试验证保护）。
 */

export type NavHubMode = "lite" | "standard";

export interface AppConfig {
  mode: NavHubMode;
  port: number;
  host: string;
  publicUrl: string;
  sessionSecret: string;
  sqlitePath: string;
  databaseUrl: string | null;
  embedding: {
    model: string;
    endpoint: string;
    dtype: "q8" | "fp16" | "fp32" | "q4";
    cacheDir: string;
    dim: number;
    enabled: boolean;
    useWorker: boolean;
  };
  llm: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    timeoutMs: number;
  };
  fetch: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    allowPrivateNetworks: boolean;
    userAgent: string;
  };
  corsOrigins: string[];
  trustProxy: boolean;
  /**
   * 是否对管理面强制 Bearer token 鉴权
   * 默认 false（开放模式）：个人 / NAS 部署零配置可用
   */
  authRequired: boolean;
  /**
   * 引导 token（内存明文比对）：解决「开启鉴权后库内尚无 token」的初始引导问题
   */
  bootstrapToken: string | null;
  /** 凭据签发与生命周期保护策略 */
  tokenPolicy: {
    maxLifetimeDays: number;
    maxActiveTokens: number;
    allowPermanentTokens: boolean;
  };
  /** 任务失败告警 Webhook URL；null 代表不推送（仅终端输出） */
  alertWebhook: string | null;
  /** Webhook 投递超时（毫秒，内部限制于 1s~30s 范围） */
  alertTimeoutMs: number;
}

/* ------------------------------------------------------------------ *
 * 环境变量安全提取辅助 (Environment Extraction Helpers)
 * ------------------------------------------------------------------ */

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`缺少必需的环境变量: ${key}`);
  }
  return v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

const INSECURE_SECRETS_BLACKLIST = new Set([
  "change-me-please-use-a-long-random-string",
  "insecure-dev-secret-change-me",
  "change-me-in-production",
  "change-me-in-production-min-32-chars-secret-key",
]);

const VALID_EMBEDDING_DTYPES = new Set(["q8", "fp16", "fp32", "q4"]);

/* ------------------------------------------------------------------ *
 * 生产安全断言校验 (Production Guard Asserter)
 * ------------------------------------------------------------------ */

function assertSecurityConstraints(
  config: AppConfig,
  isProd: boolean,
  allowInsecurePublic: boolean
): void {
  // 1. 生产环境密钥强度校验
  const secret = process.env.NAVHUB_SESSION_SECRET;
  if (isProd && (!secret || secret.length < 32 || INSECURE_SECRETS_BLACKLIST.has(secret))) {
    throw new Error(
      "生产环境必须设置 NAVHUB_SESSION_SECRET（>=32 字符随机串），当前为默认值/过短"
    );
  }

  // 2. 数据库模式一致性校验
  if (config.mode === "standard" && !config.databaseUrl) {
    throw new Error("standard 模式必须提供 NAVHUB_DATABASE_URL");
  }

  // 3. 生产公网暴露鉴权守护（防管理后台未授权公开裸奔）
  const isLocalPublic = /localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])/.test(
    config.publicUrl
  );

  if (!isLocalPublic && !config.authRequired) {
    if (isProd && !allowInsecurePublic) {
      throw new Error(
        "生产环境公网部署必须开启鉴权：请设置 NAVHUB_AUTH_REQUIRED=true（并配 NAVHUB_BOOTSTRAP_TOKEN 引导首个 token）；" +
          "若确为不可公网访问的内网部署，显式设置 NAVHUB_ALLOW_INSECURE_PUBLIC=1 可退回警告模式"
      );
    }
    console.warn(
      "[navhub] 警告：publicUrl 指向公网但 NAVHUB_AUTH_REQUIRED=false，管理面默认开放，建议设为 true"
    );
  }

  // 4. 量化格式合法性预检
  if (!VALID_EMBEDDING_DTYPES.has(config.embedding.dtype)) {
    throw new Error(`NAVHUB_EMBEDDING_DTYPE 非法: ${config.embedding.dtype}`);
  }
}

/* ------------------------------------------------------------------ *
 * 配置聚合装配入口 (Config Assembler)
 * ------------------------------------------------------------------ */

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const mode = env("NAVHUB_MODE", "lite") as NavHubMode;
  if (mode !== "lite" && mode !== "standard") {
    throw new Error(`NAVHUB_MODE 只能是 lite 或 standard，收到: ${mode}`);
  }

  const isProd = (process.env.NODE_ENV ?? "") === "production";
  const allowInsecurePublic = bool("NAVHUB_ALLOW_INSECURE_PUBLIC", false);

  const base: AppConfig = {
    mode,
    port: process.env.NAVHUB_PORT ? num("NAVHUB_PORT", 8787) : num("PORT", 8787),
    host: env("NAVHUB_HOST", env("HOST", "0.0.0.0")),
    publicUrl: env("NAVHUB_PUBLIC_URL", "http://localhost:8787"),
    sessionSecret: env("NAVHUB_SESSION_SECRET", "insecure-dev-secret-change-me"),
    sqlitePath: env("NAVHUB_SQLITE_PATH", env("NAVHUB_DB_PATH", "./data/navhub.db")),
    databaseUrl: process.env.NAVHUB_DATABASE_URL || null,

    embedding: {
      model: env("NAVHUB_EMBEDDING_MODEL", "Xenova/bge-small-zh-v1.5"),
      endpoint: env("NAVHUB_EMBEDDING_ENDPOINT", "https://hf-mirror.com"),
      dtype: env("NAVHUB_EMBEDDING_DTYPE", "q8") as "q8",
      cacheDir: env("NAVHUB_EMBEDDING_CACHE", "./data/models"),
      dim: num("NAVHUB_EMBEDDING_DIM", 512),
      enabled: bool("NAVHUB_EMBEDDING_ENABLED", true),
      useWorker: bool("NAVHUB_WORKER_EMBEDDING", true),
    },

    llm: {
      baseUrl: env("NAVHUB_LLM_BASE_URL", "https://api.deepseek.com"),
      apiKey: process.env.NAVHUB_LLM_API_KEY || null,
      model: env("NAVHUB_LLM_MODEL", "deepseek-chat"),
      timeoutMs: num("NAVHUB_LLM_TIMEOUT_MS", 20_000),
    },

    fetch: {
      timeoutMs: num("NAVHUB_FETCH_TIMEOUT_MS", 10_000),
      maxBytes: num("NAVHUB_FETCH_MAX_BYTES", 2 * 1024 * 1024),
      maxRedirects: num("NAVHUB_FETCH_MAX_REDIRECTS", 3),
      allowPrivateNetworks: bool("NAVHUB_ALLOW_PRIVATE_NETWORKS", false),
      userAgent: env("NAVHUB_USER_AGENT", "NavHubBot/0.1"),
    },

    corsOrigins: env("NAVHUB_CORS_ORIGINS", "*")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),

    trustProxy:
      process.env.NAVHUB_TRUST_PROXY === "1" ||
      process.env.NAVHUB_TRUST_PROXY?.toLowerCase() === "true",

    authRequired: bool("NAVHUB_AUTH_REQUIRED", false),
    bootstrapToken: process.env.NAVHUB_BOOTSTRAP_TOKEN || null,

    tokenPolicy: {
      maxLifetimeDays: num("NAVHUB_TOKEN_MAX_LIFETIME_DAYS", 365),
      allowPermanentTokens: bool("NAVHUB_TOKEN_ALLOW_PERMANENT", false),
      maxActiveTokens: num("NAVHUB_TOKEN_MAX_ACTIVE", 50),
    },

    alertWebhook: process.env.NAVHUB_ALERT_WEBHOOK?.trim() || null,
    alertTimeoutMs: num("NAVHUB_ALERT_TIMEOUT_MS", 5_000),
  };

  const finalConfig: AppConfig = {
    ...base,
    ...overrides,
    embedding: { ...base.embedding, ...(overrides.embedding ?? {}) },
    llm: { ...base.llm, ...(overrides.llm ?? {}) },
    fetch: { ...base.fetch, ...(overrides.fetch ?? {}) },
    tokenPolicy: { ...base.tokenPolicy, ...(overrides.tokenPolicy ?? {}) },
  };
  assertSecurityConstraints(finalConfig, isProd, allowInsecurePublic);

  return finalConfig;
}
