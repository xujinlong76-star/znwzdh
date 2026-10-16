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
} from "@navhub/core";
import { enrichUrl } from "@navhub/ai";
import type { AppContext } from "./context.ts";
import { createContext } from "./context.ts";
import { loadConfig } from "./config.ts";
import { readStoragePath, writeStoragePath } from "./storage.ts";
import { indexSite } from "./index-site.ts";
import { refreshUserProfile, resetUserProfile } from "./profile-service.ts";
import { buildOpenApiDoc, renderDocsHtml, type RouteEntry } from "./openapi.ts";
import { registerIdentityRoutes } from "./routes/identity.ts";
import { registerSubmissionRoutes } from "./routes/submissions.ts";
import { registerJobRoutes } from "./routes/jobs.ts";
import { registerTokenRoutes } from "./routes/tokens.ts";
import { registerSearchRoutes } from "./routes/search.ts";
import { registerTaxonomyRoutes } from "./routes/taxonomy.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerSiteRoutes } from "./routes/sites.ts";
import { registerDiscoveryRoutes } from "./routes/discovery.ts";
import { registerRankRoutes } from "./routes/rank.ts";
import { registerInfraRoutes } from "./routes/infra.ts";
import { registerAgentRoutes } from "./routes/agent.ts";
import { registerP2pRoutes } from "./routes/p2p.ts";
import { registerEnrichRoutes } from "./routes/enrich.ts";
import { identityAllowed } from "./routes/shared.ts";
import {
  ANONYMOUS_IDENTITY,
  bearerOf,
  generateToken,
  hashToken,
  parseScopes,
  scopeSatisfies,
  secureEqual,
  type ApiScope,
  type AuthIdentity,
  type RouteScope,
} from "./auth.ts";

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

  registerInfraRoutes(app, ctx, { routeEntries, renderMetrics });

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

    if (!ctx.config.authRequired) return;

    const token = bearerOf(req);
    if (!token) {
      // 无 token：public 路由匿名放行，管理面 401
      if (required === "public") return;
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
      return reply.code(401).send({ error: "token 无效或已过期" });
    }
    const tokenScopes = parseScopes(Array.isArray(record.scopes) ? record.scopes.join(",") : String(record.scopes ?? ""));
    // public 路由不做 scope 门槛（任意有效 token 即可挂载身份，供 identityAllowed 区分匿名与持票用户）；
    // 管理面仍要求 scope 不低于路由要求（admin ⊇ write ⊇ read）。
    if (required !== "public" && !scopeSatisfies(tokenScopes, required)) {
      return reply.code(403).send({ error: "token 的 scope 不足以执行该操作（需要 " + required + "，当前 " + tokenScopes.join(",") + "）" });
    }

    // 鉴权通过：写入真实身份，审计从这一刻起记录「谁」而不是笼统的 "api"
    auth.actor = record.name;
    auth.kind = "token";
    auth.tokenId = record.id;
    auth.scopes = tokenScopes;
    void ctx.repo.touchApiToken(record.id).catch(() => undefined);
  });

  registerSearchRoutes(app, ctx);

  registerSiteRoutes(app, ctx);

  registerTaxonomyRoutes(app, ctx);

  registerDiscoveryRoutes(app, ctx);

  registerAgentRoutes(app, ctx);
  registerP2pRoutes(app, ctx);

  registerAdminRoutes(app, ctx);
  registerSubmissionRoutes(app, ctx);
  registerJobRoutes(app, ctx);

  registerEnrichRoutes(app, ctx);

  registerTokenRoutes(app, ctx);

  /* --------------------------- 内部工具 --------------------------- */

  return app;
}

