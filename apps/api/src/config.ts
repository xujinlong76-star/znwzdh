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
  /**
   * 管理面静态委托凭据（可选）。
   *
   * 历史上 sessionSecret 同时充当「会话签名密钥」和「管理端 Bearer」，
   * 一旦 Web 侧泄露就等于拿到 admin。配置本项后优先使用独立凭据，
   * sessionSecret 仍保留兼容回退（轮换/拆除前不致断服）。
   */
  adminToken: string | null;
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
    /** 展示名（管理端/健康检查用） */
    name: string;
    baseUrl: string;
    apiKey: string | null;
    model: string;
    timeoutMs: number;
    temperature: number;
    maxTokens: number;
    /** JSON 约束策略：auto 时遇不支持 response_format 的端点自动去参重试 */
    jsonMode: "auto" | "response_format" | "prompt";
    /** 允许模型端点指向内网（本地 Ollama）；仅系统级配置可开启 */
    allowPrivateNetwork: boolean;
    /**
     * 深度思考（Agnes 的 chat_template_kwargs.enable_thinking）。
     * 产品决策（2026-10-19）：全站默认开启 —— 复杂任务质量优先；
     * 富化类批量场景可在系统级配置里关掉以省 token。
     */
    thinking: boolean;
    /** 独立密钥加密口令（不设则回退 sessionSecret） */
    secretsKey: string | null;
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
   * `false` 不读 X-Forwarded-For；`true` 信任整条链（取最左值，客户端可伪造）；
   * 字符串 = 可信代理网段列表（proxy-addr 语法，防伪造的正确配法）。见 trustProxyMode。
   */
  trustProxy: boolean | string;
  /**
   * 是否对管理面强制 Bearer token 鉴权
   * 默认 false（开放模式）：个人 / NAS 部署零配置可用
   */
  authRequired: boolean;
  /**
   * 引导 token（内存明文比对）：解决「开启鉴权后库内尚无 token」的初始引导问题
   */
  bootstrapToken: string | null;
  /**
   * 终端用户身份的 HMAC 签名密钥（可选）。
   *
   * 身份（userId/anonId）是纯字符串，任何持票人都能自称任何身份（IDOR）。
   * 配置本项后，带身份的请求必须携带 x-navhub-identity-signature =
   * HMAC-SHA256(secret, identity)，由前端 /api/hub/* 代理附带。
   * 不配置时行为与历史版本完全一致（零回归，可灰度）。
   */
  identitySecret: string | null;
  /**
   * 关闭身份签名的 v1 兼容回退（默认 false = 兼容窗口）。
   *
   * v1 签名是恒定值，可被无限重放；v2 引入时间戳 + nonce。代理已全部升级后
   * 置 1，仅接受 v2 三件套——否则攻击者可剥掉 v2 头退回 v1，重放防护形同虚设。
   */
  identitySignatureStrict: boolean;
  /**
   * 生产开放模式显式承认「身份未签名」（默认 false）。
   * NODE_ENV=production 且 authRequired=false 时，identitySecret 为空且本项未开
   * ⇒ 中枢拒绝启动（见 security-readiness.ts）；内网 / NAS 部署可显式设 1 退回历史行为。
   */
  allowUnsignedIdentity: boolean;
  /**
   * 我方 Web 层服务端取数的限流豁免凭据（可选，`x-navhub-internal-token`）。
   *
   * 只影响限流，不参与鉴权：web 侧所有 SSR/RSC 取数在部署上是同一个出口 IP，
   * 抓取式扫描会把 300 req/min 的按 IP 额度打穿，429 又让详情页渲染成
   * 带 `noindex` 的降级壳并被 ISR 缓存（实测见 docs/seo/ISR-ROUTES.md 5.9）。
   * 不配置时零豁免，与历史行为逐字一致。
   */
  internalToken: string | null;
  /**
   * 全局按 IP 限流的额度（次/分钟）。默认沿用历史值：测试 10000，其余 300。
   * 做成可配是因为「内部豁免」与「公网额度」这两件事都得能在部署时调，
   * 而测试要能在几毫秒内把桶打满（10000 次不可能在单测里跑完）。
   */
  rateLimitMax: number;
  /** 凭据签发与生命周期保护策略 */
  tokenPolicy: {
    maxLifetimeDays: number;
    maxActiveTokens: number;
    allowPermanentTokens: boolean;
  };
  /**
   * 会话密钥轮换环（升级 #7）。
   * previousSecret 为上一代密钥：轮换窗口期内同时接受新旧签名，
   * 新签发一律用 sessionSecret。两者都未设时 previousSecret 为 null。
   */
  previousSecret: string | null;
  /** 任务失败告警 Webhook URL；null 代表不推送（仅终端输出） */
  alertWebhook: string | null;
  /** Webhook 投递超时（毫秒，内部限制于 1s~30s 范围） */
  alertTimeoutMs: number;
  /**
   * 模型单价（人民币 / 1K token），供观测大盘估算花费。0 = 未配置。
   *
   * 以前大盘直接按 `totalTokens * 0.001` 报一个 ¥ 数：那个单价是凭空写的，
   * 既不是任何厂商的报价，也不区分 prompt/completion，等于在运维面板上放假账。
   * 现在没配单价就回 null，由界面明说「未配置单价」。
   */
  costPer1kTokensRmb: number;
  /**
   * 停用「孤儿插件类目」启动清扫。
   * 类目树迁移（scripts/taxonomy-migrate.mjs）窗口必须置 1：
   * 新树叶子在回填站点前暂无存活引用，正好落在该清扫的删除条件里。
   */
  skipOrphanCleanup: boolean;
  /**
   * LLM 每日额度（24h 滚动窗口，单位：次 / token）。0 = 关闭该档。
   *
   * 为什么必须有：`llm_usage` 以前只写不读，全站没有任何上限对照 —— 公共站上
   * 一段脚本慢慢刷 `/api/enrich`、`/api/copilot/chat`、`recommend-alternative`
   * 就能把运维者那把系统 key 的花费打穿，按 IP 的 rateLimit 只挡频率、挡不住
   * 一天内的持续消耗。详见 `llm-quota.ts`。
   *
   * 默认值给的是「正常单人/小团队一天用不到」的量级：闸门存在的意义是
   * 「无上限」这件事本身不可接受，而不是要限制正常使用。
   */
  llmQuota: {
    /** 单个身份（登录 userId / 带 anonId 的匿名访客） */
    identityDailyCalls: number;
    identityDailyTokens: number;
    /** 无身份流量（identity IS NULL：任务队列、未带 anonId 的请求）合池 */
    anonymousDailyCalls: number;
    anonymousDailyTokens: number;
    /** 运维者 key 的总预算（只数 source ≠ 'user' 的消耗） */
    systemDailyCalls: number;
    systemDailyTokens: number;
  };
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

