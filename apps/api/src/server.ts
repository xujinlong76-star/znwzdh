/**
 * NavHub 中枢服务（Fastify）。
 *
 * 设计原则：
 *  - 所有响应都带 capability 信息，让前端能如实提示「语义检索是否可用」，
 *    而不是在缺模型时静默返回更差的结果。
 *  - 写操作全部走 zod 校验 + 审计落库。
 *  - MCP 与 REST 共用同一套仓储与检索引擎（见 packages/mcp）。
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalizeUrl,
  clampToBall,
  computeHyperbolicAlternativeScore,
  findMatchingArchitectureRecipe,
  generateDeterministicSvg,
  lorentzDistance,
  parseTechComparisonQuery,
  poincareToLorentz,
  PRESET_RECIPES,
  runAutonomousHealing,
  findShortestTechPath,
  computeGraphCentrality,
  analyzeStackCompatibility,
  PRESET_TECH_GRAPH,
  autoClusterSites,
  mergeOperationLogs,
  compactOperationLogs,
  reduceOperationsToState,
  analyzeColorPalette,
  parseSpeculativeIntent,
  rankItemsWithPrivacy,
  privatizeVector,
  compileSpeculationRules,
  renderSpeculationRulesScript,
  generateFallbackLinkTags,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  parseOpenApiToSpecs,
  P2PMeshNode,
  type P2PMessage,
  type MinimalOpenApiSpec,
  WebMcpBridge,
  type JsonRpcRequest,
  type CRDTOperation,
  type RetrievalChannel,
  SiteCreateBody,
  RunJobInput,
} from "@navhub/core";
import { enrichUrl } from "@navhub/ai";
import type { AppContext } from "./context.ts";
import { createContext } from "./context.ts";
import { loadConfig } from "./config.ts";
import { readStoragePath, writeStoragePath } from "./storage.ts";
import { indexSite } from "./index-site.ts";
import { refreshUserProfile, resetUserProfile } from "./profile-service.ts";
import { buildOpenApiDoc, renderDocsHtml, type RouteEntry } from "./openapi.ts";
import {
  ANONYMOUS_IDENTITY,
  bearerOf,
  generateToken,
  hashToken,
  parseScopes,
  scopeSatisfies,
  secureEqual,
  tokenPrefixOf,
  type ApiScope,
  type AuthIdentity,
  type RouteScope,
} from "./auth.ts";

/**
 * 鉴权失败审计的节流窗口：同一 IP + 同一失败动作，在这个间隔内只记一条。
 * 失败路径是未认证的，不节流会让"刷失败请求"变成撑爆 audit_logs 的新攻击面。
 */
const AUTH_FAIL_AUDIT_THROTTLE_MS = 10_000;
const AUTH_FAIL_AUDIT_AT = new Map<string, number>();

/**
 * site.id → 数值投稿编号，与前端（Next 侧）的 hashNumericId 规则必须一致。
 * 算法：djb2 变体（((hash<<5)-hash)+ch），与 apps/web 的 hashNumericId 相同。
 * 注意：djb2 32bit 易碰撞且反查靠 listSites(limit 1000) 截断匹配（见 PATCH /api/submissions/:number）；
 * 超 1000 投稿会被截断漏掉。保留兼容旧前端，新前端逐步切 siteId 直传。
 */
