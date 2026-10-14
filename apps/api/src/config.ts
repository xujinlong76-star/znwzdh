/**
 * 运行配置。
 *
 * 两种模式（决定数据库与向量/全文实现）：
 *   lite     -> SQLite + sqlite-vec + FTS5      单容器零外部依赖（个人 / NAS）
 *   standard -> PostgreSQL + pgvector + tsvector 多用户 / 公开站
 *
 * 所有外部依赖都可缺省：没有 LLM Key、没有模型文件时，
 * 服务必须照常启动，只是 AI 能力降级 —— 这是硬性要求，有测试覆盖。
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
  /**
   * 是否对管理面强制 Bearer token 鉴权。
   *
   * 默认 false（开放模式）：个人 / NAS 部署零配置可用，且不改变存量行为。
   * 公开部署设 NAVHUB_AUTH_REQUIRED=true 后，写类路由必须带 api_tokens 里的 token。
   */
  authRequired: boolean;
  /**
   * 引导 token（明文）：解决「启用鉴权后库里还没有 token」的鸡生蛋问题。
   *
   * 设置后，持有它的请求视同 admin——运维先用它调用 POST /api/tokens
   * 创建正式的库内 token，之后应删除本变量重启。不入库、只在内存比对。
   */
  bootstrapToken: string | null;
}

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error("缺少必需的环境变量: " + key);
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

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const mode = (env("NAVHUB_MODE", "lite") as NavHubMode);
  if (mode !== "lite" && mode !== "standard") {
    throw new Error("NAVHUB_MODE 只能是 lite 或 standard，收到: " + mode);
  }

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
      // 注意：transformers.js 不读 HF_ENDPOINT，这个值会赋给 env.remoteHost
      endpoint: env("NAVHUB_EMBEDDING_ENDPOINT", "https://hf-mirror.com"),
      dtype: (env("NAVHUB_EMBEDDING_DTYPE", "q8") as "q8"),
      cacheDir: env("NAVHUB_EMBEDDING_CACHE", "./data/models"),
      dim: num("NAVHUB_EMBEDDING_DIM", 512),
      enabled: bool("NAVHUB_EMBEDDING_ENABLED", true),
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
    corsOrigins: env("NAVHUB_CORS_ORIGINS", "*").split(",").map((s) => s.trim()).filter(Boolean),
    authRequired: bool("NAVHUB_AUTH_REQUIRED", false),
    bootstrapToken: process.env.NAVHUB_BOOTSTRAP_TOKEN || null,
  };

  if (mode === "standard" && !base.databaseUrl && !overrides.databaseUrl) {
    throw new Error("standard 模式必须提供 NAVHUB_DATABASE_URL");
  }

  return { ...base, ...overrides };
}