const TRUST_PROXY_ALIASES = new Set(["loopback", "linklocal", "uniquelocal"]);
/** 只做「形状」粗校验（挡住 abc / bogus 这类拼错），CIDR 语义是否合法交给 proxy-addr 判定 */
const IP_CIDR_SHAPE_RE = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

/**
 * `NAVHUB_TRUST_PROXY` 解析。三种取值，语义差异很大：
 *
 *  - `0` / 未设 → `false`：完全不读 `X-Forwarded-For`，`req.ip` 就是 socket 对端。
 *    中枢直接暴露公网时这是唯一安全选项。
 *  - `1` / `true` → `true`：Fastify 采信**整条** XFF 链并取**最左**条目当客户端 IP。
 *    最左条目由客户端自己写 → 每个请求换一个伪造值就换一个限流桶，
 *    300/min、投稿 5/hour 这类按 IP 的限流形同虚设。保留只是为了兼容既有部署。
 *  - 其它字符串 → 原样交给 Fastify 当作 proxy-addr 的**可信代理网段列表**
 *    （如 `loopback, 172.16.0.0/12`）。只有当 socket 对端落在列表里时才解析 XFF，
 *    并取「最近一个可信代理看到的那个地址」（= 从右数第一个不可信条目），
 *    客户端塞在左边的伪造条目被忽略 —— 这才是防伪造的正确配法。
 *
 * ⚠️ 数字**不是**跳数：实测 Fastify v5 把 `trustProxy: 2` 当成「不认识的配置」，
 * XFF 整段忽略，所有人退回共享桶。所以除 `1` 以外的纯数字一律报错，
 * 而不是静默接受（`"2"` 作为网段串同样匹配不到任何东西，同样是静默失效）。
 */
