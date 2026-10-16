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

  registerSearchRoutes(app, ctx);

  registerSiteRoutes(app, ctx);

  registerTaxonomyRoutes(app, ctx);

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
      siteIds: z.array(z.string()).max(100).optional(),
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

  // identity 路由（收藏夹/历史/画像/金库/CRDT/users）：实现见 routes/identity.ts
  registerIdentityRoutes(app, ctx);

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
    // 公共写入面：开放模式保持可用；开启鉴权后必须带有效 token（防注册表被匿名滥用）。
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
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
      if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) {
        reply.code(429);
        return { error: "工具注册表已满（上限 " + webMcp.maxToolCount + "），请联系管理员清理" };
      }
      return {
        ok: true,
        kind: "site_search",
        tool: syn.definition,
        registered: true,
      };
    }

    if (body.data.kind === "openapi" && body.data.openApiSpec) {
      const specs = parseOpenApiToSpecs(body.data.openApiSpec as MinimalOpenApiSpec);
      const tools = [];
      for (const s of specs) {
        const syn = synthesizeRestTool(s);
        if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) break;
        tools.push(syn.definition);
      }
      return {
        ok: true,
        kind: "openapi",
        count: tools.length,
        tools,
        registered: tools.length > 0,
        capped: tools.length < specs.length,
      };
    }

    if (body.data.restSpec) {
      const syn = synthesizeRestTool(body.data.restSpec);
      if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) {
        reply.code(429);
        return { error: "工具注册表已满（上限 " + webMcp.maxToolCount + "），请联系管理员清理" };
      }
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
  // 信令 broker 容量与空闲驱逐：Map 无上限增长 = 内存耗尽风险。
  // 驱逐是惰性的（每次请求顺带检查，避免在 buildServer 里挂 setInterval 导致测试多实例泄漏 timer）。
  const MAX_P2P_NODES = 1000;
  const P2P_NODE_IDLE_MS = 30 * 60 * 1000;
  const P2P_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
  const p2pLastSeen = new Map<string, number>();
  let p2pLastSweep = 0;

  app.post("/api/p2p/signal", { config: { scope: "public" } }, async (req, reply) => {
    // 公共写入面：开放模式保持可用；开启鉴权后必须带有效 token。
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const body = z.object({
      nodeId: z.string().min(1).max(128),
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
      const now = Date.now();
      // 惰性驱逐：超过清扫间隔时，删掉空闲超时的节点
      if (now - p2pLastSweep > P2P_SWEEP_INTERVAL_MS) {
        p2pLastSweep = now;
        for (const [id, seen] of p2pLastSeen) {
          if (now - seen > P2P_NODE_IDLE_MS) {
            p2pLastSeen.delete(id);
            p2pBrokerNodes.delete(id);
          }
        }
      }
      if (p2pBrokerNodes.size >= MAX_P2P_NODES) {
        reply.code(429);
        return { error: "信令节点已满（上限 " + MAX_P2P_NODES + "），请稍后重试" };
      }
      node = new P2PMeshNode(body.data.nodeId);
      p2pBrokerNodes.set(body.data.nodeId, node);
    }
    p2pLastSeen.set(body.data.nodeId, Date.now());

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

  registerAdminRoutes(app, ctx);
  registerSubmissionRoutes(app, ctx);
  registerJobRoutes(app, ctx);

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

  registerTokenRoutes(app, ctx);

  /* --------------------------- 内部工具 --------------------------- */

  return app;
}