export function submissionNumber(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

export async function buildServer(ctx: AppContext) {
  // 测试里默认静音，避免日志淹没断言输出；生产用 NAVHUB_LOG_LEVEL 控制
  const logLevel = process.env.NAVHUB_LOG_LEVEL ?? (process.env.VITEST ? "silent" : "info");
  // 信任 X-Forwarded-For：只有经过自家 /api/hub/* 代理时才开（由 ctx.config.trustProxy 统一解析，见 config.ts）。
  // 默认关闭（直连公网伪造 XFF 可绕过按 IP 限流）；docker/docker-compose.yml 经代理时默认注入 NAVHUB_TRUST_PROXY=1。
  // 不开启时 req.ip 会退化成代理地址，按 IP 的限流（300/min、投稿 5/hour）会整站共享一桶——按部署拓扑二选一。
  const app = Fastify({
    logger: { level: logLevel },
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: ctx.config.trustProxy,
  });

  // CORS：credentials:true 不能配 origin:*（浏览器会拒绝），* 时退为不带凭据
  const allowAll = ctx.config.corsOrigins.includes("*");
  await app.register(cors, {
    origin: allowAll ? true : ctx.config.corsOrigins,
    credentials: !allowAll,
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  /* ---------------------------- 指标采集（Prometheus） ---------------------------- */

  /**
   * 轻量进程内指标：不引入 prom-client，避免为一个 /metrics 端点加依赖。
   * 只记「有界基数」维度（method / 路由模板 / 状态码），绝不以原始 URL 作标签
   * ——否则 /api/search?q=xxx 会让时间序列爆炸（cardinality 失控是 Prometheus 头号杀手）。
   * 路由模板取自 Fastify 的 routeOptions.url（如 /api/sites/:id），天然有界。
   */
  const metricsStartedAt = Date.now();
  /** key: method\u0000route\u0000status -> 次数 */
  const httpCounts = new Map<string, number>();
  /** key: method\u0000route -> 累计耗时 */
  const httpDurations = new Map<string, { count: number; sumMs: number }>();

  app.addHook("onResponse", async (req, reply) => {
    const route = (req.routeOptions?.url as string | undefined) ?? "unmatched";
    if (route === "/api/metrics") return; // 不把抓取自身计入，避免自反馈噪音
    const ckey = req.method + "\u0000" + route + "\u0000" + String(reply.statusCode);
    httpCounts.set(ckey, (httpCounts.get(ckey) ?? 0) + 1);
    const dkey = req.method + "\u0000" + route;
    const d = httpDurations.get(dkey) ?? { count: 0, sumMs: 0 };
    d.count += 1;
    d.sumMs += Number(reply.elapsedTime ?? 0);
    httpDurations.set(dkey, d);
  });

  /** 转义 Prometheus 文本格式的标签值（反斜杠 / 引号 / 换行） */
  const escLabel = (v: string): string => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  /** 还原采集时的复合 key；缺失位以空串兜底（noUncheckedIndexedAccess 友好） */
  const splitKey = (k: string): [string, string, string] => {
    const p = k.split("\u0000");
    return [p[0] ?? "", p[1] ?? "", p[2] ?? ""];
  };

  /** DB 统计加重询，避免 Prometheus 高频抓取把 COUNT 打满（5s 内复用） */
  let statsCache: { at: number; value: Awaited<ReturnType<typeof ctx.repo.stats>> } | null = null;
  async function cachedStats() {
    if (statsCache && Date.now() - statsCache.at < 5000) return statsCache.value;
    const value = await ctx.repo.stats();
    statsCache = { at: Date.now(), value };
    return value;
  }

  async function renderMetrics(): Promise<string> {
    const out: string[] = [];
    const metric = (name: string, help: string, type: "gauge" | "counter" | "summary", lines: string[]) => {
      if (lines.length === 0) return;
      out.push("# HELP " + name + " " + help);
      out.push("# TYPE " + name + " " + type);
      out.push(...lines);
    };
    const gauge = (name: string, help: string, value: number, labels = "") =>
      metric(name, help, "gauge", [name + labels + " " + value]);

    const mem = process.memoryUsage();
    const caps = ctx.capabilities;
    const embeddingReady = ctx.embedding ? ctx.embedding.ready() : false;
    const stats = await cachedStats();

    out.push("# HELP navhub_build_info 构建与运行模式信息（值恒为 1）");
    out.push("# TYPE navhub_build_info gauge");
    out.push(`navhub_build_info{mode="${escLabel(ctx.config.mode)}",node="${escLabel(process.version)}"} 1`);

    gauge("navhub_up", "进程存活（值恒为 1）", 1);
    gauge("navhub_process_uptime_seconds", "进程运行时长（秒）", Math.round((Date.now() - metricsStartedAt) / 1000));
    gauge("navhub_process_resident_memory_bytes", "常驻内存 RSS（字节）", mem.rss);
    gauge("navhub_process_heap_used_bytes", "V8 堆已用（字节）", mem.heapUsed);
    gauge("navhub_process_heap_total_bytes", "V8 堆总量（字节）", mem.heapTotal);

    // 能力开关：0/1，便于告警「语义检索掉线」
    metric("navhub_capability", "能力开关（1=可用）", "gauge", [
      `navhub_capability{name="semantic"} ${caps.semantic ? 1 : 0}`,
      `navhub_capability{name="fts"} ${caps.fts ? 1 : 0}`,
      `navhub_capability{name="llm"} ${caps.llm ? 1 : 0}`,
    ]);
    gauge("navhub_embedding_ready", "embedding 模型是否已加载", embeddingReady ? 1 : 0);

    // 数据规模
    metric("navhub_sites", "站点数（按状态）", "gauge", [
      `navhub_sites{status="active"} ${stats.sites}`,
      `navhub_sites{status="broken"} ${stats.broken}`,
      `navhub_sites{status="pending"} ${stats.pending}`,
      `navhub_sites{status="trashed"} ${stats.trashed}`,
    ]);
    gauge("navhub_categories_total", "分类数", stats.categories);
    gauge("navhub_tags_total", "标签数", stats.tags);

    // HTTP：请求计数（method × 路由模板 × 状态码）
    const countLines = [...httpCounts.entries()].map(([k, n]) => {
      const [method, route, status] = splitKey(k);
      return `navhub_http_requests_total{method="${escLabel(method)}",route="${escLabel(route)}",status="${escLabel(status)}"} ${n}`;
    }).sort();
    metric("navhub_http_requests_total", "HTTP 请求总数", "counter", countLines);

    // HTTP：耗时（summary：_sum 秒 + _count）
    const durLines: string[] = [];
    for (const [k, d] of [...httpDurations.entries()].sort()) {
      const [method, route] = splitKey(k);
      const labels = `{method="${escLabel(method)}",route="${escLabel(route)}"}`;
      durLines.push(`navhub_http_request_duration_seconds_sum${labels} ${(d.sumMs / 1000).toFixed(6)}`);
      durLines.push(`navhub_http_request_duration_seconds_count${labels} ${d.count}`);
    }
    metric("navhub_http_request_duration_seconds", "HTTP 请求耗时（秒）", "summary", durLines);

    return out.join("\n") + "\n";
  }

  // 全局错误兜底：统一 500 形态，避免 Fastify 默认 HTML 泄漏栈
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const status = typeof (err as { statusCode?: unknown }).statusCode === "number"
      ? (err as { statusCode: number }).statusCode : 500;
    reply.code(status >= 400 && status < 600 ? status : 500).send({ error: status === 500 ? "内部错误" : (err as Error).message });
  });

  /* ---------------------------- OpenAPI 路由收集 ---------------------------- */

  /**
   * onRoute 在每条路由注册时触发——文档与真实路由**同源**，不会手写漂移。
   * 必须在任何 app.get/post… 之前注册，否则收不到已有路由。
   */
  const routeEntries: RouteEntry[] = [];
  app.addHook("onRoute", (route) => {
    const method = typeof route.method === "string" ? route.method : String(route.method);
    const scope = ((route.config as { scope?: RouteScope } | undefined)?.scope ?? "public") as RouteScope;
    routeEntries.push({ method: method.toUpperCase(), url: route.url, scope });
  });

  app.get("/api/openapi.json", { config: { scope: "public", cache: { maxAge: 60 } } }, async () =>
    buildOpenApiDoc(routeEntries.filter((r) => r.url !== "/api/openapi.json" && r.url !== "/api/docs")),
  );
  app.get("/api/docs", { config: { scope: "public", cache: { maxAge: 60 } } }, async (_req, reply) => {
    const doc = buildOpenApiDoc(routeEntries.filter((r) => r.url !== "/api/openapi.json" && r.url !== "/api/docs"));
    reply.header("content-type", "text/html; charset=utf-8");
    return renderDocsHtml(doc);
  });

  /* ---------------------------- 响应缓存 ---------------------------- */

  /**
   * 路由级缓存策略（在 route config 里声明 `cache: { maxAge, etag }`）。
   * 不声明 = `no-store`（见下方 hook）——这是刻意的安全默认：
   * GET 缺缓存头时，浏览器与中间代理会走「启发式缓存」，
   * 可能把管理面/含身份的数据缓存下来，属于静默的正确性风险。
   */
  interface CachePolicy {
    /** 秒；0 = 每次再验证（`private, no-cache`，配合 ETag 用 304 省流量） */
    maxAge: number;
    /** 生成 ETag 并处理 If-None-Match → 304 */
    etag?: boolean;
  }

  app.addHook("onSend", async (req, reply, payload) => {
    const policy = (req.routeOptions?.config as { cache?: CachePolicy } | undefined)?.cache;
    if (req.method !== "GET" || !policy || reply.statusCode !== 200) {
      reply.header("cache-control", "no-store");
      return payload;
    }
    // private：避免共享代理（CDN/nginx）把不同用户/不同 token 的响应串在一起。
    // TTL 只省浏览器端重复请求，不牺牲隔离性。
    reply.header("cache-control", policy.maxAge > 0 ? "private, max-age=" + policy.maxAge : "private, no-cache");

    if (!policy.etag || typeof payload !== "string") return payload;
    const etag = '"' + createHash("sha1").update(payload).digest("base64url") + '"';
    reply.header("etag", etag);
    const inm = String(req.headers["if-none-match"] ?? "");
    const matched = inm.split(",").some((v) => v.trim().replace(/^W\//, "") === etag);
    if (matched) {
      reply.code(304);
      // 304 不允许带 body；Fastify 不会自动清这两个头，残留会与空 body 冲突
      reply.removeHeader("content-type");
      reply.removeHeader("content-length");
      return "";
    }
    return payload;
  });

  /* ---------------------------- 鉴权 ---------------------------- */

  /**
   * 路由分级：
   *   public  终端用户功能（搜索 / 事件 / 收藏 / 投稿 / 榜单 / 健康），匿名可用
   *   read    管理面只读（列表 / 统计 / 审计查询）
   *   write   管理面写入（站点与类目 CRUD / 任务入队 / 存储写入 / 富化）
   *   admin   高危（token 管理 / 删除站点）
   *
   * 开放模式（默认）下 hook 只挂载身份、不做拦截，行为与历史版本完全一致；
   * 开启 NAVHUB_AUTH_REQUIRED 后，read/write/admin 路由必须带 Bearer token，
   * 且 token 的 scope 不低于路由要求（admin ⊇ write ⊇ read）。
   */
  app.addHook("onRequest", async (req, reply) => {
    const required = ((req.routeOptions?.config as { scope?: RouteScope } | undefined)?.scope ?? "public") as RouteScope;
    const auth: AuthIdentity = { ...ANONYMOUS_IDENTITY };
    req.auth = auth;

    if (!ctx.config.authRequired || required === "public") return;

    /**
     * 鉴权失败落审计。
     *
     * 此前 401/403 只回一个错误体就结束，审计日志里一片空白。后果是：
     * 有人拿泄露的凭据在扫接口、或在枚举 token，运维完全看不见，
     * 事后也无法还原"哪条凭据被滥用过"。
     *
     * 两条硬约束：
     *  1. **绝不记录凭据本身**——明文与哈希都不写进 diff，只写原因与路径。
     *  2. **按 IP+动作节流**：失败路径是未认证的，不节流的话攻击者可以
     *     用一堆失败请求把 audit_logs 撑爆，反而形成新的 DoS 面。
     */
    const auditAuthFailure = (action: string, detail: string, target: string | null = null): void => {
      const now = Date.now();
      const key = action + "|" + (req.ip ?? "-");
      const last = AUTH_FAIL_AUDIT_AT.get(key) ?? 0;
      if (now - last < AUTH_FAIL_AUDIT_THROTTLE_MS) return;
      AUTH_FAIL_AUDIT_AT.set(key, now);
      void ctx.repo.audit({
        ip: req.ip,
        actor: "anonymous",
        actorKind: "anonymous",
        action,
        target: target ?? undefined,
        diff: { detail, path: req.url, required },
      }).catch(() => undefined);
    };

    const token = bearerOf(req);
    if (!token) {
      void auditAuthFailure("auth.missing_token", "缺少 Bearer token，要求 " + required);
      return reply.code(401).send({ error: "缺少 Bearer token（该路由要求 " + required + " 权限）" });
    }

    // 引导 token：内存比对，视同 admin。用于首次创建库内 token 的一次性 bootstrap
    if (ctx.config.bootstrapToken && secureEqual(token, ctx.config.bootstrapToken)) {
      auth.actor = "bootstrap";
      auth.kind = "static";
      auth.scopes = ["read", "write", "admin"];
      return;
    }

    const record = await ctx.repo.findApiTokenByHash(hashToken(token));
    if (!record) {
      void auditAuthFailure("auth.invalid_token", "token 无效 / 已过期 / 已吊销");
      return reply.code(401).send({ error: "token 无效或已过期" });
    }
    const tokenScopes = parseScopes(Array.isArray(record.scopes) ? record.scopes.join(",") : String(record.scopes ?? ""));
    if (!scopeSatisfies(tokenScopes, required)) {
      void auditAuthFailure("auth.scope_denied", "需要 " + required + "，当前 " + tokenScopes.join(","), record.id);
      return reply.code(403).send({ error: "token 的 scope 不足以执行该操作（需要 " + required + "，当前 " + tokenScopes.join(",") + "）" });
    }

    // 鉴权通过：写入真实身份，审计从这一刻起记录「谁」而不是笼统的 "api"
    auth.actor = record.name;
    auth.kind = "token";
    auth.tokenId = record.id;
    auth.scopes = tokenScopes;
    void ctx.repo.touchApiToken(record.id).catch(() => undefined);
  });

  /* ---------------------------- 健康与能力 ---------------------------- */

  app.get("/api/health", { config: { cache: { maxAge: 15 } } }, async () => ({
    ok: true,
    mode: ctx.config.mode,
    capabilities: ctx.capabilities,
    stats: await ctx.repo.stats(),
    embedding: ctx.embedding?.stats ? { cache: ctx.embedding.stats() } : undefined,
  }));

  // 就绪探针：compose depends_on 应指 /ready（迁移水位+embedding 就绪），/health 仅表进程存活
  app.get("/api/ready", async () => {
    const embeddingReady = ctx.embedding ? ctx.embedding.ready() : false;
    const semantic = Boolean(ctx.embedding && ctx.vectors && embeddingReady);
    return { ok: true, mode: ctx.config.mode, semantic, embeddingReady, fts: Boolean(ctx.fts) };
  });

  /**
   * Prometheus 指标（文本格式）。
   * 权限位 read：开放模式（默认）与 /api/health 一样可匿名抓取；
   * 一旦开启 NAVHUB_AUTH_REQUIRED，抓取方需带 read 及以上 scope 的 Bearer token。
   * 刻意只暴露有界基数的维度与聚合计数，不含任何站点内容/身份信息。
   */
  app.get("/api/metrics", { config: { scope: "read" } }, async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return renderMetrics();
  });

  /**
   * 显式预热 embedding 模型。
   * 默认惰性加载（不拖慢启动），需要时可主动调用（例如部署完成后预热）。
   */
  app.post("/api/warmup", { config: { scope: "write" } }, async () => {
    const t0 = Date.now();
    if (!ctx.embedding) return { ok: false, reason: "embedding 未启用" };
    const ok = await ctx.embedding.warmup();
    return { ok, tookMs: Date.now() - t0, model: ctx.config.embedding.model, dim: ctx.config.embedding.dim };
  });

  /* ------------------------------ 检索 ------------------------------ */

  /**
   * 注意：同一个 schema 要同时服务于 GET（query string，值全是字符串）
   * 和 POST（JSON，值有原生类型）。
   * 因此数字与布尔必须用 coerce 解析，否则 GET /api/search?limit=3 会因为
   * "expected number, received string" 被直接拒绝 —— 这是最容易漏掉的坑。
   */
  const queryBool = z.union([z.boolean(), z.enum(["true", "false", "1", "0"])]).transform((v) => v === true || v === "true" || v === "1");

  const searchBody = z.object({
    q: z.string().default(""),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    /** 分页偏移（0 = 第一页）。翻页时必须带上原查询，保证 RRF 输入一致。 */
    offset: z.coerce.number().int().min(0).max(1000).optional(),
    categoryId: z.string().optional(),
    tag: z.string().optional(),
    disableSemantic: queryBool.optional(),
    disablePersonal: queryBool.optional(),
    /** 身份标识：登录用户传 canonical userId，匿名传 anonId（前端 localStorage 生成）。
     *  服务端据此解析个性化信号——调用方不传 signals，避免伪造与多端不一致。 */
    userId: z.string().max(64).optional(),
    anonId: z.string().max(64).optional(),
    personalize: z.object({
      topCategories: z.array(z.string()).optional(),
      topTags: z.array(z.string()).optional(),
      visitedSiteIds: z.array(z.string()).optional(),
    }).optional(),
  });

  app.get("/api/search", { config: { rateLimit: { max: 120, timeWindow: "1 minute" }, cache: { maxAge: 20, etag: true } } }, async (req) => {
    const parsed = searchBody.safeParse(req.query ?? {});
    if (!parsed.success) return { error: "参数无效", detail: parsed.error.issues };
    return runSearch(parsed.data);
  });

  app.post("/api/search", async (req) => {
    const parsed = searchBody.safeParse(req.body ?? {});
    if (!parsed.success) return { error: "参数无效", detail: parsed.error.issues };
    return runSearch(parsed.data);
  });

  async function runSearch(input: z.infer<typeof searchBody>) {
    // 个性化信号服务端解析：身份 -> user_profiles -> personalize。
    // 显式传 personalize 的调用方（测试 / MCP）优先，保持向后兼容。
    // 检索前顺手刷新画像（节流 60s）：第一次搜索没有画像就没有个性化，符合预期。
    const identity = input.userId ?? input.anonId ?? null;
    if (identity) void refreshUserProfile(ctx, identity);

    let personalize = input.personalize;
    if (!personalize && identity) {
      const profile = await ctx.repo.getUserProfile(identity);
      if (profile && (profile.topCategories.length > 0 || profile.topTags.length > 0 || profile.visitedSiteIds.length > 0)) {
        personalize = {
          topCategories: profile.topCategories,
          topTags: profile.topTags,
          visitedSiteIds: profile.visitedSiteIds,
        };
      }
    }

    const result = await ctx.search.search({ ...input, personalize });
    // 批量取站点：旧实现 Promise.all(hits.map(getSite)) 是 N+1 查询，hits=100 时打 100 次 DB。
    const siteIds = [...new Set(result.hits.map((h) => h.siteId))];
    const siteMap = await ctx.repo.getSitesByIds(siteIds);
    const hits = result.hits.map((h) => ({
      ...h,
      site: siteMap.get(h.siteId) ?? null,
    }));

    const q = input.q.trim();
    const isFirstPage = (input.offset ?? 0) === 0;
    let suggestions: string[] = [];
    let popular: string[] = [];
    if (q) {
      // 事件只记第一页：翻页（offset>0）是同一次查询的延续，
      // 若不区分，加载更多 3 次就把 search/topQueries 计数灌水 3 倍。
      if (isFirstPage) {
        await ctx.repo.recordEvent("search", { query: q }).catch(() => undefined);
      }
      // 零结果建议只对第一页有意义（翻到头的空页不是「没搜到」）
      if (result.hits.length === 0 && isFirstPage) {
        await ctx.repo.recordEvent("zero_result", { query: q }).catch(() => undefined);
        // 零结果兜底：给「别人搜什么能搜到」而不是空白。
        // topQueries 是所有搜索词，用 zeroResultQueries 差集剔除「同样搜不到的词」——
        // 否则会把用户带进另一个死胡同。
        const [top, zero] = await Promise.all([
          ctx.repo.topQueries(180, 30),
          ctx.repo.zeroResultQueries(180, 30),
        ]);
        const zeroSet = new Set(zero.map((z) => z.query));
        suggestions = top.filter((t) => !zeroSet.has(t.query) && t.query !== q).slice(0, 5).map((t) => t.query);
        popular = top.filter((t) => !zeroSet.has(t.query)).slice(0, 8).map((t) => t.query);
      }
      if (identity && isFirstPage) {
        await ctx.repo.recordSearch(identity, q, result.hits.length).catch(() => undefined);
      }
    }
    return {
      ...result,
      hits,
      items: hits,
      // 仅零结果时携带（字段缺席 = 正常结果，前端无需判断）
      ...(result.hits.length === 0 && q && isFirstPage ? { suggestions, popular } : {}),
    };
  }

  /* ------------------------------ 站点 ------------------------------ */

  // 注意：保持返回数组（不包 {items,hasMore}）：前端多处按数组消费，改结构会破坏兼容。
  // 默认 limit 100、上限 1000 防全表扫；offset 分页支持。
  app.get("/api/sites", { config: { scope: "read", cache: { maxAge: 60, etag: true } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 1000);
    const offset = Math.max(0, Number(q.offset) || 0);
    return ctx.repo.listSites({
      categoryId: q.categoryId,
      status: q.status as never,
      limit,
      offset,
    });
  });

  // 说明：URL 形态查询走本路由即可，前提是调用方对 URL 做 encodeURIComponent
  // （实测 `/api/sites/https%3A%2F%2Fchatgpt.com` → 200；不编码的原始 URL
  //  `/api/sites/https://chatgpt.com` 会被切成多段 → 404，属 HTTP 路由固有行为）。
  app.get("/api/sites/:id", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    return site;
  });

  /**
   * 站点写入体不再本地手写：与 MCP 的 create_site 工具共用同一份 zod 契约
   * （packages/core/src/mcp-schemas.ts 的 SiteCreateBody，由 CreateSiteInput 派生）。
   * OpenAPI 的 requestBody 也从同一份契约生成，三处不会再各自漂移。
   */
  const siteInput = SiteCreateBody;

  app.post("/api/sites", { config: { scope: "write" } }, async (req, reply) => {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    // 兼容客户端（如浏览器插件）在 POST /api/sites 时传入 enrich: true 且未指定有效 categoryId 的自动富化入库调用
    if (rawBody.enrich === true && (!rawBody.categoryId || typeof rawBody.categoryId !== "string")) {
      const url = typeof rawBody.url === "string" ? rawBody.url.trim() : "";
      if (!url) { reply.code(400); return { error: "缺少 URL 参数" }; }
      const dup = await ctx.repo.findSiteByUrl(url);
      if (dup) { reply.code(409); return { error: "该网址已存在", siteId: dup.id, site: dup, created: false, reason: "已存在" }; }
      const categories = await ctx.repo.listCategories();
      const enriched = await enrichUrl(url, {
        llm: ctx.config.llm,
        guard: ctx.config.fetch,
        knownCategories: categories.map((c) => c.title),
      });
      let categoryId = enriched.suggestedCategory
        ? categories.find((c) => c.title === enriched.suggestedCategory)?.id ?? null
        : null;
      if (!categoryId) {
        const created = await ctx.repo.createCategory({ title: enriched.suggestedCategory ?? "未分类" });
        categoryId = created.id;
      }
      const site = await ctx.repo.createSite({
        url: enriched.url,
        title: (typeof rawBody.title === "string" && rawBody.title.trim()) ? rawBody.title.trim() : enriched.title,
        description: enriched.description,
        categoryId,
        iconKey: enriched.iconUrl,
        tags: Array.isArray(rawBody.tags) ? (rawBody.tags as string[]) : enriched.tags,
        source: "ai",
      });
      await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.auto", target: site.id, diff: { provenance: enriched.provenance } });
      reply.code(201);
      return site;
    }

    const parsed = siteInput.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400); return { error: "参数无效", detail: parsed.error.issues }; }

    // URL 去重：导航站最常见的脏数据来源
    const dup = await ctx.repo.findSiteByUrl(parsed.data.url);
    if (dup) { reply.code(409); return { error: "该网址已存在", siteId: dup.id, site: dup }; }

    const site = await ctx.repo.createSite({
      ...parsed.data,
      title: parsed.data.title ?? parsed.data.url,
    });
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.create", target: site.id, diff: parsed.data });
    reply.code(201);
    return site;
  });

  app.patch("/api/sites/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = siteInput.partial().safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400); return { error: "参数无效", detail: parsed.error.issues }; }
    const before = await ctx.repo.getSite(id);
    const site = await ctx.repo.updateSite(id, parsed.data);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.update", target: id, diff: { before, after: parsed.data } });
    return site;
  });

  /** 删除 = 软删除（进回收站）。向量与标签都保留，恢复时无需重建索引 */
  app.delete("/api/sites/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await ctx.repo.deleteSite(id);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.delete", target: id });
    reply.code(204);
    return null;
  });

  /**
   * 批量操作：移动类目 / 改状态 / 删除（软删）。
   *
   * 语义对齐 MCP 的 batch_import：**dryRun 默认 true**，先返回将要做出的改动，
   * 确认后再以 dryRun=false 执行——批量删除是不可逆面最大的操作，默认不落库。
   * scope 用 admin（≥ write）：操作集含删除，按最危险的成员定级。
   */
  app.post("/api/sites/bulk", { config: { scope: "admin" } }, async (req, reply) => {
    const body = z.object({
      op: z.enum(["delete", "setCategory", "setStatus"]),
      ids: z.array(z.string().min(1)).min(1).max(200),
      categoryId: z.string().optional(),
      status: z.enum(["active", "pending", "broken", "archived"]).optional(),
      dryRun: z.boolean().default(true),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const { op, ids, dryRun } = body.data;
    if (op === "setCategory" && !body.data.categoryId) { reply.code(400); return { error: "setCategory 需要 categoryId" }; }
    if (op === "setStatus" && !body.data.status) { reply.code(400); return { error: "setStatus 需要 status" }; }

    // 逐个解析存在性：不存在的 id 计入 plan 的 skip，不整批失败——
    // 批量场景下部分目标已被人删掉是常态，报错会让操作方无法完成剩余部分
    // 批量存在性检查一次 IN 查询（原逐个 getSite 是 N+1）
    const plan: Array<{ id: string; action: "apply" | "skip"; reason?: string }> = [];
    const targets: string[] = [];
    const existMap = await ctx.repo.getSitesByIds(ids);
    for (const id of ids) {
      if (!existMap.has(id)) { plan.push({ id, action: "skip", reason: "站点不存在或已在回收站" }); continue; }
      plan.push({ id, action: "apply" });
      targets.push(id);
    }
    if (dryRun) {
      return { dryRun: true, op, total: ids.length, wouldApply: targets.length, plan };
    }

    let applied = 0;
    // 事务包裹批量写：中途失败整体回滚，避免半删半改；软删保留向量（恢复无需重建）。
    await ctx.repo.withTransaction(async () => {
    for (const id of targets) {
      if (op === "delete") {
        await ctx.repo.deleteSite(id);
      } else if (op === "setCategory") {
        await ctx.repo.updateSite(id, { categoryId: body.data.categoryId });
      } else {
        await ctx.repo.updateSite(id, { status: body.data.status as never });
      }
      applied++;
    }
    });
    await ctx.repo.audit({
      ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind,
      action: "site.bulk", diff: { op, requested: ids.length, applied, skipped: ids.length - applied },
    });
    return { dryRun: false, op, applied, skipped: ids.length - applied, plan };
  });

  /**
   * 批量创建/导入站点（供书签导入器与批量脚本使用）。
   * 内部自动处理 URL 去重与分类回退，大幅降低并发 HTTP 往返与限流风险。
   */
  app.post("/api/sites/batch", { config: { scope: "write", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({
      sites: z.array(z.object({
        url: z.string().url(),
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        categoryId: z.string().optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
      })).min(1).max(200),
      defaultCategoryId: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const cats = await ctx.repo.listCategories();
    const fallback = body.data.defaultCategoryId ?? cats[0]?.id ?? (await ctx.repo.createCategory({ title: "未分类" })).id;
    let created = 0;
    let duplicates = 0;
    const createdSites: Array<Awaited<ReturnType<typeof ctx.repo.createSite>>> = [];

    // DB 写入包事务（去重检查 + 创建原子提交）；向量索引在提交后补做，避免长事务持有写锁。
    await ctx.repo.withTransaction(async () => {
    for (const item of body.data.sites) {
      const cleanUrl = canonicalizeUrl(item.url);
      const dup = await ctx.repo.findSiteByUrl(cleanUrl);
      if (dup) {
        duplicates++;
        continue;
      }
      const site = await ctx.repo.createSite({
        url: cleanUrl,
        title: item.title ?? item.url,
        description: item.description ?? null,
        categoryId: item.categoryId ?? fallback,
        tags: item.tags ?? [],
        source: item.source ?? "import",
      });
      createdSites.push(site);
      created++;
    }
    });
    for (const site of createdSites) {
      await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.batch",
      diff: { total: body.data.sites.length, created, duplicates },
    });

    reply.code(201);
    return { success: true, created, duplicates, sites: createdSites };
  });

  /* ---------------------------- 回收站 ---------------------------- */

  /** 回收站列表（软删站点，倒序） */
  app.get("/api/trash", { config: { scope: "read" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    return { items: await ctx.repo.listDeletedSites(limit) };
  });

  /** 恢复软删站点；URL 已被新站点占用时拒绝（避免恢复出重复 URL） */
  app.post("/api/trash/:id/restore", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await ctx.repo.getDeletedSite(id);
    if (!deleted) { reply.code(404); return { error: "回收站中不存在该站点（可能已恢复或已永久删除）" }; }

    const clash = await ctx.repo.findSiteByUrl(deleted.url);
    if (clash) {
      reply.code(409);
      return { error: "同网址已存在新站点，无法恢复（可先删除新站点）", existingSiteId: clash.id };
    }

    const site = await ctx.repo.restoreSite(id);
    // 向量在软删期间保留，恢复即生效；保险起见重建一次（幂等）
    await indexSite(ctx, site!.id, site!.title, site!.description ?? null, site!.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.restore", target: id });
    return site;
  });

  /** 永久删除：从回收站彻底清除（不可撤销） */
  app.delete("/api/trash/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await ctx.repo.getDeletedSite(id);
    if (!deleted) { reply.code(404); return { error: "回收站中不存在该站点" }; }

    await ctx.repo.purgeSite(id);
    await ctx.vectors.remove([id]).catch(() => undefined);   // 永久删除才清向量
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.purge", target: id, diff: { url: deleted.url, title: deleted.title } });
    reply.code(204);
    return null;
  });

  /* ------------------------------ 类目 ------------------------------ */

  app.get("/api/categories", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async () => ctx.repo.listCategories());

  app.get("/api/categories/:id", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cat = await ctx.repo.getCategory(id);
    if (!cat) { reply.code(404); return { error: "类目不存在" }; }
    return cat;
  });

  app.post("/api/categories", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({
      title: z.string().min(1),
      parentId: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      sort: z.number().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const cat = await ctx.repo.createCategory({ ...body.data, source: "api" });
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "category.create", target: cat.id });
    reply.code(201);
    return cat;
  });

  /* --------------------- 分类管理（增强） --------------------- */

  const categoryPatch = z.object({
    title: z.string().min(1).optional(),
    titleEn: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    sort: z.number().optional(),
  });

  app.patch("/api/categories/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = categoryPatch.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const before = await ctx.repo.getCategory(id);
    const cat = await ctx.repo.updateCategory(id, body.data);
    if (!cat) { reply.code(404); return { error: "类目不存在" }; }
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "category.update", target: id, diff: { before, after: body.data } });
    return cat;
  });

  /**
   * 删除类目：站点移入「未分类」（不级联删除），子类目提升到父级。
   * 这修正了旧行为——曾经删除类目会把它下面的站点一起删掉。
   */
  app.delete("/api/categories/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.repo.getCategory(id);
    if (!before) { reply.code(404); return { error: "类目不存在" }; }
    await ctx.repo.deleteCategory(id);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "category.delete", target: id, diff: { title: before.title } });
    reply.code(204);
    return null;
  });

  /** 移动类目（换父级，anchor 级联更新） */
  app.post("/api/categories/:id/move", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ parentId: z.string().nullable() }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const cat = await ctx.repo.moveCategory(id, body.data.parentId);
      if (!cat) { reply.code(404); return { error: "类目不存在" }; }
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "category.move", target: id, diff: { parentId: body.data.parentId } });
      return cat;
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 合并类目：源（含后代）站点迁入目标后删源子树 */
  app.post("/api/categories/merge", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const result = await ctx.repo.mergeCategories(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        actor: req.auth.actor, actorKind: req.auth.kind, action: "category.merge",
        target: body.data.sourceId, diff: { into: body.data.targetId, ...result },
      });
      return { ok: true, ...result };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /* ------------------------- 标签 ------------------------- */

  /** 标签云（带计数，按热度降序） */
  app.get("/api/tags", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const minCount = Number(q.minCount);
    return ctx.repo.listTagsWithCounts(Number.isFinite(minCount) && minCount > 0 ? minCount : 1);
  });

  app.patch("/api/tags/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(24) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      await ctx.repo.renameTag(id, body.data.name);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "tag.rename", target: id, diff: { name: body.data.name } });
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * 删除标签：解除与所有站点的关联后删除标签本身（不影响站点数据）。
   * 标签不存在时返回 404——脚本重试时把 404 视作「已删除」即可。
   */
  app.delete("/api/tags/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await ctx.repo.deleteTag(id);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "tag.delete", target: id, diff: result });
      return { ok: true, ...result };
    } catch (err) {
      reply.code(/不存在/.test(String(err)) ? 404 : 400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/tags/merge", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const result = await ctx.repo.mergeTags(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        actor: req.auth.actor, actorKind: req.auth.kind, action: "tag.merge",
        target: body.data.sourceId, diff: { into: body.data.targetId, ...result },
      });
      return { ok: true, ...result };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /* ----------------------- 精选专题 ----------------------- */

  app.get("/api/collections", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async () => ctx.repo.listCollections());

  app.get("/api/collections/:slug", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const col = await ctx.repo.getCollectionBySlug(slug);
    if (!col) { reply.code(404); return { error: "专题不存在" }; }
    return { collection: col, sites: await ctx.repo.listCollectionSites(slug) };
  });

  /* ----------------- 架构配方 & 竞品对比 & 确定性 Favicon ----------------- */

  /**
   * Graph-RAG 多跳技术栈链路配方查询
   */
  app.get("/api/recipes", { config: { scope: "public", cache: { maxAge: 300, etag: true } } }, async (req) => {
    const q = String((req.query as Record<string, string>)?.q ?? "").trim();
    if (!q) {
      return { items: PRESET_RECIPES };
    }
    const matched = findMatchingArchitectureRecipe(q);
    return { item: matched, items: matched ? [matched] : [] };
  });

  /**
   * 端侧竞品并排对比矩阵合成
   */
  app.get("/api/comparisons", { config: { scope: "public", cache: { maxAge: 300, etag: true } } }, async (req) => {
    const q = String((req.query as Record<string, string>)?.q ?? "").trim();
    if (!q) {
      return { ok: false, matrix: null };
    }
    const matrix = parseTechComparisonQuery(q);
    return { ok: Boolean(matrix), matrix };
  });

  /**
   * 结构化技术知识图谱：双向最短演进链路寻路 (Dijkstra)
   */
  app.get("/api/graph/path", { config: { scope: "public", cache: { maxAge: 60 } } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const from = String(q.from ?? "").trim();
    const to = String(q.to ?? "").trim();
    if (!from || !to) {
      reply.code(400);
      return { ok: false, error: "需要指定 from 与 to 查询参数" };
    }
    const pathResult = findShortestTechPath(from, to, PRESET_TECH_GRAPH);
    return { ok: true, result: pathResult };
  });

  /**
   * 结构化技术知识图谱：技术栈兼容性诊断与补齐建议
   */
  app.get("/api/graph/compatibility", { config: { scope: "public", cache: { maxAge: 60 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const rawTechs = String(q.techs ?? "").trim();
    const techList = rawTechs ? rawTechs.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const report = analyzeStackCompatibility(techList, PRESET_TECH_GRAPH);
    return { ok: true, report };
  });

  /**
   * 结构化技术知识图谱：Kleinberg HITS 权威度与枢纽度分析
   */
  app.get("/api/graph/centrality", { config: { scope: "public", cache: { maxAge: 300 } } }, async () => {
    const centrality = computeGraphCentrality(PRESET_TECH_GRAPH);
    return { ok: true, ...centrality };
  });


  /**
   * 确定性 SVG Favicon 代理端点（解决小众/外网站点 Favicon 裂开或 CORS 阻断）
   */
  app.get("/api/favicon/:id", { config: { scope: "public", cache: { maxAge: 86400, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    const title = site ? site.title : id;
    const url = site ? site.url : undefined;
    const svg = generateDeterministicSvg(title, url);
    reply.type("image/svg+xml; charset=utf-8");
    return svg;
  });

  /**
   * AI 自动自愈端点：对故障/失效站点诊断、提取 Wayback 快照并在同生态推荐最佳替代品
   */
  app.post("/api/sites/:id/heal", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }

    const peers = await ctx.repo.listSites({ categoryId: site.categoryId, status: "active", limit: 20 });
    const report = runAutonomousHealing({
      siteId: site.id,
      url: site.url,
      title: site.title,
      categoryId: site.categoryId,
      tags: site.tags,
      availablePeers: peers,
    });

    await ctx.repo.audit({
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.heal",
      target: site.id,
      diff: {
        diagnosis: report.diagnosis,
        recommendedAction: report.recommendedAction,
        topReplacement: report.suggestedReplacements[0]?.url,
      },
    });

    return { ok: true, report };
  });

  /**
   * Next-Gen 5.0 语义聚类与自适应类目生成端点
   * 对未分类、批量导入或指定分类下的站点进行 K-Means++ 语义聚类与命名生成
   */
  app.post("/api/sites/cluster", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      siteIds: z.array(z.string()).optional(),
      categoryId: z.string().optional(),
      targetK: z.number().int().min(1).max(20).optional().default(4),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    let sitesToCluster: Array<{ id: string; title: string; url: string; tags: string[] }> = [];

    if (body.data.siteIds && body.data.siteIds.length > 0) {
      const all = await Promise.all(body.data.siteIds.map((id) => ctx.repo.getSite(id)));
      sitesToCluster = all.filter((s): s is NonNullable<typeof s> => Boolean(s)).map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        tags: s.tags || [],
      }));
    } else {
      const list = await ctx.repo.listSites({
        categoryId: body.data.categoryId,
        limit: 100,
        status: "active",
      });
      sitesToCluster = list.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        tags: s.tags || [],
      }));
    }

    if (sitesToCluster.length === 0) {
      return { totalItems: 0, clusterCount: 0, clusters: [], averageCohesion: 100 };
    }

    const result = autoClusterSites(sitesToCluster, body.data.targetK);
    return { ok: true, result };
  });

  /* --------------------- Next-Gen 7.0 视觉设计与 WebMCP --------------------- */

  /**
   * 视觉指纹与调色板 WCAG 对比度/美学和谐度审计端点
   */
  app.post("/api/design/harmony", { config: { scope: "public", cache: { maxAge: 60 } } }, async (req, reply) => {
    const body = z.object({
      palette: z.array(z.string()).min(1),
      foreground: z.string().optional().default("#ffffff"),
      background: z.string().optional().default("#0f172a"),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    const report = analyzeColorPalette(body.data.palette, body.data.foreground, body.data.background);
    return { ok: true, report };
  });

  const webMcp = new WebMcpBridge();

  webMcp.registerTool({
    name: "get_architecture_recipe",
    description: "端到端技术栈架构链路配方查询",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "架构目标或技术栈关键词" } },
      required: ["query"],
    },
  }, (args) => findMatchingArchitectureRecipe(String(args.query ?? "")));

  webMcp.registerTool({
    name: "compare_technologies",
    description: "结构化技术选型对比与裁决矩阵",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "对比查询，如 react vs vue" } },
      required: ["query"],
    },
  }, (args) => parseTechComparisonQuery(String(args.query ?? "")));

  webMcp.registerTool({
    name: "evaluate_developer_intent",
    description: "开发者输入技术意图原地推测计算",
    inputSchema: {
      type: "object",
      properties: { input: { type: "string", description: "技术文本（JWT/Cron/Curl/颜色/时间戳）" } },
      required: ["input"],
    },
  }, (args) => parseSpeculativeIntent(String(args.input ?? "")) ?? { matched: false });

  webMcp.registerTool({
    name: "analyze_color_harmony",
    description: "UI 调色板美学与 WCAG 2.1 对比度审计",
    inputSchema: {
      type: "object",
      properties: {
        palette: { type: "array", items: { type: "string" }, description: "调色板颜色列表" },
        foreground: { type: "string", description: "前景文字色" },
        background: { type: "string", description: "背景色" },
      },
      required: ["palette"],
    },
  }, (args) => analyzeColorPalette(
    Array.isArray(args.palette) ? args.palette as string[] : ["#3b82f6"],
    typeof args.foreground === "string" ? args.foreground : "#ffffff",
    typeof args.background === "string" ? args.background : "#0f172a"
  ));

  webMcp.registerTool({
    name: "find_tech_path",
    description: "技术栈知识图谱寻路演进链路",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "起始技术" },
        to: { type: "string", description: "目标技术" },
      },
      required: ["from", "to"],
    },
  }, (args) => findShortestTechPath(String(args.from ?? ""), String(args.to ?? ""), PRESET_TECH_GRAPH));

  webMcp.registerTool({
    name: "analyze_stack_compatibility",
    description: "技术选型协同契合度诊断与组件补齐建议",
    inputSchema: {
      type: "object",
      properties: {
        techs: { type: "array", items: { type: "string" }, description: "已选技术列表" },
      },
      required: ["techs"],
    },
  }, (args) => analyzeStackCompatibility(
    Array.isArray(args.techs) ? args.techs.map(String) : [],
    PRESET_TECH_GRAPH
  ));

  webMcp.registerTool({
    name: "list_categories",
    description: "获取全部导航类目清单",
    inputSchema: { type: "object", properties: {} },
  }, async () => ctx.repo.listCategories());

  webMcp.registerTool({
    name: "get_federated_recommendations",
    description: "客户端本地差分隐私 (LDP Laplace) 联邦协同推荐排序",
    inputSchema: {
      type: "object",
      properties: {
        localVector: { type: "array", items: { type: "number" }, description: "本地私有偏好向量" },
        globalVector: { type: "array", items: { type: "number" }, description: "脱敏群体趋势向量" },
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              featureVector: { type: "array", items: { type: "number" } },
            },
            required: ["id", "name", "featureVector"],
          },
          description: "候选推荐列表",
        },
        personalWeight: { type: "number", description: "本地偏好权重占比" },
        privatize: { type: "boolean", description: "是否差分隐私加噪" },
        epsilon: { type: "number", description: "隐私预算" },
      },
      required: ["localVector", "candidates"],
    },
  }, (args) => {
    const localVec = Array.isArray(args.localVector) ? (args.localVector as unknown[]).map(Number) : [1, 0];
    const globalVec = Array.isArray(args.globalVector) ? (args.globalVector as unknown[]).map(Number) : localVec.map(() => 0);
    const candidates = Array.isArray(args.candidates) ? args.candidates as any[] : [];
    const personalWeight = typeof args.personalWeight === "number" ? args.personalWeight : 0.6;
    const privatize = Boolean(args.privatize);
    const epsilon = typeof args.epsilon === "number" && args.epsilon > 0 ? args.epsilon : 1.0;
    const results = rankItemsWithPrivacy(localVec, globalVec, candidates, personalWeight);
    const privatized = privatize ? privatizeVector(localVec, epsilon) : undefined;
    return {
      count: results.length,
      recommendations: results,
      privacy: privatize ? { epsilon, privatizedVector: privatized } : undefined,
    };
  });

  webMcp.registerTool({
    name: "compile_speculation_rules",
    description: "编译原生 W3C Speculation Rules 预渲染/预取规则负载与 HTML 标签",
    inputSchema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              confidence: { type: "number" },
              predictedArrivalMs: { type: "number" },
            },
            required: ["url", "confidence", "predictedArrivalMs"],
          },
        },
        prerenderConfidenceThreshold: { type: "number" },
        prefetchConfidenceThreshold: { type: "number" },
        maxPrerenderCount: { type: "number" },
        maxPrefetchCount: { type: "number" },
      },
      required: ["candidates"],
    },
  }, (args) => {
    const candidates = Array.isArray(args.candidates) ? args.candidates as any[] : [];
    const payload = compileSpeculationRules(candidates, {
      prerenderConfidenceThreshold: typeof args.prerenderConfidenceThreshold === "number" ? args.prerenderConfidenceThreshold : 0.82,
      prefetchConfidenceThreshold: typeof args.prefetchConfidenceThreshold === "number" ? args.prefetchConfidenceThreshold : 0.45,
      maxPrerenderCount: typeof args.maxPrerenderCount === "number" ? args.maxPrerenderCount : 2,
      maxPrefetchCount: typeof args.maxPrefetchCount === "number" ? args.maxPrefetchCount : 5,
    });
    return {
      hasRules: Boolean(payload),
      rules: payload,
      script: payload ? renderSpeculationRulesScript(payload) : "",
      fallbackTags: payload ? generateFallbackLinkTags(payload) : [],
    };
  });

  webMcp.registerTool({
    name: "synthesize_agent_tool",
    description: "动态将外部 REST 端点、站点检索动作或 OpenAPI 规范合成为具备 SSRF 防护的 WebMCP 智能体工具",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["rest", "site_search", "openapi"] },
        restSpec: { type: "object" },
        siteSearchSpec: { type: "object" },
        openApiSpec: { type: "object" },
      },
    },
  }, (args) => {
    const kind = args.kind ?? "rest";
    if (kind === "site_search" && args.siteSearchSpec) {
      const syn = synthesizeSiteSearchTool(args.siteSearchSpec as any);
      return { kind: "site_search", tool: syn.definition };
    }
    if (kind === "openapi" && args.openApiSpec) {
      const specs = parseOpenApiToSpecs(args.openApiSpec as MinimalOpenApiSpec);
      return { kind: "openapi", count: specs.length, tools: specs.map((s) => synthesizeRestTool(s).definition) };
    }
    if (args.restSpec) {
      const syn = synthesizeRestTool(args.restSpec as any);
      return { kind: "rest", tool: syn.definition };
    }
    return { kind: "unknown", message: "缺少配置" };
  });

  webMcp.registerTool({
    name: "exchange_p2p_mesh",
    description: "通过无中心 WebRTC / DataChannel 网格消息协议交换多端书签 CRDT 增量",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        message: { type: "object" },
      },
      required: ["nodeId", "message"],
    },
  }, (args) => {
    const nodeId = String(args.nodeId ?? "node_anon");
    const msg = (args.message ?? {}) as P2PMessage<any>;
    const node = new P2PMeshNode(nodeId);
    const outgoing = node.handleIncomingMessage(msg);
    return {
      nodeId,
      receivedType: msg.type,
      peerState: node.getPeer(msg.senderId)?.state ?? "READY",
      outgoingResponse: outgoing,
      vectorClock: node.store.getVectorClock(),
    };
  });

  /**
   * Next-Gen 7.0 浏览器端 Model Context Protocol (WebMCP) 标准 HTTP JSON-RPC 2.0 端点
   */
  app.post("/api/mcp", { config: { scope: "public" } }, async (req, reply) => {
    const rpcRes = await webMcp.handleRpc(req.body as JsonRpcRequest);
    return rpcRes;
  });

  /* --------------------- 收藏夹（终端用户） --------------------- */

  /**
   * 身份由调用方传入（登录用户的 canonical userId，或前端 localStorage 里的 anonId）。
   * 说明：这是个人导航站的轻量方案——不引入终端用户鉴权体系；
   * 多用户公开场景应改为 Bearer token（api_tokens 表已具备能力）。
   */
  const favoriteInput = z.object({
    siteId: z.string().min(1),
    folderId: z.string().nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  });

  function identityOf(req: { query: Record<string, unknown>; body: unknown; headers?: Record<string, string | undefined> }): string | null {
    // 优先 header（避免 anonId 进 URL query 泄漏到日志/referer），query/body 仅兼容旧前端
    const headers = (req as { headers?: Record<string, unknown> }).headers as Record<string, unknown> | undefined;
    const pick = (...names: string[]): string | null => {
      if (!headers) return null;
      for (const n of names) {
        const v = headers[n] ?? headers[n.toLowerCase()] ?? headers[n.toUpperCase()];
        if (typeof v === "string" && v) return v.slice(0, 64);
      }
      return null;
    };
    // 前端实际发送 X-Navhub-Anon-Id（见 web-overlay lib/navhub-api.ts anonHeaders），短名保留兼容
    const hUser = pick("x-navhub-user-id", "x-user-id");
    if (hUser) return hUser;
    const hAnon = pick("x-navhub-anon-id", "x-anon-id");
    if (hAnon) return hAnon;
    const fromQuery = (req.query ?? {}) as Record<string, string>;
    const fromBody = (req.body ?? {}) as Record<string, string>;
    const v = fromQuery.userId ?? fromQuery.anonId ?? fromBody.userId ?? fromBody.anonId ?? null;
    return typeof v === "string" ? v.slice(0, 64) : v;
  }

  app.get("/api/favorites", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    const items = await ctx.repo.listFavorites(identity);
    const folders = await ctx.repo.listFavoriteFolders(identity);
    // 批量取站点（同 runSearch 的 N+1 优化）
    const favSiteMap = await ctx.repo.getSitesByIds(items.map((f) => f.siteId));
    const sites = items.map((f) => favSiteMap.get(f.siteId) ?? null);
    return {
      items: items.map((f, i) => ({ ...f, site: sites[i] })),
      folders,
    };
  });

  app.post("/api/favorites", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const body = favoriteInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const site = await ctx.repo.getSite(body.data.siteId);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    const { favorite, existed } = await ctx.repo.addFavorite({
      userId: identity,
      siteId: body.data.siteId,
      folderId: body.data.folderId ?? null,
      note: body.data.note ?? null,
    });
    await ctx.repo.recordEvent("favorite", { siteId: body.data.siteId, meta: { identity } }).catch(() => undefined);
    reply.code(existed ? 200 : 201);
    return { favorite, existed };
  });

  app.delete("/api/favorites/:siteId", async (req) => {
    const { siteId } = req.params as { siteId: string };
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    const removed = await ctx.repo.removeFavorite(identity, siteId);
    if (removed) {
      await ctx.repo.recordEvent("unfavorite", { siteId, meta: { identity } }).catch(() => undefined);
    }
    return { ok: true, removed };
  });

  app.post("/api/favorites/folders", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const body = z.object({ name: z.string().min(1).max(30) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const folder = await ctx.repo.createFavoriteFolder(identity, body.data.name);
    reply.code(201);
    return folder;
  });

  app.delete("/api/favorites/folders/:id", async (req) => {
    const { id } = req.params as { id: string };
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    await ctx.repo.deleteFavoriteFolder(identity, id);
    return { ok: true };
  });

  /* ------------------------ 推荐排序 ------------------------ */

  /** 热度榜（trend_score 由 recompute_rank 任务重算） */
  app.get("/api/rank/trending", { config: { cache: { maxAge: 60, etag: true } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const sites = await ctx.repo.hotSites(limit);
    return {
      hits: sites.map((s) => ({
        site: s,
        // 可解释的热度分量：前端 tooltip 展示「为什么排在这儿」
        trend: { visits: s.visitCount ?? 0, trendScore: s.trendScore ?? 0, lastVisitedAt: s.lastVisitedAt ?? null },
      })),
    };
  });

  /** 新品榜 */
  app.get("/api/rank/new", { config: { cache: { maxAge: 60, etag: true } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    return { hits: (await ctx.repo.newestSites(limit)).map((s) => ({ site: s })) };
  });

  /** 相似站点（向量 KNN，零新依赖的相关推荐） */
  app.get("/api/rank/similar/:siteId", async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 6, 20);
    if (!ctx.embedding || !ctx.vectors) {
      return { hits: [], semanticAvailable: false, reason: "语义检索不可用" };
    }
    try {
      const vec = await ctx.repo.getEmbedding(siteId);
      if (!vec) return { hits: [], semanticAvailable: true, reason: "该站点暂无向量" };
      const matches = await ctx.vectors.search(vec, limit + 1);
      // 批量取站点：matches 逐个 getSite 是 N+1，改为一次 IN 查询
      const wanted = matches.filter((m) => m.siteId !== siteId).slice(0, limit);
      const similarMap = await ctx.repo.getSitesByIds(wanted.map((m) => m.siteId));
      const hits = wanted.map((m) => ({ site: similarMap.get(m.siteId) ?? null, distance: m.distance }));
      return { hits: hits.filter((h) => h.site), semanticAvailable: true };
    } catch {
      // 模型不可用不该让推荐端点 5xx
      return { hits: [], semanticAvailable: false, reason: "向量检索失败" };
    }
  });

  /**
   * 洛伦兹/庞加莱双曲空间平替推理端点（Hyperbolic Alternative Inference）
   * 结合真实 BGE 语义向量（或标签/类目特征降级投影）计算双曲测地线距离与同层级平替得分。
   */
  app.get("/api/rank/alternatives/:siteId", { config: { scope: "public" } }, async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 6, 20);

    const targetSite = await ctx.repo.getSite(siteId);
    if (!targetSite) {
      reply.code(404);
      return { error: "站点不存在" };
    }

    try {
      // 优先尝试真实向量召回 + 洛伦兹双曲流形重排
      if (ctx.embedding && ctx.vectors) {
        const vec = await ctx.repo.getEmbedding(siteId);
        if (vec) {
          const matches = await ctx.vectors.search(vec, Math.max(limit * 3, 24));
          const targetBall = clampToBall(Array.from(vec.slice(0, 16)).map((v) => v * 0.6));
          const targetLorentz = poincareToLorentz(targetBall);

          const scored = [];
          for (const m of matches) {
            if (m.siteId === siteId) continue;
            const candSite = await ctx.repo.getSite(m.siteId);
            if (!candSite || candSite.status === "broken") continue;
            const candVec = await ctx.repo.getEmbedding(m.siteId);
            const candBall = candVec
              ? clampToBall(Array.from(candVec.slice(0, 16)).map((v) => v * 0.6))
              : targetBall.map((v, idx) => v * (idx % 2 === 0 ? 0.85 : 0.9));
            const candLorentz = poincareToLorentz(candBall);
            const lDist = lorentzDistance(targetLorentz, candLorentz);
            const altScore = computeHyperbolicAlternativeScore(targetBall, candBall);
            scored.push({
              site: candSite,
              geodesicDistance: Number(lDist.toFixed(4)),
              alternativeScore: altScore,
              sameCategory: candSite.categoryId === targetSite.categoryId,
            });
          }
          scored.sort((a, b) => b.alternativeScore - a.alternativeScore);
          return {
            hits: scored.slice(0, limit),
            manifold: "lorentz-hyperboloid",
            semanticAvailable: true,
          };
        }
      }

      // 启发式双曲特征投影兜底（无本地向量时按同分类 + 标签 Jaccard 构造双曲坐标）
      const allSites = await ctx.repo.listSites({ limit: 200 });
      const targetTags = new Set(targetSite.tags ?? []);
      const fallbackHits = allSites
        .filter((s) => s.id !== siteId && s.status !== "broken")
        .map((cand) => {
          const candTags = new Set(cand.tags ?? []);
          let overlap = 0;
          for (const t of targetTags) if (candTags.has(t)) overlap++;
          const union = new Set([...targetTags, ...candTags]).size || 1;
          const jaccard = overlap / union;
          const catMatch = cand.categoryId === targetSite.categoryId ? 1 : 0;

          const uBall = [0.45, 0.35, 0.25];
          const vBall = [
            0.45 + (1 - catMatch) * 0.25,
            0.35 + (1 - jaccard) * 0.3,
            0.25,
          ];
          const lDist = lorentzDistance(poincareToLorentz(uBall), poincareToLorentz(vBall));
          const altScore = computeHyperbolicAlternativeScore(uBall, vBall);
          return {
            site: cand,
            geodesicDistance: Number(lDist.toFixed(4)),
            alternativeScore: Number((altScore + catMatch * 0.15 + jaccard * 0.2).toFixed(4)),
            sameCategory: Boolean(catMatch),
          };
        })
        .sort((a, b) => b.alternativeScore - a.alternativeScore)
        .slice(0, limit);

      return {
        hits: fallbackHits,
        manifold: "lorentz-heuristic",
        semanticAvailable: false,
      };
    } catch {
      return { hits: [], manifold: "none", semanticAvailable: false };
    }
  });

  /** 在线 Discounted-LinUCB 检索模型状态探针 */
  app.get("/api/search/linucb", { config: { scope: "public" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    return ctx.search.getLinUCBStatus(q.q || "react");
  });

  /**
   * 客户端本地差分隐私 (Local Differential Privacy, LDP Laplace) 联邦协同推荐排序端点
   */
  app.post("/api/rank/federated", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      localVector: z.array(z.number()),
      globalVector: z.array(z.number()).optional(),
      candidates: z.array(z.object({
        id: z.string(),
        name: z.string(),
        featureVector: z.array(z.number()),
      })).optional(),
      personalWeight: z.number().min(0).max(1).default(0.6),
      privatize: z.boolean().default(false),
      epsilon: z.number().positive().default(1.0),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    let candidates = body.data.candidates;
    if (!candidates || candidates.length === 0) {
      const sites = await ctx.repo.listSites({ limit: 30 });
      const dim = body.data.localVector.length || 4;
      candidates = sites.map((s, idx) => ({
        id: s.id,
        name: s.title,
        featureVector: Array.from({ length: dim }, (_, i) => Math.round((Math.sin(idx + i + 1) * 0.5 + 0.5) * 100) / 100),
      }));
    }

    const globalVec = body.data.globalVector ?? body.data.localVector.map(() => 0.5);
    const results = rankItemsWithPrivacy(
      body.data.localVector,
      globalVec,
      candidates,
      body.data.personalWeight
    );

    const privatized = body.data.privatize ? privatizeVector(body.data.localVector, body.data.epsilon) : undefined;
    return {
      ok: true,
      count: results.length,
      recommendations: results,
      privacy: body.data.privatize ? { epsilon: body.data.epsilon, privatizedVector: privatized } : undefined,
    };
  });

  /**
   * 原生 W3C Speculation Rules 预渲染与预取规则编译器端点
   */
  app.post("/api/speculation/rules", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      candidates: z.array(z.object({
        url: z.string(),
        confidence: z.number().min(0).max(1),
        predictedArrivalMs: z.number().nonnegative(),
      })).min(1),
      prerenderConfidenceThreshold: z.number().min(0).max(1).optional(),
      prefetchConfidenceThreshold: z.number().min(0).max(1).optional(),
      maxPrerenderCount: z.number().int().min(1).max(5).optional(),
      maxPrefetchCount: z.number().int().min(1).max(10).optional(),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    const payload = compileSpeculationRules(body.data.candidates, {
      prerenderConfidenceThreshold: body.data.prerenderConfidenceThreshold,
      prefetchConfidenceThreshold: body.data.prefetchConfidenceThreshold,
      maxPrerenderCount: body.data.maxPrerenderCount,
      maxPrefetchCount: body.data.maxPrefetchCount,
    });

    return {
      ok: true,
      hasRules: Boolean(payload),
      rules: payload,
      script: payload ? renderSpeculationRulesScript(payload) : "",
      fallbackTags: payload ? generateFallbackLinkTags(payload) : [],
    };
  });

  /**
   * 动态 WebMCP 智能体工具合成器端点 (支持 REST 单端点、站点检索动作与 OpenAPI 规格合成)
   */
  app.post("/api/tools/synthesize", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      kind: z.enum(["rest", "site_search", "openapi"]).default("rest"),
      restSpec: z.object({
        name: z.string(),
        description: z.string(),
        url: z.string(),
        method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
        headers: z.record(z.string()).optional(),
        parameters: z.array(z.object({
          name: z.string(),
          type: z.enum(["string", "number", "boolean"]),
          description: z.string().optional(),
          required: z.boolean().optional(),
          in: z.enum(["query", "path", "body", "header"]),
          default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        })).optional(),
        bodyType: z.enum(["json", "form"]).optional(),
      }).optional(),
      siteSearchSpec: z.object({
        siteId: z.string(),
        siteName: z.string(),
        searchUrlTemplate: z.string().optional(),
        apiEndpoint: z.string().optional(),
        category: z.string().optional(),
      }).optional(),
      openApiSpec: z.record(z.unknown()).optional(),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    if (body.data.kind === "site_search" && body.data.siteSearchSpec) {
      const syn = synthesizeSiteSearchTool(body.data.siteSearchSpec);
      webMcp.registerTool(syn.definition, (p) => syn.handler(p));
      return {
        ok: true,
        kind: "site_search",
        tool: syn.definition,
        registered: true,
      };
    }

    if (body.data.kind === "openapi" && body.data.openApiSpec) {
      const specs = parseOpenApiToSpecs(body.data.openApiSpec as MinimalOpenApiSpec);
      const tools = specs.map((s) => {
        const syn = synthesizeRestTool(s);
        webMcp.registerTool(syn.definition, (p) => syn.handler(p));
        return syn.definition;
      });
      return {
        ok: true,
        kind: "openapi",
        count: tools.length,
        tools,
        registered: true,
      };
    }

    if (body.data.restSpec) {
      const syn = synthesizeRestTool(body.data.restSpec);
      webMcp.registerTool(syn.definition, (p) => syn.handler(p));
      return {
        ok: true,
        kind: "rest",
        tool: syn.definition,
        registered: true,
      };
    }

    reply.code(400);
    return { error: "缺少 restSpec、siteSearchSpec 或 openApiSpec 有效配置" };
  });

  /**
   * P2P 网格信令与去中心化 WebRTC 状态协商端点 (P2P Mesh Signaling & Consensus Broker)
   */
  const p2pBrokerNodes = new Map<string, P2PMeshNode>();

  app.post("/api/p2p/signal", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      nodeId: z.string().min(1),
      message: z.object({
        type: z.enum(["HELLO", "SYNC_REQUEST", "DELTA_BATCH", "ACK", "HEARTBEAT"]),
        senderId: z.string().min(1),
        targetId: z.string().optional(),
        seq: z.number().int().nonnegative(),
        timestamp: z.number().int().positive(),
        payload: z.unknown(),
      }),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    let node = p2pBrokerNodes.get(body.data.nodeId);
    if (!node) {
      node = new P2PMeshNode(body.data.nodeId);
      p2pBrokerNodes.set(body.data.nodeId, node);
    }

    const outgoing = node.handleIncomingMessage(body.data.message as P2PMessage<any>);
    const peer = node.getPeer(body.data.message.senderId);

    return {
      ok: true,
      nodeId: body.data.nodeId,
      receivedType: body.data.message.type,
      peerState: peer?.state ?? "READY",
      outgoingResponse: outgoing,
      vectorClock: node.store.getVectorClock(),
      activePeers: node.listPeers().length,
    };
  });

  /* ------------------------ 搜索历史 ------------------------ */

  app.get("/api/search-history", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { items: [] };
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 10, 50);
    return { items: await ctx.repo.listSearchHistory(identity, limit) };
  });

  app.delete("/api/search-history", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { ok: false, error: "缺少 userId 或 anonId" };
    await ctx.repo.clearSearchHistory(identity);
    return { ok: true };
  });

  /* --------------------- 个性化画像（「我的偏好」） --------------------- */

  /** 读画像：让终端用户看到「系统据我的行为推断出了什么」——可解释性即信任 */
  app.get("/api/profile", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    return { profile: await ctx.repo.getUserProfile(identity) };
  });

  /**
   * 重置画像：清 user_profiles + 该身份的行为事件（画像是从中聚合的）。
   * 收藏夹与搜索历史保留——那是用户自己的数据，不是被推断的偏好。
   */
  app.delete("/api/profile", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { ok: false, error: "缺少 userId 或 anonId" };
    const result = await resetUserProfile(ctx, identity);
    return { ok: true, ...result };
  });

  /* ------------------- E2EE 零知识云端金库同步 ------------------- */

  /**
   * 读云端密文金库。服务端零知识存储，永不触碰明文。
   */
  app.get("/api/vault/sync", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const vault = await ctx.repo.getUserVault(identity);
    return { ok: true, vault };
  });

  /**
   * 推送密文金库到云端中枢。
   */
  app.put("/api/vault/sync", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const body = z.object({
      payload: z.string().min(1).max(512 * 1024),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const result = await ctx.repo.saveUserVault(identity, body.data.payload);
    return { ok: true, ...result };
  });

  /**
   * 清除云端金库。
   */
  app.delete("/api/vault/sync", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    await ctx.repo.deleteUserVault(identity);
    return { ok: true };
  });

  /* --------------------- CRDT 零冲突操作日志漫游网络 --------------------- */

  /**
   * 拉取当前身份的 CRDT 操作日志与最新折叠状态
   */
  app.get("/api/crdt/sync", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const crdtRecord = await ctx.repo.getUserVault("crdt:" + identity);
    let serverOps: CRDTOperation[] = [];
    if (crdtRecord?.payload) {
      try {
        const parsed = JSON.parse(crdtRecord.payload) as { operations?: CRDTOperation[] };
        if (Array.isArray(parsed.operations)) {
          serverOps = parsed.operations;
        }
      } catch { /* 容错 */ }
    }
    const state = reduceOperationsToState(serverOps);
    return { ok: true, operations: serverOps, state };
  });

  /**
   * 提交本地原子操作日志，与云端合流、压缩并返回最新全局状态
   */
  app.post("/api/crdt/sync", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const body = z.object({
      operations: z.array(z.object({
        id: z.string(),
        type: z.enum([
          "SET_CATEGORY_PIN",
          "REORDER_CATEGORIES",
          "PIN_SITE_IN_CATEGORY",
          "UNPIN_SITE_IN_CATEGORY",
          "UPSERT_CUSTOM_CATEGORY",
          "DELETE_CUSTOM_CATEGORY",
          "UPSERT_CUSTOM_SITE",
          "DELETE_CUSTOM_SITE",
        ]),
        entityId: z.string(),
        payload: z.unknown(),
        timestamp: z.number(),
        clientId: z.string(),
      })).max(200),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    const crdtKey = "crdt:" + identity;
    const existing = await ctx.repo.getUserVault(crdtKey);
    let serverOps: CRDTOperation[] = [];
    if (existing?.payload) {
      try {
        const parsed = JSON.parse(existing.payload) as { operations?: CRDTOperation[] };
        if (Array.isArray(parsed.operations)) {
          serverOps = parsed.operations;
        }
      } catch { /* 容错 */ }
    }

    const merged = mergeOperationLogs(serverOps, body.data.operations as CRDTOperation[]);
    const finalOps = merged.length > 100 ? compactOperationLogs(merged) : merged;
    const reduced = reduceOperationsToState(finalOps);

    await ctx.repo.saveUserVault(crdtKey, JSON.stringify({
      version: 1,
      operations: finalOps,
      state: reduced,
      updatedAt: Date.now(),
    }));

    return {
      ok: true,
      operations: finalOps,
      state: reduced,
      mergedCount: body.data.operations.length,
      totalCount: finalOps.length,
    };
  });

  /**
   * 清除 CRDT 漫游日志
   */
  app.delete("/api/crdt/sync", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    await ctx.repo.deleteUserVault("crdt:" + identity);
    return { ok: true };
  });

  /* --------------------- 终端用户身份同步 --------------------- */

  /**
   * OAuth 登录后由 Web 前端调用：把 GitHub 身份 upsert 进 users 表，
   * 返回 canonical userId（后续收藏夹 / 画像都用它，保证多端一致）。
   */
  app.post("/api/users/sync", async (req, reply) => {
    const body = z.object({
      provider: z.string().min(1).default("github"),
      providerId: z.string().min(1),
      username: z.string().min(1).max(64),
      email: z.string().email().nullable().optional(),
      avatar: z.string().url().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const user = await ctx.repo.upsertOauthUser({
      id: body.data.provider + ":" + body.data.providerId,
      username: body.data.username,
      email: body.data.email ?? null,
      avatar: body.data.avatar ?? null,
    });
    return user;
  });

  /* ------------------------ 审计日志 ------------------------ */
  /**
   * 谁在什么时候改了什么——与鉴权配套的可见性闭环。
   * 分页参数与 /api/search 一致（limit + offset + hasMore），
   * action/actor 过滤用于「只看 token 调用」「只看删除」这类排查。
   */
  app.get("/api/admin/audit", { config: { scope: "read", cache: { maxAge: 0 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const offset = Math.max(0, Number(q.offset) || 0);
    const [page, actions] = await Promise.all([
      ctx.repo.listAuditLogs({ limit, offset, action: q.action || undefined, actor: q.actor || undefined }),
      ctx.repo.listAuditActions(50),
    ]);
    return { ...page, limit, offset, actions };
  });

  /* ------------------------ 运营统计 ------------------------ */

  /**
   * 健康巡检趋势：按天分桶（桶在 JS 里做，避开 SQLite/PG 的日期函数方言差异）。
   * 返回 `days` 天的 `{date, checked, failed, rate, avgLatencyMs}`——
   * 只要有历史数据就能画出曲线，没有检查记录时返回空数组（不是 404/500）。
   */
  app.get("/api/admin/health/trend", { config: { scope: "read", cache: { maxAge: 30 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const days = Math.min(Math.max(Number(q.days) || 14, 1), 90);
    const since = Date.now() - days * 86_400_000;
    const series = await ctx.repo.healthCheckSeries(since);

    // 分桶：从今天往前推 days 天，缺数据的日期也要出现（否则曲线有洞）
    const buckets = new Map<string, { checked: number; failed: number; latencySum: number; latencyN: number }>();
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      buckets.set(d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), { checked: 0, failed: 0, latencySum: 0, latencyN: 0 });
    }
    for (const row of series) {
      const d = new Date(row.checkedAt);
      const key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      const b = buckets.get(key);
      if (!b) continue;
      b.checked++;
      if (!row.ok) b.failed++;
      if (row.latencyMs !== null) { b.latencySum += row.latencyMs; b.latencyN++; }
    }

    const points = [...buckets.entries()].map(([date, b]) => ({
      date,
      checked: b.checked,
      failed: b.failed,
      // 成功率：该天没有检查时为 null（不要写 100%，那会把「没巡检」画成「很健康」）
      rate: b.checked > 0 ? Math.round(((b.checked - b.failed) / b.checked) * 1000) / 10 : null,
      avgLatencyMs: b.latencyN > 0 ? Math.round(b.latencySum / b.latencyN) : null,
    }));
    return { days, points, total: series.length };
  });

  app.get("/api/admin/stats/trends", { config: { scope: "read" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const days = Math.min(Math.max(Number(q.days) || 30, 1), 365);
    const [top, zero, hot] = await Promise.all([
      ctx.repo.topQueries(days, 20),
      ctx.repo.zeroResultQueries(days, 20),
      ctx.repo.hotSites(20),
    ]);
    return { days, topQueries: top, zeroResultQueries: zero, hotSites: hot };
  });

  /* -------------------------- 投稿 -------------------------- */

  /**
   * 匿名投稿：创建 status=pending、source=submission 的站点，进入审核队列。
   * 比全局限流（300/min）严格得多：5 次/小时/IP，防垃圾提交。
   * 重复 URL 返回 409（与 create_site 一致的去重语义）。
   */
  app.post("/api/submissions", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = z.object({
      title: z.string().min(1).max(120),
      url: z.string().url(),
      description: z.string().max(500).default(""),
      categoryId: z.string().min(1),
      subCategoryId: z.string().nullable().optional(),
      submitterNote: z.string().max(500).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { success: false, message: "请填写完整的投稿信息" }; }

    const dup = await ctx.repo.findSiteByUrl(body.data.url);
    if (dup) {
      reply.code(409);
      return { success: false, message: "该网址已存在", siteId: dup.id };
    }

    const category = await ctx.repo.getCategory(body.data.categoryId);
    if (!category) { reply.code(400); return { success: false, message: "投稿类目不存在" }; }

    const site = await ctx.repo.createSite({
      url: body.data.url,
      title: body.data.title,
      description: body.data.description || null,
      categoryId: body.data.categoryId,
      subCategoryId: body.data.subCategoryId ?? null,
      status: "pending",
      source: "submission",
    });
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.recordEvent("submission", { siteId: site.id, categoryId: category.id }).catch(() => undefined);
    await ctx.repo.audit({ ip: req.ip, actor: "anonymous", actorKind: "user", action: "site.submit", target: site.id, diff: { url: site.url, title: site.title } });
    reply.code(201);
    return { success: true, message: "投稿已提交，等待审核", siteId: site.id };
  });

  /* --------------------- 投稿审核（收编中枢） --------------------- */

  /**
   * 投稿列表（审核队列数据源）。
   *
   * 与 Next 端 /api/submissions 的 GitHub 通道**同形状**（success + submissions），
   * 前端审核队列无论走哪条通道都拿到同样的数据结构。
   * number 是 site.id 的稳定数值 hash（见 submissionNumber），
   * 让沿用 GitHub Issue 语义的前端拿到的 id 仍是 GitHub 路径可用的形态。
   */
  app.get("/api/submissions", { config: { scope: "read", cache: { maxAge: 0 } } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const requested = q.status ?? "pending";
    const statusMap: Record<string, string | undefined> = {
      pending: "pending", approved: "active", rejected: "archived", all: undefined,
    };
    if (!(requested in statusMap)) { reply.code(400); return { success: false, message: "无效的状态筛选" }; }
    const siteStatus = statusMap[requested];
    // 精准按 source=submission 过滤，避免全站站点 >200 时投稿被截断
    const sites = await ctx.repo.listSites({
      source: "submission",
      status: siteStatus as never,
      limit: 1000,
    });
    const submissions = sites
      .map((site) => {
        const isPending = site.status === "pending";
        const label = isPending ? "pending" : (site.status === "active" ? "approved" : "rejected");
        return {
          id: submissionNumber(site.id),
          number: submissionNumber(site.id),
          title: site.title,
          body: site.description ?? "",
          state: isPending ? "open" : "closed",
          created_at: new Date(site.createdAt).toISOString(),
          updated_at: new Date(site.updatedAt).toISOString(),
          html_url: site.url,
          submissionData: {
            title: site.title,
            url: site.url,
            description: site.description ?? "",
            category: site.categoryId,
            subcategory: site.subCategoryId ?? undefined,
          },
          _status: site.status,
          _label: label,
          siteId: site.id,
        };
      });
    return { success: true, submissions };
  });

  /**
   * 审核投稿（approve → active / reject → archived）。
   *
   * :number 是前端沿用的 GitHub Issue number（site.id 的 hash），这里反查回
   * 真实 site id——此前 Next 的 hub 回退直接拿 hash number 调 /api/sites/:id，
   * 必然 404，审核按钮在 NavHub 模式下是**静默失效**的（本次收编修复）。
   * 审核动作落 submission.approve / submission.reject 审计（此前只有 POST 有审计）。
   */
  app.patch("/api/submissions/:number", { config: { scope: "write" } }, async (req, reply) => {
    const { number } = req.params as { number: string };
    const body = z.object({
      action: z.enum(["approve", "reject"]),
      reason: z.string().max(500).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { success: false, message: "无效的操作" }; }

    const wanted = Number(number);
    if (!Number.isFinite(wanted)) { reply.code(400); return { success: false, message: "无效的投稿编号" }; }
    // 精准按 source=submission 过滤查询反查 hash，不受全站常规站点数量影响
    // 注意：djb2 截断风险——投稿超 1000 会被 limit 截断而 404；兼容旧前端，新前端请直传 siteId。
    const candidates = await ctx.repo.listSites({ source: "submission", limit: 1000 });
    const site = candidates.find((s) => submissionNumber(s.id) === wanted);
    if (!site) { reply.code(404); return { success: false, message: "投稿不存在" }; }

    const nextStatus = body.data.action === "approve" ? "active" : "archived";
    await ctx.repo.updateSite(site.id, { status: nextStatus as never });
    await ctx.repo.audit({
      ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind,
      action: body.data.action === "approve" ? "submission.approve" : "submission.reject",
      target: site.id, diff: { url: site.url, title: site.title, reason: body.data.reason ?? null },
    });
    return {
      success: true,
      message: body.data.action === "approve" ? "投稿已通过并已上架" : "投稿已拒绝",
      siteId: site.id,
    };
  });

  /* ------------------------ 任务队列管理 ------------------------ */

  /** 入队（管理端 / 脚本用）。Runner 每 30s 自动消费。 */
  app.post("/api/jobs", { config: { rateLimit: { max: 30, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = RunJobInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const id = await ctx.repo.enqueueJob(body.data.kind, body.data.payload ?? {});
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "job.enqueue", target: id, diff: { kind: body.data.kind } });
    reply.code(201);
    return { id, kind: body.data.kind };
  });

  app.get("/api/jobs", { config: { scope: "read" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 50, 200);
    return ctx.repo.listJobs(q.status, limit);
  });

  /* ---------------------------- AI 富化 ---------------------------- */

  app.post("/api/enrich", { config: { rateLimit: { max: 20, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({ url: z.string().url() }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const categories = await ctx.repo.listCategories();
    const result = await enrichUrl(body.data.url, {
      llm: ctx.config.llm,
      guard: ctx.config.fetch,
      knownCategories: categories.map((c) => c.title),
    });
    await ctx.repo.recordEvent("enrich", { meta: { url: body.data.url, provenance: result.provenance } });
    return result;
  });

  /** 一步到位：抓取 + 富化 + 入库（AI 自动入库的核心接口） */
  app.post("/api/sites/auto", { config: { rateLimit: { max: 15, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({
      url: z.string().url(),
      categoryId: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const dup = await ctx.repo.findSiteByUrl(body.data.url);
    if (dup) { return { created: false, reason: "已存在", site: dup }; }

    const categories = await ctx.repo.listCategories();
    const enriched = await enrichUrl(body.data.url, {
      llm: ctx.config.llm,
      guard: ctx.config.fetch,
      knownCategories: categories.map((c) => c.title),
    });

    // 分类解析：调用方指定 -> 富化建议匹配已有类目 -> 自动新建
    let categoryId = body.data.categoryId ?? null;
    if (!categoryId && enriched.suggestedCategory) {
      categoryId = categories.find((c) => c.title === enriched.suggestedCategory)?.id ?? null;
    }
    if (!categoryId) {
      const created = await ctx.repo.createCategory({ title: enriched.suggestedCategory ?? "未分类" });
      categoryId = created.id;
    }

    const site = await ctx.repo.createSite({
      url: enriched.url,
      title: enriched.title,
      description: enriched.description,
      categoryId,
      iconKey: enriched.iconUrl,
      tags: body.data.tags ?? enriched.tags,
      source: "ai",
    });
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.auto", target: site.id, diff: { provenance: enriched.provenance } });
    reply.code(201);
    return { created: true, site, enrichment: enriched };
  });

  /* ------------------------------ 统计 ------------------------------ */

  app.get("/api/stats", { config: { scope: "read" } }, async () => ctx.repo.stats());

  /**
   * 事件上报（前端点击/收藏等行为）。
   * kind 白名单：防止脏 kind 污染画像聚合与统计。
   * click 事件联动 visit_count（热度排序的原始信号）。
   */
  const EVENT_KINDS = ["click", "favorite", "unfavorite", "impression", "dismiss"] as const;

  app.post("/api/events", async (req, reply) => {
    const body = z.object({
      kind: z.enum(EVENT_KINDS),
      siteId: z.string().optional(),
      query: z.string().optional(),
      categoryId: z.string().optional(),
      channel: z.enum(["exact", "fts", "pinyin", "semantic", "personal"]).optional(),
      dwellSeconds: z.number().min(0).max(3600).optional(),
      interactionType: z.enum(["click", "copy", "bounce"]).optional(),
      /** 身份标识（登录 userId 或匿名 anonId），用于归属画像聚合 */
      userId: z.string().max(64).optional(),
      anonId: z.string().max(64).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const identity = body.data.userId ?? body.data.anonId ?? null;
    await ctx.repo.recordEvent(body.data.kind, {
      siteId: body.data.siteId,
      query: body.data.query,
      categoryId: body.data.categoryId,
      meta: identity ? { identity } : undefined,
    });
    if (body.data.kind === "click" && body.data.siteId) {
      await ctx.repo.bumpVisit(body.data.siteId).catch(() => undefined);
    }
    // 在线强化学习闭环：若带有搜索词，实时反馈更新 Discounted-LinUCB 通道权重
    if (body.data.query && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "dismiss")) {
      const targetChannel: RetrievalChannel = body.data.channel ?? "exact";
      const explicitReward =
        body.data.kind === "favorite" ? 2.0 : body.data.kind === "dismiss" ? -0.5 : undefined;
      ctx.search.recordFeedback(targetChannel, body.data.query, {
        reward: explicitReward,
        dwellSeconds: body.data.dwellSeconds,
        interactionType: body.data.interactionType,
      });
    }
    // 行为变化 -> 刷新个性化画像（节流 60s，失败静默）
    if (identity && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "unfavorite")) {
      void refreshUserProfile(ctx, identity);
    }
    return { ok: true };
  });

  /* ------------------- NavSphere 兼容存储 API ------------------- */
  /**
   * 这两个端点就是「不修改前端 69 处调用点」的全部秘密。
   *
   * NavSphere 的 getFileContent(path) / commitFile(path, content) 只要改成打这里，
   * 整个后台（增删改查、拖拽排序、投稿审核）就自动落到真实数据库上。
   * path 沿用它的原值（如 src/navsphere/content/navigation.json），前端连常量都不用改。
   */
  app.get("/api/storage", { config: { scope: "read" } }, async (req, reply) => {
    const path = String((req.query as Record<string, string>)?.path ?? "");
    if (!path) { reply.code(400); return { error: "缺少 path 参数" }; }
    return readStoragePath(ctx, path);
  });

  app.put("/api/storage", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({
      path: z.string().min(1),
      content: z.string(),
      message: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    try {
      const result = await writeStoragePath(ctx, body.data.path, body.data.content);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "storage.write", target: body.data.path, diff: { note: result.note } });
      return result;
    } catch (err) {
      reply.code(400);
      return { error: "写入失败", detail: err instanceof Error ? err.message : String(err) };
    }
  });

  /* ------------------------ API Token 管理 ------------------------ */
  /**
   * token 是鉴权体系的入口，因此创建/列出/删除全部要求 admin。
   * 明文只在创建响应里返回一次，库里只有 sha256 —— 之后无法再取回。
   *
   * 首次启用鉴权的引导路径：
   *   NAVHUB_AUTH_REQUIRED=true NAVHUB_BOOTSTRAP_TOKEN=<自定义串> 启动
   *   → 用该串作为 Bearer 调 POST /api/tokens 建正式 token
   *   → 删除 NAVHUB_BOOTSTRAP_TOKEN 重启
   */
  /**
   * 有效期策略：
   *   - maxLifetimeDays（NAVHUB_TOKEN_MAX_LIFETIME_DAYS，默认 365，0=不限制）：
   *     显式 expiresAt 距离现在的最远天数；
   *   - allowPermanentTokens（NAVHUB_TOKEN_ALLOW_PERMANENT，默认 false）：
   *     是否允许"永不过期"凭据。
   *
   * expiresAt 的三种输入分开对待——过去它们都塌缩成"永久有效"，
   * 策略只拦显式传值的人，省略字段就绕过：
   *   - undefined（省略）：一律落策略上限（now + maxLifetimeDays）；
   *     仅当上限=0（显式关闭限制）时才为 null。"永不过期"是显式选择，不是默认结果
   *   - null（显式请求永久）：仅 allowPermanentTokens 放行，否则 400
   *   - number：必须未来且不超上限
   */
  const maxLifetimeMs = ctx.config.tokenPolicy.maxLifetimeDays > 0
    ? ctx.config.tokenPolicy.maxLifetimeDays * 86_400_000
    : 0;
  const allowPermanent = ctx.config.tokenPolicy.allowPermanentTokens;

  const resolveExpiry = (v: number | null | undefined): { expiresAt: number | null; error: string | null } => {
    if (v === undefined) {
      return { expiresAt: maxLifetimeMs === 0 ? null : Date.now() + maxLifetimeMs, error: null };
    }
    if (v === null) {
      return allowPermanent
        ? { expiresAt: null, error: null }
        : { expiresAt: null, error: "本实例禁止签发长期（永不过期）凭据：请传 expiresAt，或设置 NAVHUB_TOKEN_ALLOW_PERMANENT=true 放行" };
    }
    if (v <= Date.now()) return { expiresAt: null, error: "expiresAt 必须是未来的时间戳" };
    if (maxLifetimeMs > 0 && v - Date.now() > maxLifetimeMs) {
      return { expiresAt: null, error: "expiresAt 超出最长有效期（" + ctx.config.tokenPolicy.maxLifetimeDays + " 天）；确需更长请调 NAVHUB_TOKEN_MAX_LIFETIME_DAYS" };
    }
    return { expiresAt: v, error: null };
  };

  app.post("/api/tokens", { config: { scope: "admin" } }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      /** 逗号分隔：read / write / admin；默认只读 */
      scopes: z.string().default("read"),
      /** 过期时间（毫秒时间戳）；省略落策略上限，显式 null = 请求永久（受 NAVHUB_TOKEN_ALLOW_PERMANENT 管辖） */
      expiresAt: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const scopes = parseScopes(body.data.scopes);
    if (scopes.length === 0) { reply.code(400); return { error: "scopes 至少要有一个有效值（read / write / admin）" }; }
    const expiry = resolveExpiry(body.data.expiresAt);
    if (expiry.error) { reply.code(400); return { error: expiry.error }; }

    // 并存数量闸门：防止脚本失控签发成百上千条凭据，让"吊销"变成不可能完成的工作
    const maxActive = ctx.config.tokenPolicy.maxActiveTokens;
    if (maxActive > 0) {
      const active = (await ctx.repo.listApiTokens()).filter((t) => t.revokedAt === null).length;
      if (active >= maxActive) {
        reply.code(409);
        return { error: "未吊销的凭据已达上限（" + maxActive + " 条）；请先吊销不用的，或调 NAVHUB_TOKEN_MAX_ACTIVE" };
      }
    }

    const raw = generateToken();
    const record = await ctx.repo.createApiToken({
      name: body.data.name,
      tokenHash: hashToken(raw),
      scopes: scopes.join(","),
      expiresAt: expiry.expiresAt,
      tokenPrefix: tokenPrefixOf(raw),
    });
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.create", target: record.id, diff: { name: record.name, scopes, expiresAt: expiry.expiresAt } });
    reply.code(201);
    // 明文只在这里出现一次
    return { token: raw, ...record, note: "请立即保存：明文只显示这一次，库里只存 sha256。" };
  });

  app.get("/api/tokens", { config: { scope: "admin" } }, async () => ctx.repo.listApiTokens());

  /**
   * 更新 token 的 name / scopes / expiresAt（不改明文）。
   * 这是"凭据管理"缺失的一环：以前只能增删查，改个名字都得删了重建。
   */
  app.patch("/api/tokens/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().min(1).max(64).optional(),
      scopes: z.string().optional(),
      expiresAt: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    if (body.data.scopes !== undefined && parseScopes(body.data.scopes).length === 0) {
      reply.code(400); return { error: "scopes 至少要有一个有效值（read / write / admin）" };
    }
    // 省略 expiresAt = 保留原有效期（编辑名称不该顺带改期）；
    // 显式传值（含 null）才过策略
    let patchedExpiry: number | null | undefined;
    if (body.data.expiresAt !== undefined) {
      const expiry = resolveExpiry(body.data.expiresAt);
      if (expiry.error) { reply.code(400); return { error: expiry.error }; }
      patchedExpiry = expiry.expiresAt;
    }

    const record = await ctx.repo.updateApiToken(id, {
      name: body.data.name,
      scopes: body.data.scopes,
      expiresAt: patchedExpiry,
    });
    if (!record) { reply.code(404); return { error: "token 不存在" }; }
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.update", target: id, diff: { name: record.name, scopes: record.scopes } });
    return record;
  });

  /**
   * 轮换：为同一 token 换新明文（旧明文立即失效），保留 name 与 scopes。
   * 用于密钥泄露后的紧急轮换，或定期轮换。
   */
  app.post("/api/tokens/:id/rotate", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      /** 可选：轮换时顺带更新有效期 */
      expiresAt: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    // 同 PATCH：省略保留原有效期，显式传值（含 null）才过策略
    let rotatedExpiry: number | null | undefined;
    if (body.data.expiresAt !== undefined) {
      const expiry = resolveExpiry(body.data.expiresAt);
      if (expiry.error) { reply.code(400); return { error: expiry.error }; }
      rotatedExpiry = expiry.expiresAt;
    }

    const raw = generateToken();
    const record = await ctx.repo.rotateApiToken(id, hashToken(raw), rotatedExpiry, tokenPrefixOf(raw));
    if (!record) { reply.code(404); return { error: "token 不存在" }; }
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.rotate", target: id, diff: { name: record.name, scopes: record.scopes } });
    // 明文只在这里出现一次
    return { token: raw, ...record, note: "轮换成功：旧明文已立即失效，请保存新明文。" };
  });

  /**
   * 软吊销：立刻失效，但保留记录。
   *
   * 与 DELETE 的分工：
   *   revoke = 停用并留痕（审计日志里的 target 仍对应得到这条凭据）——日常应该用这个
   *   delete = 彻底抹除（合规 / 数据清除场景）
   * 以前只有 delete，等于"想停用就必须先销毁证据"。
   */
  app.post("/api/tokens/:id/revoke", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await ctx.repo.revokeApiToken(id);
    if (!record) { reply.code(404); return { error: "token 不存在" }; }
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.revoke", target: id, diff: { name: record.name } });
    return record;
  });

  app.delete("/api/tokens/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await ctx.repo.deleteApiToken(id);
    if (!deleted) { reply.code(404); return { error: "token 不存在" }; }
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "token.delete", target: id });
    reply.code(204);
    return null;
  });

  /* --------------------------- 内部工具 --------------------------- */

  return app;
}