function trustProxyMode(): boolean | string {
  const raw = (process.env.NAVHUB_TRUST_PROXY ?? "").trim();
  const v = raw.toLowerCase();
  if (!v || v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (/^\d+$/.test(v)) {
    throw new Error(
      `NAVHUB_TRUST_PROXY=${raw} 无效：Fastify 不支持按跳数信任代理（纯数字会让 X-Forwarded-For 整段失效，` +
        `所有访客共享一个限流桶）。请填 0（不信任）、1（信任整条链，可被伪造 XFF 绕过限流），` +
        `或可信代理网段列表如 "loopback, 172.16.0.0/12"`,
    );
  }
  const tokens = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return false;
  for (const t of tokens) {
    if (!TRUST_PROXY_ALIASES.has(t.toLowerCase()) && !IP_CIDR_SHAPE_RE.test(t)) {
      // 提前报错：proxy-addr 对非法条目抛的是 "invalid IP address: xxx"，
      // 而且是在 Fastify 构造期抛，栈里看不出是本变量配的，排查成本高。
      throw new Error(
        `NAVHUB_TRUST_PROXY 含无法识别的条目 "${t}"：只接受 proxy-addr 别名 ` +
          `(loopback / linklocal / uniquelocal) 或 IPv4/IPv6(/CIDR)`,
      );
    }
  }
  return tokens.join(", ");
}

/** jsonMode 只接受三个枚举值，非法输入静默回退 auto（不阻断启动） */
function jsonMode(key: string, fallback: "auto" | "response_format" | "prompt" = "auto"): "auto" | "response_format" | "prompt" {
  const v = (process.env[key] ?? "").trim();
  if (v === "auto" || v === "response_format" || v === "prompt") return v;
  return fallback;
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

/**
 * 判断 publicUrl 是否指向本机/内网。
 *
 * 旧实现用正则直接匹配整串 URL（`/10\./` 等），会把 `http://10.example.com`
 * 这类公网域名误判为内网，从而跳过「生产公网必须开鉴权」的硬校验。
 * 这里改为解析 hostname 后按 IP 段判断。
 */
function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }

  // IPv6 唯一本地地址（fc00::/7）与链路本地（fe80::/10）
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
}

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

  // 2b. 限流豁免凭据一旦配置就必须够长：它换到的是「不吃按 IP 额度」，
  // 短凭据可被暴力猜中，等于给公网开了一个免限流的后门。
  if (isProd && config.internalToken && config.internalToken.length < 32) {
    throw new Error(
      "生产环境的 NAVHUB_INTERNAL_TOKEN 至少 32 字符（它豁免的是按 IP 限流，弱凭据等于对公网开放免限流通道）"
    );
  }

  // 2c. 限流额度必须落在正数：0/负数会让桶永满（整站 429），NaN 会静默放行。
  if (!Number.isFinite(config.rateLimitMax) || config.rateLimitMax < 1) {
    throw new Error(`NAVHUB_RATE_LIMIT_MAX 必须是 >=1 的数字，当前 ${config.rateLimitMax}`);
  }

  // 2d. LLM 额度必须是 >=0 的整数。闸门把 0 读成「关闭该档」，于是负数或 NaN
  // （典型来源：环境变量写成 `NAVHUB_LLM_QUOTA_IDENTITY_CALLS=` 或 `30O` 打错字）
  // 会被 clampNonNegative 静默吞成 0 —— 「配置打错一个字符」= 烧钥防护整个失效，
  // 而且没有任何日志。这类闸门不能靠「配错就当作没配」活着。
  for (const [key, value] of Object.entries(config.llmQuota)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`LLM 额度 ${key} 必须是 >=0 的整数（0 = 关闭该档），当前收到 ${String(value)}`);
    }
  }

  // 3b. 生产环境不允许把全部 LLM 额度一起关掉。
  //
  // 三档全 0 意味着「闸门形同不存在」，而生产站正是匿名流量能摸到系统 key 的
  // 那种部署。要关闸门得有意识地关（显式 NAVHUB_LLM_QUOTA_DISABLED=1），
  // 不能让「六个变量都没配」这种默认状态长成无上限。
  if (isProd && !process.env.NAVHUB_LLM_QUOTA_DISABLED?.trim()) {
    const q = config.llmQuota;
    const allDisabled =
      q.identityDailyCalls === 0 &&
      q.identityDailyTokens === 0 &&
      q.anonymousDailyCalls === 0 &&
      q.anonymousDailyTokens === 0 &&
      q.systemDailyCalls === 0 &&
      q.systemDailyTokens === 0;
    if (allDisabled) {
      throw new Error(
        "生产环境不允许同时关闭全部 LLM 额度档位（六个 NAVHUB_LLM_QUOTA_* 全为 0）：" +
          "这等于对匿名流量开放无上限的系统密钥消耗。" +
          "确需自管额度时显式设置 NAVHUB_LLM_QUOTA_DISABLED=1。"
      );
    }
  }

  // 3. 生产公网暴露鉴权守护（防管理后台未授权公开裸奔）
  //
  // 仅靠 publicUrl 判断会有一个致命缺口：未显式配置时默认值是 localhost，
  // 于是一次漏配就让「公网 + 未开鉴权」被当成内网部署放行。
  // 生产环境未开鉴权时，必须**显式**声明 publicUrl（哪怕是 localhost），
  // 让「我不知道自己部署在哪」无法成为逃生阀。
  if (isProd && !config.authRequired && !process.env.NAVHUB_PUBLIC_URL?.trim()) {
    throw new Error(
      "生产环境未开启鉴权时，必须显式设置 NAVHUB_PUBLIC_URL（例如 http://localhost:8787 或 https://your-domain）。" +
        "未配置时的 localhost 默认值会让公网部署绕过鉴权守护。"
    );
  }

  if (isProd && !config.adminToken) {
    console.warn(
      "[navhub] 警告：未设置 NAVHUB_ADMIN_TOKEN，管理端仍可将 NAVHUB_SESSION_SECRET 作为静态凭据使用；" +
        "建议拆分出独立的管理 token，避免会话签名密钥泄露即等于 admin。"
    );
  }

  // 解析失败按「公网」处理：宁可多要一次鉴权，也不能让畸形 URL 成为逃生阀
  let isLocalPublic = false;
  try {
    isLocalPublic = isLocalHostname(new URL(config.publicUrl).hostname);
  } catch {
    isLocalPublic = false;
  }

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

/**
 * 测试/嵌入式装配用的覆盖项：四个子配置允许「部分字段」覆盖，
 * 其余顶层字段保持 Partial。这样新增配置项不会强迫所有调用点同步补齐。
 */
export type ConfigOverrides = Partial<
  Omit<AppConfig, "llm" | "embedding" | "fetch" | "tokenPolicy" | "llmQuota">
> & {
  llm?: Partial<AppConfig["llm"]>;
  embedding?: Partial<AppConfig["embedding"]>;
  fetch?: Partial<AppConfig["fetch"]>;
  tokenPolicy?: Partial<AppConfig["tokenPolicy"]>;
  llmQuota?: Partial<AppConfig["llmQuota"]>;
};

export function loadConfig(overrides: ConfigOverrides = {}): AppConfig {
  const mode = env("NAVHUB_MODE", "lite") as NavHubMode;
  if (mode !== "lite" && mode !== "standard") {
    throw new Error(`NAVHUB_MODE 只能是 lite 或 standard，收到: ${mode}`);
  }

  const isProd = (process.env.NODE_ENV ?? "") === "production";
  const isTest = (process.env.NODE_ENV ?? "") === "test";
  const allowInsecurePublic = bool("NAVHUB_ALLOW_INSECURE_PUBLIC", false);

  const base: AppConfig = {
    mode,
    port: process.env.NAVHUB_PORT ? num("NAVHUB_PORT", 8787) : num("PORT", 8787),
    host: env("NAVHUB_HOST", env("HOST", "0.0.0.0")),
    publicUrl: env("NAVHUB_PUBLIC_URL", "http://localhost:8787"),
    sessionSecret: env("NAVHUB_SESSION_SECRET", "insecure-dev-secret-change-me"),
    adminToken: process.env.NAVHUB_ADMIN_TOKEN?.trim() || null,
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
      // 默认模型：Agnes 3.0 Flash（OpenAI 兼容 /v1/chat/completions）。
      // 密钥只从环境变量或管理端加密配置读取，代码里不留任何密钥。
      name: env("NAVHUB_LLM_NAME", "Agnes 3.0 Flash"),
      baseUrl: env("NAVHUB_LLM_BASE_URL", "https://api.agnes-ai.cn/v1"),
      apiKey: process.env.NAVHUB_LLM_API_KEY || null,
      model: env("NAVHUB_LLM_MODEL", "agnes-3.0-flash"),
      timeoutMs: num("NAVHUB_LLM_TIMEOUT_MS", 20_000),
      temperature: num("NAVHUB_LLM_TEMPERATURE", 0.2),
      maxTokens: num("NAVHUB_LLM_MAX_TOKENS", 1024),
      jsonMode: jsonMode("NAVHUB_LLM_JSON_MODE", "auto"),
      allowPrivateNetwork: bool("NAVHUB_LLM_ALLOW_PRIVATE", false),
      thinking: bool("NAVHUB_LLM_THINKING", true),
      secretsKey: process.env.NAVHUB_SECRETS_KEY?.trim() || null,
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

    trustProxy: trustProxyMode(),

    authRequired: bool("NAVHUB_AUTH_REQUIRED", false),
    bootstrapToken: process.env.NAVHUB_BOOTSTRAP_TOKEN || null,
    identitySecret: process.env.NAVHUB_IDENTITY_SECRET || null,
    identitySignatureStrict: bool("NAVHUB_IDENTITY_SIGNATURE_STRICT", false),
    allowUnsignedIdentity: bool("NAVHUB_ALLOW_UNSIGNED_IDENTITY", false),
    internalToken: process.env.NAVHUB_INTERNAL_TOKEN?.trim() || null,
    // 默认值刻意保持历史口径：只有显式配置才改变限流强度
    rateLimitMax: num("NAVHUB_RATE_LIMIT_MAX", process.env.NODE_ENV === "test" ? 10_000 : 300),

    tokenPolicy: {
      maxLifetimeDays: num("NAVHUB_TOKEN_MAX_LIFETIME_DAYS", 365),
      allowPermanentTokens: bool("NAVHUB_TOKEN_ALLOW_PERMANENT", false),
      maxActiveTokens: num("NAVHUB_TOKEN_MAX_ACTIVE", 50),
    },

    // 密钥轮换：上一代密钥仍接受校验（不断签），新签发只用新密钥
    previousSecret: process.env.NAVHUB_SESSION_SECRET_PREV || null,

    alertWebhook: process.env.NAVHUB_ALERT_WEBHOOK?.trim() || null,
    alertTimeoutMs: num("NAVHUB_ALERT_TIMEOUT_MS", 5_000),
    costPer1kTokensRmb: num("NAVHUB_LLM_COST_PER_1K_TOKENS", 0),

    // 测试环境默认全 0（关闭闸门）：单测要能在毫秒级构造「额度耗尽」的场景，
    // 靠真实默认值不可能跑到上限；关闭后由 llm-quota.test.ts 显式注入上限。
    llmQuota: {
      identityDailyCalls: num("NAVHUB_LLM_QUOTA_IDENTITY_CALLS", isTest ? 0 : 300),
      identityDailyTokens: num("NAVHUB_LLM_QUOTA_IDENTITY_TOKENS", isTest ? 0 : 1_500_000),
      anonymousDailyCalls: num("NAVHUB_LLM_QUOTA_ANON_CALLS", isTest ? 0 : 60),
      anonymousDailyTokens: num("NAVHUB_LLM_QUOTA_ANON_TOKENS", isTest ? 0 : 300_000),
      systemDailyCalls: num("NAVHUB_LLM_QUOTA_SYSTEM_CALLS", isTest ? 0 : 5_000),
      systemDailyTokens: num("NAVHUB_LLM_QUOTA_SYSTEM_TOKENS", isTest ? 0 : 4_000_000),
    },

    skipOrphanCleanup: bool("NAVHUB_SKIP_ORPHAN_CLEANUP", false),
  };

  const finalConfig: AppConfig = {
    ...base,
    ...overrides,
    embedding: { ...base.embedding, ...(overrides.embedding ?? {}) },
    llm: { ...base.llm, ...(overrides.llm ?? {}) },
    fetch: { ...base.fetch, ...(overrides.fetch ?? {}) },
    tokenPolicy: { ...base.tokenPolicy, ...(overrides.tokenPolicy ?? {}) },
    llmQuota: { ...base.llmQuota, ...(overrides.llmQuota ?? {}) },
  };
  assertSecurityConstraints(finalConfig, isProd, allowInsecurePublic);

  return finalConfig;
}
